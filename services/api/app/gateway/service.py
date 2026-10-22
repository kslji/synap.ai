"""Core gateway service: orchestrates the complete chat request flow."""
from __future__ import annotations

import asyncio
import json
import logging
import os
from decimal import Decimal
from typing import Any, AsyncIterator

import httpx
from fastapi import HTTPException

from .billing import settle_billing
from .errors import INSUFFICIENT_CREDITS, NOT_CONFIGURED, raise_mapped, user_facing_message
from .model_allowlist import is_allowed
from .preflight import InsufficientBalanceError, preflight_check
from .pricing import pricing_sync_loop
from .store import MemoryGatewayStore, PostgresGatewayStore
from .tokenizer import count_messages_tokens
from .concurrency import ConcurrencyManager
from .rate_limiter import GlobalRateLimiter, RateLimitConfig

log = logging.getLogger("surf.gateway.service")

# Environment configuration
OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "")
OPENROUTER_BASE_URL = os.environ.get("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")
GATEWAY_MARKUP = Decimal(os.environ.get("GATEWAY_MARKUP", "1.20"))
GATEWAY_STARTING_CREDIT = Decimal(os.environ.get("GATEWAY_STARTING_CREDIT", "0"))
GATEWAY_SYSTEM_PROMPT = os.environ.get("GATEWAY_SYSTEM_PROMPT", "You are a helpful assistant.")
PRICING_SYNC_SECONDS = int(os.environ.get("PRICING_SYNC_SECONDS", "21600"))  # 6 hours


