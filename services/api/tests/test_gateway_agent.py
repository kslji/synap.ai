"""Shared Agent Core, Part 1: the stateless agent turn endpoint.

`POST /api/v1/agent/completions` lets the device's own agent loop drive a cloud
model: the client sends the whole message array plus the tool/constraint fields,
the gateway forwards them and streams the provider's chunks back untouched.

These tests pin the three things the desktop relies on:
  1. the guards are the same as /chat (401, 402, 429, allowlist) with the same copy,
  2. messages + tools + response_format + grammar are forwarded verbatim, in order,
  3. tool-call deltas stream through and a tool-only turn is still billed,
and that nothing is stored server-side: chat and agent history stays on the device.
"""
from __future__ import annotations

import json
import time
import uuid
from decimal import Decimal
from typing import Any, AsyncIterator, cast
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.gateway.errors import INSUFFICIENT_CREDITS
from app.gateway.service import GatewayService, countable_messages
from app.gateway.store import MemoryGatewayStore
from app.main import app
from app.tokens import issue_access_token

MODEL = "openai/gpt-4.1"

AGENT_MESSAGES: list[dict[str, Any]] = [
    {"role": "system", "content": "You are a code agent."},
    {"role": "user", "content": "bump n, then run tests"},
    {"role": "assistant", "content": None, "tool_calls": [
        {"id": "call_1", "type": "function", "function": {"name": "read_file", "arguments": '{"path":"src/a.ts"}'}},
    ]},
    {"role": "tool", "tool_call_id": "call_1", "content": "export const n = 1"},
]

TOOLS = [{"type": "function", "function": {"name": "propose_edit", "parameters": {"type": "object"}}}]
RESPONSE_FORMAT = {"type": "json_schema", "json_schema": {"name": "call", "strict": True, "schema": {}}}


def _service(store: MemoryGatewayStore, user_id: str, client: Any, api_key: str = "test-key") -> GatewayService:
    return GatewayService(
        store=store,
        http_client=client,
        openrouter_api_key=api_key,
        openrouter_base_url="https://test.openrouter.ai/api/v1",
    )


async def _funded_store(pricing: bool = True) -> tuple[MemoryGatewayStore, str]:
    store = MemoryGatewayStore()
    user_id = str(uuid.uuid4())
    await store.ensure_gateway_account(user_id, Decimal("2.00"))
    # This suite pins agent-endpoint mechanics (forwarding, streaming, guards), not
    # tiers. MODEL is Tier 1, so the account has to hold a matching purchase tier or
    # the ADR-0008 access gate answers before the request under test ever starts.
    store.gateway_accounts[user_id]["max_topup_credits"] = 25
    if pricing:
        await store.upsert_model_pricing(MODEL, Decimal("1.00"), Decimal("2.00"), 4096)
    return store, user_id


class _StreamResponse:
    """The slice of httpx.Response that stream_openrouter uses."""

    def __init__(self, lines: list[str]):
        self._lines = lines

    def raise_for_status(self) -> None:
        return None

    async def aiter_lines(self):
        for line in self._lines:
            yield line


class _StreamCall:
    def __init__(self, response: _StreamResponse, sink: dict[str, Any]):
        self._response = response
        self._sink = sink

    async def __aenter__(self) -> _StreamResponse:
        self._sink["calls"] = self._sink.get("calls", 0) + 1
        return self._response

    async def __aexit__(self, *_exc: object) -> bool:
        return False


def _stream_client(lines: list[str]) -> tuple[Any, dict[str, Any]]:
    sink: dict[str, Any] = {}
    response = _StreamResponse(lines)

    def stream(method: str, url: str, json: dict[str, Any] | None = None, headers: None = None, timeout: float | None = None):
        sink["payload"] = json
        sink["url"] = url
        return _StreamCall(response, sink)

    return MagicMock(stream=stream), sink


def _json_client(payload: dict[str, Any]) -> tuple[Any, dict[str, Any]]:
    sink: dict[str, Any] = {"calls": 0}
    response = MagicMock()
    response.json.return_value = payload
    response.raise_for_status = MagicMock()

    async def post(url: str, json: dict[str, Any] | None = None, headers: None = None, timeout: float | None = None):
        sink["calls"] += 1
        sink["payload"] = json
        sink["url"] = url
        return response

    return MagicMock(post=post), sink


