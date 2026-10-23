"""Item 14: the gateway identifies a user to OpenRouter by a hash, and names fallbacks.

Two upstream fields are added to every OpenRouter request the gateway makes:

  * `user`   - a stable, opaque HMAC-SHA256 of the internal user id. Never the email,
               never the raw id: OpenRouter only needs a key it can spot abuse with.
  * `models` - an ordered fallback list so one provider outage does not fail the turn:
               the chosen model first, then a same-provider model, then a cross-provider
               default. Every entry is on the curated allowlist.

And because a fallback means the reply may come from a different model than the one
priced in pre-flight, billing settles on the model the provider actually returned.

Everything here runs against the in-memory store with a mocked transport: no network.
"""
from __future__ import annotations

import hashlib
import hmac
import os
import uuid
from decimal import Decimal
from typing import Any, cast
from unittest.mock import MagicMock

import pytest

# The user-id hash is keyed with the deployment secret; set it before importing the
# service so this file passes standalone, not only when an earlier test set it.
os.environ.setdefault("JWT_SECRET", "test-secret-test-secret-test-secret-ok")

from app.gateway.model_allowlist import is_allowed  # noqa: E402
from app.gateway.service import GatewayService  # noqa: E402
from app.gateway.store import MemoryGatewayStore  # noqa: E402


# --- transport fakes ----------------------------------------------------------


def _json_client(response_payload: dict[str, Any]) -> tuple[Any, dict[str, Any]]:
    """A non-streaming client that records the outbound OpenRouter payload."""
    sink: dict[str, Any] = {}
    response = MagicMock()
    response.json.return_value = response_payload
    response.raise_for_status = MagicMock()

    async def post(url: str, json: dict[str, Any] | None = None, headers=None, timeout=None):
        sink["payload"] = json
        return response

    return MagicMock(post=post), sink


class _StreamResponse:
    def __init__(self, lines: list[str]):
        self._lines = lines

    def raise_for_status(self) -> None:
        return None

    async def aiter_lines(self):
        for line in self._lines:
            yield line


class _StreamCall:
    def __init__(self, response: _StreamResponse):
        self._response = response

    async def __aenter__(self) -> _StreamResponse:
        return self._response

    async def __aexit__(self, *_exc: object) -> bool:
        return False


def _stream_client(lines: list[str]) -> tuple[Any, dict[str, Any]]:
    sink: dict[str, Any] = {}

    def stream(method: str, url: str, json: dict[str, Any] | None = None, headers=None, timeout=None):
        sink["payload"] = json
        return _StreamCall(_StreamResponse(lines))

    return MagicMock(stream=stream), sink


async def _funded(store: MemoryGatewayStore, user_id: str, priced: list[str]) -> None:
    await store.ensure_gateway_account(user_id, Decimal("5.00"))
    for mid in priced:
        await store.upsert_model_pricing(mid, Decimal("1.00"), Decimal("2.00"), 4096)


def _service(store: MemoryGatewayStore, client: Any) -> GatewayService:
    return GatewayService(
        store=store,
        http_client=client,
        openrouter_api_key="test-key",
        openrouter_base_url="https://test.openrouter.ai/api/v1",
    )


def _response(model: str) -> dict[str, Any]:
    return {
        "id": "resp-1",
        "model": model,
        "choices": [{"message": {"content": "hi"}}],
        "usage": {"prompt_tokens": 100, "completion_tokens": 50},
    }


# --- the hashed `user` field --------------------------------------------------


@pytest.mark.asyncio
async def test_openrouter_gets_a_hashed_user_not_the_email():
    store = MemoryGatewayStore()
    user_id = str(uuid.uuid4())
    await _funded(store, user_id, ["openai/gpt-4.1"])
    client, sink = _json_client(_response("openai/gpt-4.1"))
    service = _service(store, client)

    await service.handle_chat_request(user_id=user_id, model="openai/gpt-4.1", prompt="Hi", stream=False)

    sent_user = sink["payload"]["user"]
    assert sent_user != user_id, "the internal id is not forwarded raw"
    assert "@" not in sent_user, "an email fragment must never appear"
    assert len(sent_user) == 64, "HMAC-SHA256 hex digest"
    int(sent_user, 16)  # parses as hex

    key = os.environ["JWT_SECRET"].encode()
    assert sent_user == hmac.new(key, user_id.encode(), hashlib.sha256).hexdigest()


