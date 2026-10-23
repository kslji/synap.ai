"""Core gateway service: orchestrates the complete chat request flow."""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import os
from decimal import Decimal
from typing import Any, AsyncIterator, Awaitable, Callable

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

# OpenRouter's abuse tracking wants a stable, opaque `user` key. We send an HMAC of
# the internal user id, never the id itself and never the email. The key is a
# dedicated secret when provided, otherwise the deployment's JWT signing secret.
OPENROUTER_USER_HASH_KEY = os.environ.get("OPENROUTER_USER_HASH_KEY", "") or os.environ.get("JWT_SECRET", "")

# One cross-provider default used as the last fallback for every request, plus a
# preferred same-provider fallback so a model can usually fail over within its family.
# All slugs here are on the curated allowlist; a fallback only lands where it is allowed.
OPENROUTER_DEFAULT_FALLBACK = "openai/gpt-4.1"
PROVIDER_FALLBACK: dict[str, str] = {
    "openai": "openai/gpt-5-mini",
    "anthropic": "anthropic/claude-sonnet-4.5",
    "google": "google/gemini-2.5-flash",
}


def sse_frame(payload: Any) -> str:
    """One SSE `data:` frame.

    The terminal billing chunk carries Decimal amounts, which plain json.dumps
    rejects - and the whole stream would then end in an error event instead of the
    billing the device needs. Decimal goes out as a number, anything else as text.
    """
    return f"data: {json.dumps(payload, default=_json_default)}\n\n"


def _json_default(value: Any) -> Any:
    if isinstance(value, Decimal):
        return float(value)
    return str(value)


