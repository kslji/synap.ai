"""Item 5: gateway/provider errors are mapped to clean, user-facing messages.

A bad or failed provider key must never surface an opaque 500 or leak the
provider's response body to the client — on the non-streaming path it becomes a
typed HTTP error, and on the streaming path it becomes an SSE error event with a
safe message.
"""
from __future__ import annotations

import json
import uuid
from decimal import Decimal
from typing import AsyncIterator, cast
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import HTTPException

from app.gateway.errors import (
    GATEWAY_UNAVAILABLE,
    INSUFFICIENT_CREDITS,
    NOT_CONFIGURED,
    RATE_LIMITED,
    map_provider_error,
    raise_mapped,
    user_facing_message,
)
from app.gateway.service import GatewayService
from app.gateway.store import MemoryGatewayStore

LEAKY_BODY = '{"error":{"message":"Invalid API key sk-or-SECRET-12345 quota exceeded"}}'


def _status_error(status: int, body: str = LEAKY_BODY, headers: dict | None = None) -> httpx.HTTPStatusError:
    request = httpx.Request("POST", "https://test.openrouter.ai/api/v1/chat/completions")
    response = httpx.Response(status, headers=headers or {}, request=request)
    response._content = body.encode()
    return httpx.HTTPStatusError("provider failed", request=request, response=response)


def test_provider_auth_failure_maps_to_clean_503():
    # A bad/expired master key must not surface as a raw 500 or leak the provider body.
    exc = map_provider_error(_status_error(401))
    assert exc.status_code == 503
    assert exc.detail == GATEWAY_UNAVAILABLE
    assert "sk-or" not in exc.detail and "SECRET" not in exc.detail


def test_provider_balance_maps_to_402():
    assert map_provider_error(_status_error(402)).status_code == 402
    assert map_provider_error(_status_error(402)).detail == INSUFFICIENT_CREDITS


def test_provider_rate_limit_maps_to_429_with_retry_after():
    exc = map_provider_error(_status_error(429, headers={"retry-after": "7"}))
    assert exc.status_code == 429
    assert exc.detail == RATE_LIMITED
    assert exc.headers == {"Retry-After": "7"}


def test_upstream_5xx_maps_to_bad_gateway_unavailable():
    exc = map_provider_error(_status_error(503))
    assert exc.status_code == 502
    assert exc.detail == GATEWAY_UNAVAILABLE


def test_timeout_and_transport_map_cleanly():
    assert map_provider_error(httpx.ConnectTimeout("t")).status_code == 504
    assert map_provider_error(httpx.ConnectError("boom")).status_code == 502


def test_raise_mapped_does_not_chain_the_raw_exception():
    raw = _status_error(401)
    with pytest.raises(HTTPException) as exc_info:
        raise_mapped(raw)
    assert exc_info.value.status_code == 503
    # Chained from None, so the provider body isn't attached to the raised error.
    assert exc_info.value.__cause__ is None


def test_user_facing_message_never_returns_raw_text():
    assert user_facing_message(HTTPException(429, RATE_LIMITED)) == RATE_LIMITED
    assert user_facing_message(ValueError("provider raw secret leak")) == GATEWAY_UNAVAILABLE


# --- Service integration -----------------------------------------------------

def _service_with_key(api_key: str = "test-key"):
    store = MemoryGatewayStore()
    user_id = str(uuid.uuid4())
    return store, user_id, api_key


def _fail_client(status: int) -> AsyncMock:
    client = AsyncMock()
    client.post = AsyncMock(side_effect=_status_error(status))
    return client


def _allowlisted_service(store, client, api_key):
    return GatewayService(
        store=store,
        http_client=client,
        openrouter_api_key=api_key,
        openrouter_base_url="https://test.openrouter.ai/api/v1",
    )


@pytest.mark.asyncio
async def test_missing_master_key_is_a_clean_503():
    store, user_id, _ = _service_with_key()
    await store.ensure_gateway_account(user_id, Decimal("2.00"))
    # gpt-4.1 is Tier 1; these cases exercise the upstream error mapping, so the
    # account just needs the tier that lets the request reach the provider call.
    store.gateway_accounts[user_id]["max_topup_credits"] = 25
    await store.upsert_model_pricing("openai/gpt-4.1", Decimal("1.00"), Decimal("2.00"), 4096)
    service = _allowlisted_service(store, _fail_client(401), api_key="")
    with pytest.raises(HTTPException) as exc_info:
        await service.handle_chat_request(user_id=user_id, model="openai/gpt-4.1", prompt="Hello", stream=False)
    assert exc_info.value.status_code == 503
    assert exc_info.value.detail == NOT_CONFIGURED


@pytest.mark.asyncio
async def test_bad_provider_key_surfaces_clean_error_not_500():
    store, user_id, _ = _service_with_key()
    await store.ensure_gateway_account(user_id, Decimal("2.00"))
    # gpt-4.1 is Tier 1; these cases exercise the upstream error mapping, so the
    # account just needs the tier that lets the request reach the provider call.
    store.gateway_accounts[user_id]["max_topup_credits"] = 25
    await store.upsert_model_pricing("openai/gpt-4.1", Decimal("1.00"), Decimal("2.00"), 4096)
    service = _allowlisted_service(store, _fail_client(401), api_key="test-key")
    with pytest.raises(HTTPException) as exc_info:
        await service.handle_chat_request(user_id=user_id, model="openai/gpt-4.1", prompt="Hello", stream=False)
    assert exc_info.value.status_code == 503
    assert exc_info.value.detail == GATEWAY_UNAVAILABLE
    assert "SECRET" not in exc_info.value.detail and "sk-or" not in exc_info.value.detail


@pytest.mark.asyncio
async def test_streaming_error_event_is_clean():
    store, user_id, _ = _service_with_key()
    await store.ensure_gateway_account(user_id, Decimal("2.00"))
    # gpt-4.1 is Tier 1; these cases exercise the upstream error mapping, so the
    # account just needs the tier that lets the request reach the provider call.
    store.gateway_accounts[user_id]["max_topup_credits"] = 25
    await store.upsert_model_pricing("openai/gpt-4.1", Decimal("1.00"), Decimal("2.00"), 4096)
    service = _allowlisted_service(store, _fail_client(401), api_key="test-key")
    gen = cast(AsyncIterator[str], await service.handle_chat_request(user_id=user_id, model="openai/gpt-4.1", prompt="Hello", stream=True))
    events = [frame async for frame in gen]
    payload = events[-1][len("data: "):].strip()
    parsed = json.loads(payload)
    assert "error" in parsed
    assert parsed["error"]["message"] == GATEWAY_UNAVAILABLE
    assert "SECRET" not in payload and "sk-or" not in payload
