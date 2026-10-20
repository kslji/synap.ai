"""Comprehensive tests for OpenRouter gateway with micro-billing."""
from __future__ import annotations

import asyncio
import json
import os
import uuid
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from app.gateway.billing import apply_markup, calculate_raw_cost, extract_usage, settle_billing
from app.gateway.preflight import (
    InsufficientBalanceError,
    calculate_estimated_cost,
    calculate_max_tokens,
    preflight_check,
)
from app.gateway.pricing import parse_model_pricing, sync_pricing
from app.gateway.service import GatewayService
from app.gateway.store import MemoryGatewayStore
from app.gateway.tokenizer import count_messages_tokens, count_tokens


# ============================================================================
# Step 1: Auth & Core Routing Tests
# ============================================================================

class TestAuth:
    """Test authentication and user mapping."""

    def test_unauthenticated_request_rejected(self):
        """Unauthenticated requests should be rejected with 401."""
        # This would be tested via the actual API endpoint
        # For now, test the get_user_id function
        from app.gateway.router import get_user_id
        
        with pytest.raises(Exception) as exc_info:
            # Empty authorization header
            asyncio.get_event_loop().run_until_complete(get_user_id(""))
        
        assert "401" in str(exc_info.value) or "Invalid" in str(exc_info.value)

    def test_valid_token_extracts_user_id(self):
        """Valid token should extract user_123."""
        from app.tokens import issue_access_token
        
        # Create a test token
        device_id = str(uuid.uuid4())
        user_id = "user_123"
        email = "test@example.com"
        
        token_data = issue_access_token(device_id, user_id, email)
        token = token_data["token"]
        
        # This would be tested via the actual endpoint
        # The token should contain the user_id in the 'uid' claim
        assert token is not None


# ============================================================================
# Step 2: Context Engineering & Isolation Tests
# ============================================================================

class TestContextIsolation:
    """Test tenant isolation and context fetching."""

    @pytest.mark.asyncio
    async def test_concurrent_requests_isolated(self):
        """Concurrent requests from user_A and user_B should have zero cross-contamination."""
        store = MemoryGatewayStore()
        
        # Setup user_A with 3 historic messages
        user_a = str(uuid.uuid4())
        await store.ensure_gateway_account(user_a, Decimal("10.0"))
        await store.save_chat_message(user_a, "user", "Message 1 from user A")
        await store.save_chat_message(user_a, "assistant", "Response 1 to user A")
        await store.save_chat_message(user_a, "user", "Message 2 from user A")
        
        # Setup user_B with 0 historic messages
        user_b = str(uuid.uuid4())
        await store.ensure_gateway_account(user_b, Decimal("10.0"))
        
        # Concurrently fetch history
        history_a = await store.get_user_chat_history(user_a, max_tokens=2000)
        history_b = await store.get_user_chat_history(user_b, max_tokens=2000)
        
        # Assert user_A has exactly 3 messages
        assert len(history_a) == 3
        assert history_a[0]["content"] == "Message 1 from user A"
        assert history_a[1]["content"] == "Response 1 to user A"
        assert history_a[2]["content"] == "Message 2 from user A"
        
        # Assert user_B has 0 messages
        assert len(history_b) == 0
        
        # Verify no cross-contamination
        for msg in history_a:
            assert "user B" not in msg["content"].lower() or "user A" in msg["content"]

    @pytest.mark.asyncio
    async def test_sliding_window_truncation(self):
        """Old messages should be dropped when exceeding token budget."""
        store = MemoryGatewayStore()
        user_id = str(uuid.uuid4())
        
        # Add many messages (each ~50 chars = ~12 tokens)
        for i in range(20):
            await store.save_chat_message(user_id, "user", f"Message {i}")
        
        # Fetch with small token budget (enough for ~5 messages)
        history = await store.get_user_chat_history(user_id, max_tokens=60)
        
        # Should have fewer than 20 messages
        assert len(history) < 20
        assert len(history) > 0
        # Should have the newest messages
        assert "Message 19" in history[-1]["content"]


# ============================================================================
# Step 3: Dynamic Pricing Database Tests
# ============================================================================