def countable_messages(
    messages: list[dict[str, Any]],
    extra: dict[str, Any] | None = None,
) -> list[dict[str, str]]:
    """A billing view of one agent turn.

    The pre-flight token count only sees `content`, but an agent turn also spends
    prompt tokens on its tool schemas, on assistant `tool_calls` (whose content is
    often empty) and on the tool results replayed back. Folding those into the
    counted text keeps the estimate honest, so a tool-heavy turn cannot slip past
    the balance check.

    A plain [system, user] chat turn counts exactly as it did before.
    """
    counted: list[dict[str, str]] = []
    for message in messages:
        content = message.get("content")
        if content is None:
            text = ""
        elif isinstance(content, str):
            text = content
        else:
            text = json.dumps(content)
        tool_calls = message.get("tool_calls")
        if tool_calls:
            text = f"{text}\n{json.dumps(tool_calls)}".strip()
        counted.append({"role": message.get("role", "user"), "content": text})
    tools = (extra or {}).get("tools")
    if tools:
        counted.append({"role": "system", "content": json.dumps(tools)})
    return counted


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
        # Keyed at construction so a deployment can rotate the secret independently.
        self.user_hash_key = (
            os.environ.get("OPENROUTER_USER_HASH_KEY", "") or os.environ.get("JWT_SECRET", "")
        ).encode()
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

    def openrouter_user(self, user_id: str) -> str:
        """A stable, opaque OpenRouter `user` key: HMAC-SHA256 of the internal id.

        Never the email and never the raw id - the provider only needs a value it can
        spot repeat abuse against, and this is irreversible without the server secret.
        """
        return hmac.new(self.user_hash_key, user_id.encode(), hashlib.sha256).hexdigest()

    def model_fallbacks(self, model: str) -> list[str]:
        """The ordered `models` list: the chosen model, a same-provider fallback, the default.

        Duplicates and the primary are removed from the tail; a fallback is only kept if
        it is on the allowlist, so a request can never be routed to a blocked model.
        """
        same_provider = PROVIDER_FALLBACK.get(model.split("/", 1)[0])
        out = [model]
        for candidate in (same_provider, OPENROUTER_DEFAULT_FALLBACK):
            if candidate and candidate != model and candidate not in out and is_allowed(candidate):
                out.append(candidate)
        return out

    async def billed_model(self, requested: str, response_model: str | None) -> str:
        """The model to charge for: the one that actually answered, if we price it.

        A fallback can return a different slug than the one pre-flight priced. Bill the
        returned model when its pricing is known; otherwise keep the requested model so
        an unrecognised reply never crashes billing.
        """
        if response_model and response_model != requested:
            if await self.store.get_model_pricing(response_model):
                return response_model
        return requested

    async def call_openrouter(
        self,
        user_id: str,
        request_id: str,
        model: str,
        messages: list[dict[str, str]],
        max_tokens: int,
        stream: bool = False,
        extra_payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Call OpenRouter API (non-streaming) with rate limiting.
        
        Args:
            user_id: User ID for rate limiting
            request_id: Unique request ID for tracking
            model: Model ID
            messages: Message array
            max_tokens: Maximum output tokens
            stream: Whether to stream response (not used here)
            extra_payload: Optional provider fields forwarded verbatim
                (tools / response_format / grammar) for the agent endpoint
            
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
            "user": self.openrouter_user(user_id),
            "models": self.model_fallbacks(model),
            **(extra_payload or {}),
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
        extra_payload: dict[str, Any] | None = None,
    ) -> AsyncIterator[str]:
        """Stream SSE response from OpenRouter with rate limiting.
        
        Args:
            user_id: User ID for rate limiting
            request_id: Unique request ID for tracking
            model: Model ID
            messages: Message array
            max_tokens: Maximum output tokens
            extra_payload: Optional provider fields forwarded verbatim
                (tools / response_format / grammar) for the agent endpoint
            
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
            "user": self.openrouter_user(user_id),
            "models": self.model_fallbacks(model),
            **(extra_payload or {}),
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
        return await self._with_user_lock(
            user_id,
            lambda: self._handle_request(
                user_id=user_id,
                model=model,
                messages=self.prepare_messages(prompt),
                stream=stream,
            ),
        )

    async def handle_agent_completion(
        self,
        user_id: str,
        model: str,
        messages: list[dict[str, Any]],
        stream: bool = True,
        tools: list[dict[str, Any]] | None = None,
        response_format: dict[str, Any] | None = None,
        grammar: str | None = None,
        max_tokens: int | None = None,
    ) -> dict[str, Any] | AsyncIterator[str]:
        """Handle one stateless agent turn proposed by the device's agent loop.

        Same guards as handle_chat_request (account, 402, allowlist, pricing,
        pre-flight, circuit breaker, billing), but the caller supplies the whole
        message array plus the tool/constraint fields, which are forwarded to the
        provider. Nothing is persisted: the agent's history stays on the device
        (product rule), so this endpoint is a pure transport.

        Args:
            user_id: User ID from JWT
            model: Model ID
            messages: The turn's messages, in order, as the loop built them
            stream: Whether to stream the response
            tools: Native tool schemas (OpenAI format) to forward
            response_format: json_schema constraint to forward
            grammar: GBNF grammar to forward (the loop's last fallback rung)
            max_tokens: Client's requested cap, clamped to what the balance affords
        """
        extra: dict[str, Any] = {}
        if tools:
            extra["tools"] = tools
        if response_format:
            extra["response_format"] = response_format
        if grammar:
            extra["grammar"] = grammar
        return await self._with_user_lock(
            user_id,
            lambda: self._handle_request(
                user_id=user_id,
                model=model,
                messages=messages,
                stream=stream,
                extra_payload=extra,
                client_max_tokens=max_tokens,
            ),
        )

    async def _with_user_lock(
        self,
        user_id: str,
        run: Callable[[], Awaitable[Any]],
    ) -> Any:
        """Run one request under the per-user concurrency lock."""
        try:
            async with self.concurrency.user_scope(user_id):
                return await run()
        except asyncio.TimeoutError:
            raise HTTPException(
                status_code=429,
                detail="Too many concurrent requests. Please wait for your previous request to complete.",
            )

    async def _handle_request(
        self,
        user_id: str,
        model: str,
        messages: list[dict[str, Any]],
        stream: bool = False,
        extra_payload: dict[str, Any] | None = None,
        client_max_tokens: int | None = None,
    ) -> dict[str, Any] | AsyncIterator[str]:
        """Shared request body for the chat and agent endpoints (lock held)."""
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
        
        # 6. Pre-flight check. Tool schemas and assistant tool_calls are part of the
        # prompt too, so they are counted even though their `content` is empty.
        try:
            buffered_tokens, max_tokens, estimated_cost = preflight_check(
                messages=countable_messages(messages, extra_payload),
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

        if client_max_tokens:
            max_tokens = min(max_tokens, client_max_tokens) if max_tokens else client_max_tokens
        
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
                extra_payload=extra_payload,
            )
        else:
            response = await self.call_openrouter(
                user_id=user_id,
                request_id=request_id,
                model=model,
                messages=messages,
                max_tokens=max_tokens,
                stream=False,
                extra_payload=extra_payload,
            )
            # Success already recorded in call_openrouter
            
            # 8. Post-flight billing on the model that actually answered (a fallback
            # can differ from the one pre-flight priced).
            billing_result = await settle_billing(
                store=self.store,
                user_id=user_id,
                model_id=await self.billed_model(model, response.get("model")),
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
        messages: list[dict[str, Any]],
        max_tokens: int,
        balance_before: Decimal,
        extra_payload: dict[str, Any] | None = None,
    ) -> AsyncIterator[str]:
        """Handle streaming response with billing. Messages are not stored.

        Every upstream chunk is forwarded verbatim, so content deltas and native
        tool-call deltas reach the client unchanged; the device assembles them.
        """
        # Collect the full response for billing
        full_content = []
        tool_call_seen = False
        returned_model: str | None = None
        usage_info = {"prompt_tokens": 0, "completion_tokens": 0}
        
        try:
            stream = self.stream_openrouter(user_id, request_id, model, messages, max_tokens, extra_payload)
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
                    # An agent turn that only calls tools has no content to bill on.
                    if delta.get("tool_calls"):
                        tool_call_seen = True
                
                # The provider names the model that answered - a fallback differs
                # from the requested slug, and billing must follow the real one.
                if isinstance(chunk.get("model"), str):
                    returned_model = chunk["model"]

                # Track usage if provided
                if "usage" in chunk:
                    usage_info.update(chunk["usage"])
                
                # Sever stream if max_tokens reached
                if completion_count >= max_tokens:
                    yield sse_frame({"choices": [{"finish_reason": "length"}]})
                    break
                
                yield f"data: {chunk_data}\n\n"
            
            # Post-flight billing after stream completes
            if full_content or tool_call_seen:
                # Estimate usage if not provided
                if usage_info["completion_tokens"] == 0:
                    usage_info["completion_tokens"] = completion_count
                if usage_info["prompt_tokens"] == 0:
                    usage_info["prompt_tokens"] = count_messages_tokens(countable_messages(messages, extra_payload))
                
                # Create synthetic response for billing
                synthetic_response = {
                    "choices": [{"message": {"content": "".join(full_content)}}],
                    "usage": usage_info,
                }
                
                billing_result = await settle_billing(
                    store=self.store,
                    user_id=user_id,
                    model_id=await self.billed_model(model, returned_model),
                    response=synthetic_response,
                    markup_multiplier=self.markup,
                    balance_before=balance_before,
                )
                
                # No message storage: chat history stays on the device (product rule).
                # Send billing info as final chunk
                yield sse_frame({"billing": billing_result})
                
        except Exception as exc:
            log.error("streaming failed for user=%s: %s", user_id, exc)
            code = "rate_limited" if isinstance(exc, HTTPException) and exc.status_code == 429 else "gateway_error"
            yield sse_frame({"error": {"code": code, "message": user_facing_message(exc)}})