@pytest.mark.asyncio
async def test_user_hash_is_stable_per_user_and_distinct_across_users():
    store = MemoryGatewayStore()
    a, b = str(uuid.uuid4()), str(uuid.uuid4())
    await _funded(store, a, ["openai/gpt-4.1"])
    await _funded(store, b, ["openai/gpt-4.1"])

    seen: list[str] = []
    for user in (a, a, b):
        client, sink = _json_client(_response("openai/gpt-4.1"))
        await _service(store, client).handle_chat_request(user_id=user, model="openai/gpt-4.1", prompt="Hi", stream=False)
        seen.append(sink["payload"]["user"])

    assert seen[0] == seen[1], "the same user hashes the same every request"
    assert seen[0] != seen[2], "different users cannot collide"


# --- the `models` fallback list ----------------------------------------------


def _expected_fallbacks(model: str, same_provider: str | None, default: str) -> list[str]:
    out = [model]
    for cand in (same_provider, default):
        if cand and cand != model and cand not in out:
            out.append(cand)
    return out


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "model, same_provider",
    [
        ("anthropic/claude-opus-4.1", "anthropic/claude-sonnet-4.5"),
        ("openai/gpt-4.1", "openai/gpt-5-mini"),
        ("openai/gpt-5-mini", None),  # its own provider slot is itself -> skipped
        ("google/gemini-2.5-pro", "google/gemini-2.5-flash"),
        ("x-ai/grok-4", None),  # single-model provider -> only the default
    ],
)
async def test_models_field_leads_with_primary_then_fallbacks(model: str, same_provider: str | None):
    store = MemoryGatewayStore()
    user_id = str(uuid.uuid4())
    await _funded(store, user_id, [model])
    client, sink = _json_client(_response(model))
    service = _service(store, client)

    await service.handle_chat_request(user_id=user_id, model=model, prompt="Hi", stream=False)

    models = sink["payload"]["models"]
    assert models[0] == model, "the chosen model leads the list"
    assert len(models) == len(set(models)), "no duplicate slugs"
    assert all(is_allowed(m) for m in models), "fallbacks stay on the allowlist"
    assert models == _expected_fallbacks(model, same_provider, "openai/gpt-4.1")


# --- the fields reach both transports ----------------------------------------


@pytest.mark.asyncio
async def test_streaming_requests_carry_user_and_models():
    store = MemoryGatewayStore()
    user_id = str(uuid.uuid4())
    await _funded(store, user_id, ["openai/gpt-4.1"])
    lines = [
        "data: " + '{"model": "openai/gpt-4.1", "choices": [{"delta": {"content": "yo"}}]}' + "\n\n",
        "data: [DONE]\n\n",
    ]
    client, sink = _stream_client(lines)
    service = _service(store, client)

    stream = await service.handle_chat_request(user_id=user_id, model="openai/gpt-4.1", prompt="Hi", stream=True)
    async for _ in cast(Any, stream):  # stream=True returns an async iterator
        pass

    assert sink["payload"]["user"] != user_id and "@" not in sink["payload"]["user"]
    assert sink["payload"]["models"][0] == "openai/gpt-4.1"


# --- billing follows the model actually returned ------------------------------


@pytest.mark.asyncio
async def test_billing_settles_on_the_returned_fallback_model():
    requested, returned = "anthropic/claude-opus-4.1", "anthropic/claude-sonnet-4.5"
    store = MemoryGatewayStore()
    user_id = str(uuid.uuid4())
    await _funded(store, user_id, [requested, returned])
    # The returned model is priced higher, so billing it is a visible difference.
    await store.upsert_model_pricing(returned, Decimal("3.00"), Decimal("15.00"), 4096)
    client, _sink = _json_client(_response(returned))
    service = _service(store, client)

    await service.handle_chat_request(user_id=user_id, model=requested, prompt="Hi", stream=False)

    tx = store.billing_transactions[-1]
    assert tx["model_id"] == returned, "the model that answered is the one billed"
    assert tx["raw_cost"] == (Decimal(100) * Decimal("3.00") + Decimal(50) * Decimal("15.00")) / Decimal("1000000")


@pytest.mark.asyncio
async def test_billing_falls_back_to_requested_model_when_returned_is_unknown():
    requested = "openai/gpt-4.1"
    store = MemoryGatewayStore()
    user_id = str(uuid.uuid4())
    await _funded(store, user_id, [requested])
    client, _sink = _json_client(_response("openai/gpt-9-who-knows"))
    service = _service(store, client)

    await service.handle_chat_request(user_id=user_id, model=requested, prompt="Hi", stream=False)

    assert store.billing_transactions[-1]["model_id"] == requested, "an unpriced reply is still billed on the asked model"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