class GatewayService:
    """Main gateway service orchestrating the chat request flow."""

    def __init__(
        self,
        store: PostgresGatewayStore | MemoryGatewayStore,
        http_client: httpx.AsyncClient,
        openrouter_api_key: str = OPENROUTER_API_KEY,
        openrouter_base_url: str = OPENROUTER_BASE_URL,
        markup: Decimal = GATEWAY_MARKUP,
        starting_credit: Decimal = GATEWAY_STARTING_CREDIT,
        system_prompt: str = GATEWAY_SYSTEM_PROMPT,
        max_concurrent_per_user: int = 1,
        max_requests_per_second: float = 50.0,
        max_concurrent_requests: int = 100,
    ):
        self.store = store
        self.http_client = http_client
        self.openrouter_api_key = openrouter_api_key
        self.openrouter_base_url = openrouter_base_url.rstrip("/")
        self.markup = markup
        self.starting_credit = starting_credit
        self.system_prompt = system_prompt
        self._pricing_sync_task: asyncio.Task | None = None
        
        # Per-user concurrency management
        self.concurrency = ConcurrencyManager(max_concurrent_per_user=max_concurrent_per_user)
        
        # Global rate limiting (protects OpenRouter API)
        rate_limit_config = RateLimitConfig(
            max_requests_per_second=max_requests_per_second,
            max_concurrent_requests=max_concurrent_requests,
        )
        self.rate_limiter = GlobalRateLimiter(rate_limit_config)

    async def start(self) -> None:
        """Start background tasks (pricing sync, concurrency manager, rate limiter)."""
        if not self.openrouter_api_key:
            log.warning("OPENROUTER_API_KEY not set; gateway will not work")
            return
        
        # Start concurrency manager
        await self.concurrency.start()
        
        # Start global rate limiter
        await self.rate_limiter.start()
        
        if PRICING_SYNC_SECONDS > 0:
            self._pricing_sync_task = asyncio.create_task(
                pricing_sync_loop(
                    self.store,
                    self.http_client,
                    PRICING_SYNC_SECONDS,
                    f"{self.openrouter_base_url}/models",
                )
            )
            log.info("pricing sync started (interval=%ds)", PRICING_SYNC_SECONDS)

    async def stop(self) -> None:
        """Stop background tasks."""
        # Stop rate limiter
        await self.rate_limiter.stop()
        
        # Stop concurrency manager
        await self.concurrency.stop()
        
        if self._pricing_sync_task:
            self._pricing_sync_task.cancel()
            try:
                await self._pricing_sync_task
            except asyncio.CancelledError:
                pass
            log.info("pricing sync stopped")

    def prepare_messages(self, new_prompt: str) -> list[dict[str, str]]:
        """Build the message array for a single turn.

        Chat history lives on the device (product rule): the gateway no longer
        stores or replays past messages. Multi-turn history will be sent by the
        client with each request (desktop chat rewire, Items 13/15).

        Args:
            new_prompt: New user message

        Returns:
            [system, user] — the turn to send upstream
        """
        return [
            {"role": "system", "content": self.system_prompt},
            {"role": "user", "content": new_prompt},
        ]

    async def call_openrouter(
        self,
        user_id: str,
        request_id: str,
        model: str,
        messages: list[dict[str, str]],
        max_tokens: int,
        stream: bool = False,
    ) -> dict[str, Any]:
        """Call OpenRouter API (non-streaming) with rate limiting.
        
        Args:
            user_id: User ID for rate limiting
            request_id: Unique request ID for tracking
            model: Model ID
            messages: Message array
            max_tokens: Maximum output tokens
            stream: Whether to stream response (not used here)
            
        Returns:
            Response dict
        """
        if not self.openrouter_api_key:
            raise HTTPException(status_code=503, detail=NOT_CONFIGURED)
        
        payload = {
            "model": model,
            "messages": messages,
            "max_tokens": max_tokens,
            "stream": False,
        }
        
        headers = {
            "Authorization": f"Bearer {self.openrouter_api_key}",
            "Content-Type": "application/json",
        }
        
        # Acquire rate limiter permission
        async with self.rate_limiter.acquire(user_id, request_id):
            try:
                response = await self.http_client.post(
                    f"{self.openrouter_base_url}/chat/completions",
                    json=payload,
                    headers=headers,
                    timeout=60.0,
                )
                response.raise_for_status()
                self.rate_limiter.record_success()
                return response.json()
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code == 429:
                    # Rate limited by OpenRouter
                    self.rate_limiter.record_rate_limit_error()
                    log.warning("OpenRouter rate limit hit for user=%s", user_id)
                else:
                    self.concurrency.circuit_breaker.record_failure()
                raise_mapped(exc)
            except httpx.HTTPError as exc:
                self.concurrency.circuit_breaker.record_failure()
                raise_mapped(exc)

    async def stream_openrouter(
        self,
        user_id: str,
        request_id: str,
        model: str,
        messages: list[dict[str, str]],
        max_tokens: int,
    ) -> AsyncIterator[str]:
        """Stream SSE response from OpenRouter with rate limiting.
        
        Args:
            user_id: User ID for rate limiting
            request_id: Unique request ID for tracking
            model: Model ID
            messages: Message array
            max_tokens: Maximum output tokens
            
        Yields:
            SSE data chunks
        """
        if not self.openrouter_api_key:
            raise HTTPException(status_code=503, detail=NOT_CONFIGURED)
        
        payload = {
            "model": model,
            "messages": messages,
            "max_tokens": max_tokens,
            "stream": True,
        }
        
        headers = {
            "Authorization": f"Bearer {self.openrouter_api_key}",
            "Content-Type": "application/json",
        }
        
        # Acquire rate limiter permission
        async with self.rate_limiter.acquire(user_id, request_id):
            try:
                async with self.http_client.stream(
                    "POST",
                    f"{self.openrouter_base_url}/chat/completions",
                    json=payload,
                    headers=headers,
                    timeout=60.0,
                ) as response:
                    response.raise_for_status()
                    self.rate_limiter.record_success()
                    async for line in response.aiter_lines():
                        if line.startswith("data: "):
                            yield line[6:]
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code == 429:
                    self.rate_limiter.record_rate_limit_error()
                    log.warning("OpenRouter rate limit hit for user=%s", user_id)
                else:
                    self.concurrency.circuit_breaker.record_failure()
                raise_mapped(exc)
            except httpx.HTTPError as exc:
                self.concurrency.circuit_breaker.record_failure()
                raise_mapped(exc)

    async def handle_chat_request(
        self,
        user_id: str,
        model: str,
        prompt: str,
        stream: bool = False,
    ) -> dict[str, Any] | AsyncIterator[str]:
        """Handle complete chat request flow.
        
        Flow:
        1. Acquire per-user concurrency lock
        2. Ensure gateway account exists
        3. Check if account is locked
        4. Get model pricing
        5. Build this turn's messages (history stays on the device)
        6. Pre-flight check (token count, cost, max_tokens)
        7. Call OpenRouter (with circuit breaker)
        8. Post-flight billing
        9. Return response
        
        Args:
            user_id: User ID from JWT
            model: Model ID
            prompt: User's prompt
            stream: Whether to stream response
            
        Returns:
            Response dict or SSE stream
            
        Raises:
            HTTPException: On various errors
        """
        # 1. Acquire per-user concurrency lock
        try:
            async with self.concurrency.user_scope(user_id):
                return await self._handle_chat_request_internal(
                    user_id=user_id,
                    model=model,
                    prompt=prompt,
                    stream=stream,
                )
        except asyncio.TimeoutError:
            raise HTTPException(
                status_code=429,
                detail="Too many concurrent requests. Please wait for your previous request to complete.",
            )
    
    async def _handle_chat_request_internal(
        self,
        user_id: str,
        model: str,
        prompt: str,
        stream: bool = False,
    ) -> dict[str, Any] | AsyncIterator[str]:
        """Internal implementation of handle_chat_request (called with concurrency lock held)."""
        # 2. Ensure gateway account exists
        await self.store.ensure_gateway_account(user_id, self.starting_credit)
        
        # 3. Check if account is locked
        balance_info = await self.store.get_user_balance(user_id)
        if not balance_info:
            raise HTTPException(status_code=500, detail="Failed to get user balance")
        
        balance, billing_locked = balance_info
        if billing_locked:
            raise HTTPException(status_code=402, detail=INSUFFICIENT_CREDITS)
        
        # 4. Enforce curated model allowlist (blocks free / non-permitted models)
        if not is_allowed(model):
            raise HTTPException(status_code=400, detail=f"Model not permitted: {model}")

        # 5. Get model pricing
        pricing = await self.store.get_model_pricing(model)
        if not pricing:
            raise HTTPException(status_code=400, detail=f"Unknown model: {model}")
        
        # 5. Build this turn's messages (single turn; history is on the device)
        messages = self.prepare_messages(prompt)
        
        # 6. Pre-flight check
        try:
            buffered_tokens, max_tokens, estimated_cost = preflight_check(
                messages=messages,
                balance=balance,
                input_price_per_million=pricing["input_price_per_million"],
                output_price_per_million=pricing["output_price_per_million"],
                context_window=pricing["context_window"],
            )
        except InsufficientBalanceError as exc:
            raise HTTPException(
                status_code=402,
                detail=INSUFFICIENT_CREDITS,
            )
        
        log.info(
            "user=%s model=%s tokens=%d max_tokens=%d estimated_cost=$%.6f",
            user_id,
            model,
            buffered_tokens,
            max_tokens,
            estimated_cost,
        )
        
        # 7. Call OpenRouter (with circuit breaker and rate limiting)
        if not self.concurrency.circuit_breaker.can_execute():
            raise HTTPException(
                status_code=503,
                detail="Service temporarily unavailable. Please try again later.",
            )
        
        import uuid
        request_id = str(uuid.uuid4())
        
        if stream:
            return self._handle_streaming_response(
                user_id=user_id,
                request_id=request_id,
                model=model,
                messages=messages,
                max_tokens=max_tokens,
                balance_before=balance,
            )
        else:
            response = await self.call_openrouter(
                user_id=user_id,
                request_id=request_id,
                model=model,
                messages=messages,
                max_tokens=max_tokens,
                stream=False,
            )
            # Success already recorded in call_openrouter
            
            # 8. Post-flight billing
            billing_result = await settle_billing(
                store=self.store,
                user_id=user_id,
                model_id=model,
                response=response,
                markup_multiplier=self.markup,
                balance_before=balance,
            )
            
            # No message storage: chat history stays on the device (product rule).
            # 9. Return response with billing info
            result = response.copy()
            result["billing"] = billing_result
            return result

    async def _handle_streaming_response(
        self,
        user_id: str,
        request_id: str,
        model: str,
        messages: list[dict[str, str]],
        max_tokens: int,
        balance_before: Decimal,
    ) -> AsyncIterator[str]:
        """Handle streaming response with billing. Messages are not stored."""
        # Collect the full response for billing
        full_content = []
        usage_info = {"prompt_tokens": 0, "completion_tokens": 0}
        
        try:
            stream = self.stream_openrouter(user_id, request_id, model, messages, max_tokens)
            completion_count = 0
            
            async for chunk_data in stream:
                if chunk_data == "[DONE]":
                    yield "data: [DONE]\n\n"
                    break
                
                try:
                    chunk = json.loads(chunk_data)
                except json.JSONDecodeError:
                    yield f"data: {chunk_data}\n\n"
                    continue
                
                # Track completion tokens
                if "choices" in chunk and chunk["choices"]:
                    delta = chunk["choices"][0].get("delta", {})
                    if "content" in delta:
                        full_content.append(delta["content"])
                        completion_count += 1
                
                # Track usage if provided
                if "usage" in chunk:
                    usage_info.update(chunk["usage"])
                
                # Sever stream if max_tokens reached
                if completion_count >= max_tokens:
                    yield f"data: {json.dumps({'choices': [{'finish_reason': 'length'}]})}\n\n"
                    break
                
                yield f"data: {chunk_data}\n\n"
            
            # Post-flight billing after stream completes
            if full_content:
                # Estimate usage if not provided
                if usage_info["completion_tokens"] == 0:
                    usage_info["completion_tokens"] = completion_count
                if usage_info["prompt_tokens"] == 0:
                    usage_info["prompt_tokens"] = count_messages_tokens(messages)
                
                # Create synthetic response for billing
                synthetic_response = {
                    "choices": [{"message": {"content": "".join(full_content)}}],
                    "usage": usage_info,
                }
                
                billing_result = await settle_billing(
                    store=self.store,
                    user_id=user_id,
                    model_id=model,
                    response=synthetic_response,
                    markup_multiplier=self.markup,
                    balance_before=balance_before,
                )
                
                # No message storage: chat history stays on the device (product rule).
                # Send billing info as final chunk
                yield f"data: {json.dumps({'billing': billing_result})}\n\n"
                
        except Exception as exc:
            log.error("streaming failed for user=%s: %s", user_id, exc)
            code = "rate_limited" if isinstance(exc, HTTPException) and exc.status_code == 429 else "gateway_error"
            yield f"data: {json.dumps({'error': {'code': code, 'message': user_facing_message(exc)}})}\n\n"