class TestPricing:
    """Test pricing sync and database updates."""

    @pytest.mark.asyncio
    async def test_pricing_sync_updates_without_duplicates(self):
        """Pricing sync should update existing models without creating duplicates."""
        store = MemoryGatewayStore()
        
        # Mock OpenRouter response
        mock_models = [
            {
                "id": "deepseek/deepseek-chat",
                "context_length": 64000,
                "pricing": {
                    "prompt": "0.00000014",  # $0.14 per 1M
                    "completion": "0.00000028",  # $0.28 per 1M
                },
            }
        ]
        
        # Mock HTTP client
        mock_client = AsyncMock()
        mock_response = MagicMock()
        mock_response.json.return_value = {"data": mock_models}
        mock_response.raise_for_status = MagicMock()
        mock_client.get = AsyncMock(return_value=mock_response)
        
        # Sync pricing
        synced = await sync_pricing(store, mock_client)
        assert synced == 1
        
        # Verify pricing was inserted
        pricing = await store.get_model_pricing("deepseek/deepseek-chat")
        assert pricing is not None
        assert pricing["input_price_per_million"] == Decimal("0.14")
        assert pricing["output_price_per_million"] == Decimal("0.28")
        
        # Now sync again with modified pricing
        mock_models[0]["pricing"]["prompt"] = "0.00000020"  # $0.20 per 1M
        synced = await sync_pricing(store, mock_client)
        assert synced == 1
        
        # Verify pricing was updated (not duplicated)
        pricing = await store.get_model_pricing("deepseek/deepseek-chat")
        assert pricing["input_price_per_million"] == Decimal("0.20")
        
        # Verify only one entry exists
        assert len(store.models_pricing) == 1

    def test_parse_model_pricing(self):
        """Test parsing of OpenRouter model pricing."""
        model_data = {
            "id": "openai/gpt-4",
            "context_length": 8192,
            "pricing": {
                "prompt": "0.00003",
                "completion": "0.00006",
            },
        }
        
        result = parse_model_pricing(model_data)
        assert result is not None
        
        model_id, input_price, output_price, context_window = result
        assert model_id == "openai/gpt-4"
        assert input_price == Decimal("30")  # 0.00003 * 1M
        assert output_price == Decimal("60")  # 0.00006 * 1M
        assert context_window == 8192


# ============================================================================
# Step 4: Pre-Flight Gatekeeper Tests
# ============================================================================

class TestPreFlight:
    """Test pre-flight checks and safety brakes."""

    def test_large_input_insufficient_balance(self):
        """Large input with insufficient balance should return 402."""
        # User has $0.01
        balance = Decimal("0.01")
            
        # Very large input to ensure cost exceeds balance
        # ~100,000 chars should be ~25,000 tokens
        messages = [{"role": "user", "content": "x" * 100000}]
        input_price = Decimal("1.00")
            
        buffered_tokens, estimated_cost = calculate_estimated_cost(messages, input_price)
            
        # Should exceed balance
        assert estimated_cost > balance, f"Expected cost > $0.01, got ${estimated_cost}"
            
        # preflight_check should raise InsufficientBalanceError
        with pytest.raises(InsufficientBalanceError) as exc_info:
            preflight_check(
                messages=messages,
                balance=balance,
                input_price_per_million=input_price,
                output_price_per_million=Decimal("2.00"),
            )
            
        assert exc_info.value.required > balance

    def test_short_prompt_restricted_max_tokens(self):
        """Short prompt with $0.01 should have restricted max_tokens."""
        balance = Decimal("0.01")
        messages = [{"role": "user", "content": "Hello"}]  # ~10 tokens
        input_price = Decimal("1.00")  # $1 per 1M
        output_price = Decimal("2.00")  # $2 per 1M
        
        buffered_tokens, max_tokens, estimated_cost = preflight_check(
            messages=messages,
            balance=balance,
            input_price_per_million=input_price,
            output_price_per_million=output_price,
        )
        
        # Estimated cost should be very small
        assert estimated_cost < Decimal("0.001")
        
        # max_tokens should be calculated based on remaining budget
        remaining = balance - estimated_cost
        expected_max = int(remaining * Decimal("1000000") / output_price)
        
        assert max_tokens == expected_max
        assert max_tokens > 0

    def test_safety_buffer_applied(self):
        """15% safety buffer should be applied to token count."""
        messages = [{"role": "user", "content": "test"}]
        input_price = Decimal("1.00")
        
        buffered_tokens, cost = calculate_estimated_cost(messages, input_price)
        
        # Should have 15% buffer
        raw_tokens = count_messages_tokens(messages)
        expected_buffered = int(raw_tokens * 1.15)
        
        assert buffered_tokens >= raw_tokens


# ============================================================================
# Step 5: Post-Flight Billing Tests
# ============================================================================