def _frames(body: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for line in body.splitlines():
        if not line.startswith("data:"):
            continue
        payload = line[len("data:"):].strip()
        if payload and payload != "[DONE]":
            out.append(json.loads(payload))
    return out


def _billing(frames: list[dict[str, Any]]) -> dict[str, Any]:
    """The terminal billing chunk the gateway appends after [DONE]."""
    return next(frame["billing"] for frame in frames if "billing" in frame)


# --- Forwarding ---------------------------------------------------------------


@pytest.mark.asyncio
async def test_agent_turn_forwards_messages_and_constraint_fields():
    store, user_id = await _funded_store()
    client, sink = _json_client({
        "choices": [{"message": {"role": "assistant", "content": "ok", "tool_calls": []}}],
        "usage": {"prompt_tokens": 40, "completion_tokens": 8},
    })
    service = _service(store, user_id, client)

    result = await service.handle_agent_completion(
        user_id=user_id,
        model=MODEL,
        messages=AGENT_MESSAGES,
        stream=False,
        tools=TOOLS,
        response_format=RESPONSE_FORMAT,
        grammar="root ::= \"finish\"",
        max_tokens=300,
    )

    payload = sink["payload"]
    assert payload["messages"] == AGENT_MESSAGES, "the loop's message order must survive"
    assert payload["tools"] == TOOLS
    assert payload["response_format"] == RESPONSE_FORMAT
    assert payload["grammar"] == "root ::= \"finish\""
    assert payload["stream"] is False
    assert sink["url"].endswith("/chat/completions")
    # The client's cap is honoured but never raised above what the balance affords.
    assert 0 < payload["max_tokens"] <= 300
    assert isinstance(result, dict) and result["billing"]["output_tokens"] == 8


@pytest.mark.asyncio
async def test_agent_turn_omits_constraint_fields_that_were_not_sent():
    store, user_id = await _funded_store()
    client, sink = _json_client({"choices": [{"message": {"content": "hi"}}], "usage": {"prompt_tokens": 5, "completion_tokens": 2}})
    service = _service(store, user_id, client)

    await service.handle_agent_completion(user_id=user_id, model=MODEL, messages=AGENT_MESSAGES[:2], stream=False)

    assert "tools" not in sink["payload"]
    assert "response_format" not in sink["payload"]
    assert "grammar" not in sink["payload"]


# --- Streaming ----------------------------------------------------------------


@pytest.mark.asyncio
async def test_tool_call_deltas_stream_through_and_a_tool_only_turn_is_billed():
    store, user_id = await _funded_store()
    lines = [
        "data: " + json.dumps({"choices": [{"delta": {"role": "assistant", "tool_calls": [
            {"index": 0, "id": "call_1", "function": {"name": "propose_edit", "arguments": '{"path":"sr'}}]}}]}),
        "data: " + json.dumps({"choices": [{"delta": {"tool_calls": [
            {"index": 0, "function": {"arguments": 'c/a.ts","old":"n = 1","new":"n = 2"}'}}]}}]}),
        "data: " + json.dumps({"choices": [{"delta": {}, "finish_reason": "tool_calls"}], "usage": {"prompt_tokens": 30, "completion_tokens": 12}}),
        "data: [DONE]",
    ]
    client, sink = _stream_client(lines)
    service = _service(store, user_id, client)

    generator = cast(AsyncIterator[str], await service.handle_agent_completion(
        user_id=user_id, model=MODEL, messages=AGENT_MESSAGES, stream=True, tools=TOOLS,
    ))
    frames = _frames("".join([frame async for frame in generator]))

    # The provider's frames reach the device untouched, so the same delta assembly
    # the offline path uses produces the same tool call online.
    deltas = [c["choices"][0]["delta"] for c in frames if c.get("choices") and "delta" in c["choices"][0]]
    assembled = deltas[0]["tool_calls"][0]["function"]
    assert assembled["name"] == "propose_edit"
    assert assembled["arguments"] + deltas[1]["tool_calls"][0]["function"]["arguments"] == '{"path":"src/a.ts","old":"n = 1","new":"n = 2"}'
    finish = [f for f in frames if f.get("choices") and f["choices"][0].get("finish_reason")]
    assert finish[0]["choices"][0]["finish_reason"] == "tool_calls"
    # ...and the turn is billed even though it carried no prose at all.
    assert _billing(frames)["output_tokens"] == 12
    assert sink["payload"]["tools"] == TOOLS
    balance_info = await store.get_user_balance(user_id)
    assert balance_info is not None
    balance, _locked = balance_info
    assert balance < Decimal("2.00")


@pytest.mark.asyncio
async def test_content_deltas_still_stream_and_bill():
    store, user_id = await _funded_store()
    lines = [
        "data: " + json.dumps({"choices": [{"delta": {"content": "Hel"}}]}),
        "data: " + json.dumps({"choices": [{"delta": {"content": "lo"}}]}),
        "data: [DONE]",
    ]
    client, _sink = _stream_client(lines)
    service = _service(store, user_id, client)

    generator = cast(AsyncIterator[str], await service.handle_agent_completion(
        user_id=user_id, model=MODEL, messages=AGENT_MESSAGES[:2], stream=True,
    ))
    frames = _frames("".join([frame async for frame in generator]))
    text = "".join(c["choices"][0]["delta"].get("content", "") for c in frames if c.get("choices"))
    assert text == "Hello"
    assert _billing(frames)["output_tokens"] == 2


# --- Guards, shared with /chat -------------------------------------------------


@pytest.mark.asyncio
async def test_agent_turn_rejects_a_model_outside_the_allowlist():
    store, user_id = await _funded_store()
    client, sink = _json_client({"choices": [{"message": {"content": "hi"}}]})
    service = _service(store, user_id, client)
    with pytest.raises(HTTPException) as exc_info:
        await service.handle_agent_completion(
            user_id=user_id, model="meta/llama-3.1-8b-instruct:free", messages=AGENT_MESSAGES, stream=False,
        )
    assert exc_info.value.status_code == 400
    assert sink["calls"] == 0


@pytest.mark.asyncio
async def test_agent_turn_rejects_an_unknown_model():
    store, user_id = await _funded_store(pricing=False)
    client, _sink = _json_client({"choices": [{"message": {"content": "hi"}}]})
    service = _service(store, user_id, client)
    with pytest.raises(HTTPException) as exc_info:
        await service.handle_agent_completion(user_id=user_id, model=MODEL, messages=AGENT_MESSAGES, stream=False)
    assert exc_info.value.status_code == 400
    assert "Unknown model" in exc_info.value.detail


@pytest.mark.asyncio
async def test_locked_account_gets_the_same_402_copy_as_chat():
    store, user_id = await _funded_store()
    store.gateway_accounts[user_id]["billing_locked"] = True
    client, _sink = _json_client({"choices": [{"message": {"content": "hi"}}]})
    service = _service(store, user_id, client)
    with pytest.raises(HTTPException) as agent_exc:
        await service.handle_agent_completion(user_id=user_id, model=MODEL, messages=AGENT_MESSAGES, stream=False)
    with pytest.raises(HTTPException) as chat_exc:
        await service.handle_chat_request(user_id=user_id, model=MODEL, prompt="hi", stream=False)
    assert agent_exc.value.status_code == chat_exc.value.status_code == 402
    assert agent_exc.value.detail == chat_exc.value.detail == INSUFFICIENT_CREDITS


# --- The gateway stays stateless ----------------------------------------------


@pytest.mark.asyncio
async def test_no_server_side_history_accumulates_across_agent_turns():
    store, user_id = await _funded_store()
    client, sink = _json_client({"choices": [{"message": {"content": "ok"}}], "usage": {"prompt_tokens": 4, "completion_tokens": 2}})
    service = _service(store, user_id, client)

    first = [{"role": "user", "content": "one"}]
    second = [{"role": "user", "content": "one"}, {"role": "assistant", "content": "ok"}, {"role": "user", "content": "two"}]
    await service.handle_agent_completion(user_id=user_id, model=MODEL, messages=first, stream=False)
    await service.handle_agent_completion(user_id=user_id, model=MODEL, messages=second, stream=False)

    assert sink["payload"]["messages"] == second, "the endpoint replays nothing it stored"
    # Nothing in the store could replay it either.
    assert not any(hasattr(store, name) and "message" in name for name in vars(store))


def test_chat_path_is_unchanged_by_the_shared_request_body():
    """The [system, user] turn the single-endpoint used to build is byte-identical."""
    store = MemoryGatewayStore()
    service = GatewayService(
        store=store,
        http_client=MagicMock(),
        openrouter_api_key="test-key",
        openrouter_base_url="https://test.openrouter.ai/api/v1",
        system_prompt="You are a helpful assistant.",
    )
    turn = service.prepare_messages("Hello there")
    assert turn == [{"role": "system", "content": "You are a helpful assistant."}, {"role": "user", "content": "Hello there"}]
    # The billing view counts exactly the same text for a plain chat turn.
    assert countable_messages(turn) == turn


def test_countable_messages_folds_tools_and_tool_calls_into_the_count():
    plain = countable_messages(AGENT_MESSAGES[:2])
    assert [m["content"] for m in plain] == ["You are a code agent.", "bump n, then run tests"]

    counted = countable_messages(AGENT_MESSAGES, {"tools": TOOLS})
    assistant = counted[2]["content"]
    assert "read_file" in assistant, "an empty-content tool call still costs prompt tokens"
    assert counted[-1]["role"] == "system" and "propose_edit" in counted[-1]["content"]
    assert len(counted) == len(AGENT_MESSAGES) + 1


# --- Route wiring -------------------------------------------------------------


def _token(user_id: str) -> str:
    return issue_access_token("dev-1", user_id, "agent@example.com")["token"]


def test_agent_route_requires_authentication_like_chat():
    with TestClient(app) as client:
        for path in ("/api/v1/chat", "/api/v1/agent/completions"):
            body = {"model": MODEL, "prompt": "hi"} if path.endswith("/chat") else {"model": MODEL, "messages": AGENT_MESSAGES[:2]}
            assert client.post(path, json=body).status_code == 401


def test_agent_route_shares_the_chat_rate_limit_bucket(monkeypatch):
    import app.gateway.router as router_mod

    monkeypatch.setattr(router_mod, "CHAT_RATE_PER_MINUTE", 1)
    uid = f"user-agent-rl-{uuid.uuid4().hex[:8]}"
    with TestClient(app) as client:
        token = _token(uid)
        # Pre-seed the same bucket /chat uses, so the first guarded agent call trips.
        app.state.limiter._events[f"chat:user:{uid}"] = [int(time.time())]
        resp = client.post(
            "/api/v1/agent/completions",
            json={"model": MODEL, "messages": AGENT_MESSAGES[:2], "stream": False},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 429
        assert resp.headers.get("Retry-After")
        assert resp.json()["detail"] == "Too many requests. Please slow down."
        # The very same exhausted bucket blocks /chat with the identical copy.
        chat = client.post(
            "/api/v1/chat",
            json={"model": MODEL, "prompt": "hi", "stream": False},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert chat.status_code == 429
        assert chat.json()["detail"] == resp.json()["detail"]


def test_agent_route_locks_out_a_zero_balance_account_with_402():
    uid = f"user-agent-bill-{uuid.uuid4().hex[:8]}"
    with TestClient(app) as client:
        # The account is created by the request itself; lock it before sending.
        store = app.state.gateway.store
        store.gateway_accounts[uid] = {"user_id": uid, "balance": Decimal("0"), "billing_locked": True}
        resp = client.post(
            "/api/v1/agent/completions",
            json={"model": MODEL, "messages": AGENT_MESSAGES[:2], "stream": False},
            headers={"Authorization": f"Bearer {_token(uid)}"},
        )
        assert resp.status_code == 402
        assert resp.json()["detail"] == INSUFFICIENT_CREDITS


def test_agent_route_rejects_a_message_without_a_role():
    uid = f"user-agent-bad-{uuid.uuid4().hex[:8]}"
    with TestClient(app) as client:
        resp = client.post(
            "/api/v1/agent/completions",
            json={"model": MODEL, "messages": [{"content": "no role"}], "stream": False},
            headers={"Authorization": f"Bearer {_token(uid)}"},
        )
        assert resp.status_code == 422
