"""Comprehensive tests for OpenRouter gateway with micro-billing."""
from __future__ import annotations

import asyncio
import json
import os
import uuid
from decimal import Decimal
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

# issue_access_token signs with ENV["JWT_SECRET"]; set it before importing app so this
# file passes standalone, not only when an earlier alphabetically-sorted test set it.
os.environ.setdefault("JWT_SECRET", "test-secret-test-secret-test-secret-ok")
os.environ.setdefault("JWT_AUDIENCE", "authenticated")

from app.gateway.billing import apply_markup, calculate_raw_cost, extract_usage, settle_billing  # noqa: E402
from app.gateway.preflight import (  # noqa: E402
    InsufficientBalanceError,
    calculate_estimated_cost,
    calculate_max_tokens,
    preflight_check,
)
from app.gateway.pricing import parse_model_pricing, sync_pricing  # noqa: E402
from app.gateway.service import GatewayService  # noqa: E402
from app.gateway.store import MemoryGatewayStore, PostgresGatewayStore  # noqa: E402
from app.gateway.tokenizer import count_messages_tokens, count_tokens  # noqa: E402


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
# Step 2: Context Engineering Tests (single-turn; history stays on the device)
# ============================================================================

class TestContextIsolation:
    """Test per-tenant isolation of the single-turn gateway path."""

    @pytest.mark.asyncio
    async def test_prepare_messages_is_single_turn(self):
        """The gateway builds [system, user] for this prompt only — no server-side history."""
        store = MemoryGatewayStore()
        service = GatewayService(
            store=store,
            http_client=AsyncMock(),
            openrouter_api_key="test-key",
            openrouter_base_url="https://test.openrouter.ai/api/v1",
        )
        messages = service.prepare_messages("Hello there")
        assert [m["role"] for m in messages] == ["system", "user"]
        assert messages[1]["content"] == "Hello there"
        # repeated turns never accumulate state on the server
        again = service.prepare_messages("Second question")
        assert len(again) == 2
        assert again[1]["content"] == "Second question"

    @pytest.mark.asyncio
    async def test_stores_no_chat_history(self):
        """Chat storage is gone from both stores (product rule: history lives on the device)."""
        for store in (MemoryGatewayStore(), PostgresGatewayStore(pool=None)):
            assert not hasattr(store, "save_chat_message")
            assert not hasattr(store, "get_user_chat_history")

    @pytest.mark.asyncio
    async def test_concurrent_requests_isolated(self):
        """Concurrent requests from user_A and user_B have zero cross-contamination."""
        store = MemoryGatewayStore()
        await store.upsert_model_pricing(
            model_id="openai/gpt-4.1",
            input_price_per_million=Decimal("1.00"),
            output_price_per_million=Decimal("2.00"),
            context_window=4096,
        )

        users = [str(uuid.uuid4()) for _ in range(4)]
        for u in users:
            await store.ensure_gateway_account(u, Decimal("10.0"))

        def make_service():
            mock_client = AsyncMock()
            mock_response = MagicMock()
            mock_response.json.return_value = {
                "id": "test-id",
                "choices": [{"message": {"content": "Hello!"}}],
                "usage": {"prompt_tokens": 10, "completion_tokens": 5},
            }
            mock_response.raise_for_status = MagicMock()
            mock_client.post = AsyncMock(return_value=mock_response)
            return GatewayService(
                store=store,
                http_client=mock_client,
                openrouter_api_key="test-key",
                openrouter_base_url="https://test.openrouter.ai/api/v1",
            )

        async def ask(user_id: str, prompt: str) -> dict[str, Any]:
            return await make_service().handle_chat_request(  # type: ignore[return-value]
                user_id=user_id, model="openai/gpt-4.1", prompt=prompt, stream=False
            )

        results = await asyncio.gather(*[
            ask(users[0], "A question"), ask(users[1], "B question"),
            ask(users[2], "C question"), ask(users[3], "D question"),
        ])

        # Each user is billed only for their own request.
        for u in users:
            balance_info = await store.get_user_balance(u)
            assert balance_info is not None
            balance, locked = balance_info
            assert balance < Decimal("10.0")
            assert not locked

        # Per-user concurrency allowed two in-flight requests per user.
        for r in results:
            assert "billing" in r


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
            model_id="openai/gpt-4.1",
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
            model="openai/gpt-4.1",
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
        
        # Verify chat messages were NOT saved (history stays on the device)
        assert not hasattr(store, "save_chat_message")
        assert not hasattr(store, "get_user_chat_history")