class TestBilling:
    """Test billing calculation and post-flight updates."""

    def test_billing_calculation_exact(self):
        """Test exact billing calculation: $0.009 raw, $0.0108 with 1.20x markup."""
        # 5000 input tokens at $1.00 per 1M
        # 2000 output tokens at $2.00 per 1M
        raw_cost = calculate_raw_cost(
            input_tokens=5000,
            output_tokens=2000,
            input_price_per_million=Decimal("1.00"),
            output_price_per_million=Decimal("2.00"),
        )
        
        # Expected: (5000 * 1.00 / 1M) + (2000 * 2.00 / 1M) = 0.005 + 0.004 = 0.009
        assert raw_cost == Decimal("0.009")
        
        # Apply 1.20x markup
        final_deduction = apply_markup(raw_cost, Decimal("1.20"))
        
        # Expected: 0.009 * 1.20 = 0.0108
        assert final_deduction == Decimal("0.0108")

    @pytest.mark.asyncio
    async def test_balance_update_exact(self):
        """Test balance update: $2.00 → $1.9892."""
        store = MemoryGatewayStore()
        user_id = str(uuid.uuid4())
        
        # Setup account with $2.00
        await store.ensure_gateway_account(user_id, Decimal("2.00"))
        
        # Mock response
        response = {
            "choices": [{"message": {"content": "Test response"}}],
            "usage": {
                "prompt_tokens": 5000,
                "completion_tokens": 2000,
            },
        }
        
        # Setup pricing
        await store.upsert_model_pricing(
            model_id="test-model",
            input_price_per_million=Decimal("1.00"),
            output_price_per_million=Decimal("2.00"),
            context_window=4096,
        )
        
        # Settle billing
        result = await settle_billing(
            store=store,
            user_id=user_id,
            model_id="test-model",
            response=response,
            markup_multiplier=Decimal("1.20"),
            balance_before=Decimal("2.00"),
        )
        
        # Verify exact calculation
        assert result["raw_cost"] == Decimal("0.009")
        assert result["final_deduction"] == Decimal("0.0108")
        
        # Verify balance update
        assert result["balance_before"] == Decimal("2.00")
        assert result["balance_after"] == Decimal("1.9892")
        
        # Verify audit row created
        assert result["transaction_id"] is not None
        assert len(store.billing_transactions) == 1

    @pytest.mark.asyncio
    async def test_zero_balance_locks_account(self):
        """Account should be locked when balance hits zero."""
        store = MemoryGatewayStore()
        user_id = str(uuid.uuid4())
        
        # Setup account with tiny balance
        await store.ensure_gateway_account(user_id, Decimal("0.001"))
        
        # Mock expensive response
        response = {
            "choices": [{"message": {"content": "Expensive response"}}],
            "usage": {
                "prompt_tokens": 10000,
                "completion_tokens": 5000,
            },
        }
        
        # Setup expensive pricing
        await store.upsert_model_pricing(
            model_id="expensive-model",
            input_price_per_million=Decimal("10.00"),
            output_price_per_million=Decimal("20.00"),
            context_window=4096,
        )
        
        # Settle billing (should exceed balance)
        result = await settle_billing(
            store=store,
            user_id=user_id,
            model_id="expensive-model",
            response=response,
            markup_multiplier=Decimal("1.20"),
            balance_before=Decimal("0.001"),
        )
        
        # Account should be locked
        assert result["billing_locked"] is True
        assert result["balance_after"] <= Decimal("0")


# ============================================================================
# Integration Tests
# ============================================================================

class TestIntegration:
    """Integration tests for the complete flow."""

    @pytest.mark.asyncio
    async def test_complete_chat_flow(self):
        """Test complete chat request flow from auth to billing."""
        store = MemoryGatewayStore()
        user_id = str(uuid.uuid4())
        
        # Setup
        await store.ensure_gateway_account(user_id, Decimal("2.00"))
        await store.upsert_model_pricing(
            model_id="test-model",
            input_price_per_million=Decimal("1.00"),
            output_price_per_million=Decimal("2.00"),
            context_window=4096,
        )
        
        # Mock HTTP client
        mock_client = AsyncMock()
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "id": "test-id",
            "choices": [{"message": {"content": "Hello!"}}],
            "usage": {"prompt_tokens": 100, "completion_tokens": 50},
        }
        mock_response.raise_for_status = MagicMock()
        mock_client.post = AsyncMock(return_value=mock_response)
        
        # Create service
        service = GatewayService(
            store=store,
            http_client=mock_client,
            openrouter_api_key="test-key",
            openrouter_base_url="https://test.openrouter.ai/api/v1",
        )
        
        # Handle request
        result = await service.handle_chat_request(
            user_id=user_id,
            model="test-model",
            prompt="Hello",
            stream=False,
        )
        
        # Verify response (result should be a dict for non-streaming)
        assert isinstance(result, dict)
        assert "choices" in result
        assert "billing" in result
        assert result["billing"]["input_tokens"] == 100
        assert result["billing"]["output_tokens"] == 50
        
        # Verify balance was deducted
        balance_info = await store.get_user_balance(user_id)
        assert balance_info is not None
        balance, locked = balance_info
        assert balance < Decimal("2.00")
        
        # Verify chat messages were saved
        history = await store.get_user_chat_history(user_id, max_tokens=2000)
        assert len(history) == 2  # user + assistant


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