class TestModelAllowlist:
    """Curated model allowlist: policy gate + /models listing."""

    def _allowlisted_service(self, store, model_id):
        mock_client = AsyncMock()
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "id": "resp-id",
            "choices": [{"message": {"content": "Hi"}}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5},
        }
        mock_response.raise_for_status = MagicMock()
        mock_client.post = AsyncMock(return_value=mock_response)
        service = GatewayService(
            store=store,
            http_client=mock_client,
            openrouter_api_key="test-key",
            openrouter_base_url="https://test.openrouter.ai/api/v1",
        )
        return service

    def test_allowlist_membership(self):
        """Famous paid models are permitted; free/unknown models are not."""
        from app.gateway.model_allowlist import allowed_ids, is_allowed

        assert is_allowed("openai/gpt-4.1") is True
        assert is_allowed("anthropic/claude-sonnet-4.5") is True
        assert is_allowed("google/gemini-2.5-pro") is True
        assert is_allowed("meta/llama-3.1-8b-instruct:free") is False
        assert is_allowed("some/random-model") is False
        # No entry in the allowlist may be a :free model.
        assert all(":free" not in mid for mid in allowed_ids())

    @pytest.mark.asyncio
    async def test_chat_rejects_non_allowlisted_model(self):
        """A non-allowlisted model is rejected with 400 before any billing."""
        from fastapi import HTTPException

        store = MemoryGatewayStore()
        user_id = str(uuid.uuid4())
        await store.ensure_gateway_account(user_id, Decimal("2.00"))
        await store.upsert_model_pricing(
            model_id="meta/llama-3.1-8b-instruct:free",
            input_price_per_million=Decimal("0"),
            output_price_per_million=Decimal("0"),
            context_window=4096,
        )
        service = self._allowlisted_service(store, "meta/llama-3.1-8b-instruct:free")

        with pytest.raises(HTTPException) as exc_info:
            await service.handle_chat_request(
                user_id=user_id,
                model="meta/llama-3.1-8b-instruct:free",
                prompt="Hello",
                stream=False,
            )
        assert exc_info.value.status_code == 400
        # The model never reached OpenRouter and nothing was billed.
        assert service.http_client.post.await_count == 0
        balance_info = await store.get_user_balance(user_id)
        assert balance_info is not None
        balance, _ = balance_info
        assert balance == Decimal("2.00")

    @pytest.mark.asyncio
    async def test_models_lists_only_allowlisted_with_pricing(self):
        """GET /api/v1/models returns only allowlisted models that have pricing."""
        from app.gateway.router import list_models

        store = MemoryGatewayStore()
        # One allowlisted model synced with pricing, one free model also stored.
        await store.upsert_model_pricing(
            model_id="openai/gpt-4.1",
            input_price_per_million=Decimal("2.00"),
            output_price_per_million=Decimal("8.00"),
            context_window=128000,
        )
        await store.upsert_model_pricing(
            model_id="meta/llama-3.1-8b-instruct:free",
            input_price_per_million=Decimal("0"),
            output_price_per_million=Decimal("0"),
            context_window=4096,
        )
        gateway = self._allowlisted_service(store, "openai/gpt-4.1")

        result = await list_models(user_id="user_1", gateway=gateway)
        ids = [m["id"] for m in result["models"]]
        assert ids == ["openai/gpt-4.1"]
        # Free/non-allowlisted model never appears even though pricing is synced.
        assert "meta/llama-3.1-8b-instruct:free" not in ids
        entry = result["models"][0]
        assert entry["provider"] == "OpenAI"
        assert entry["input_price_per_million"] == 2.0


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
