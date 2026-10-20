import asyncio
import logging
import os
from decimal import Decimal

os.environ.setdefault("JWT_SECRET", "test-secret-test-secret-test-secret-ok")
os.environ.setdefault("JWT_AUDIENCE", "authenticated")
os.environ["SURF_API_LITE"] = "1"
os.environ.pop("OPENROUTER_API_KEY", None)
os.environ["CHAT_PER_MIN"] = "1000"
os.environ["CHAT_PER_DAY"] = "1000"

from fastapi.testclient import TestClient  # noqa: E402

from app.gateway import billing  # noqa: E402
from app.gateway.billing import Pricing  # noqa: E402
from app.gateway.context import compile_messages, history_token_budget, system_prompt  # noqa: E402
from app.gateway.openrouter import OpenRouterClient, parse_models, sync_pricing  # noqa: E402
from app.gateway.service import prepare, settle  # noqa: E402
from app.gateway.store import MemoryGatewayStore  # noqa: E402
from app.gateway.tokens import count_messages, count_text  # noqa: E402
from app.main import app  # noqa: E402
from app.tokens import issue_access_token  # noqa: E402

SONNET = Pricing("anthropic/claude-3.5-sonnet", Decimal("3"), Decimal("15"), 200_000)
CHEAP = Pricing("test/cheap", Decimal("1.00"), Decimal("2.00"), 128_000)


class FakeOpenRouter(OpenRouterClient):
    def __init__(self, models: dict | None = None, usage: dict | None = None, reply: str = "Hello.", chunks: list[str] | None = None):
        super().__init__(http=None, api_key="test-master-key")
        self.calls: list[dict] = []
        self._models = models or {"data": []}
        self.usage = usage or {"prompt_tokens": 12, "completion_tokens": 3}
        self.reply = reply
        self.chunks = chunks or []

    async def models(self) -> dict:
        return self._models

    async def complete(self, payload: dict) -> dict:
        self.calls.append(payload)
        return {"id": "gen-1", "choices": [{"message": {"role": "assistant", "content": self.reply}}], "usage": self.usage}

    async def stream(self, payload: dict):
        self.calls.append(payload)
        for chunk in self.chunks:
            yield {"id": "gen-s", "choices": [{"delta": {"content": chunk}}]}
        yield {"id": "gen-s", "choices": [{"delta": {}}], "usage": self.usage}


def add_user(user_id: str) -> dict:
    email = f"{user_id}@example.com"
    app.state.auth.users[email] = {"id": user_id, "email": email, "plan_code": "pro"}
    app.state.auth.devices.append({"id": f"dev-{user_id}", "user_id": user_id, "status": "active"})
    token = issue_access_token(f"dev-{user_id}", user_id, email)["token"]
    return {"authorization": f"Bearer {token}"}


def run(coro):
    return asyncio.run(coro)


# Step 1 ---------------------------------------------------------------------

def test_step1_chat_needs_a_token_and_maps_it_to_the_user_id(caplog):
    with TestClient(app) as client:
        fake = FakeOpenRouter()
        app.state.openrouter = fake
        run(app.state.gateway.upsert_pricing([CHEAP]))
        run(app.state.gateway.set_balance("user_123", Decimal("2.00")))
        missing = client.post("/api/v1/chat", json={"model": CHEAP.model_id, "message": "hi"})
        assert missing.status_code == 401
        assert fake.calls == []
        headers = add_user("user_123")
        with caplog.at_level(logging.INFO, logger="surf.api"):
            ok = client.post("/api/v1/chat", headers=headers, json={"model": CHEAP.model_id, "message": "hi"})
        assert ok.status_code == 200, ok.text
        assert len(fake.calls) == 1
        assert any("user_id=user_123" in record.getMessage() for record in caplog.records)
        assert "hi" not in " ".join(record.getMessage() for record in caplog.records)
        stranger = issue_access_token("dev-user_123", "not-a-user", "x@example.com")["token"]
        assert client.post("/api/v1/chat", headers={"authorization": f"Bearer {stranger}"}, json={"model": CHEAP.model_id, "message": "hi"}).status_code == 401


# Step 2 ---------------------------------------------------------------------

def test_step2_each_payload_holds_only_that_users_history():
    store = MemoryGatewayStore()

    async def scenario():
        await store.upsert_pricing([CHEAP])
        await store.set_balance("user_A", Decimal("2"))
        await store.set_balance("user_B", Decimal("2"))
        for role, text in [("user", "A first"), ("assistant", "A reply"), ("user", "A second")]:
            await store.add_message("user_A", role, text)
        return await asyncio.gather(
            prepare(store, "user_A", CHEAP.model_id, "A new prompt", False),
            prepare(store, "user_B", CHEAP.model_id, "B new prompt", False),
        )

    a, b = run(scenario())
    system = {"role": "system", "content": system_prompt()}
    assert a.payload["messages"] == [
        system,
        {"role": "user", "content": "A first"},
        {"role": "assistant", "content": "A reply"},
        {"role": "user", "content": "A second"},
        {"role": "user", "content": "A new prompt"},
    ]
    assert b.payload["messages"] == [system, {"role": "user", "content": "B new prompt"}]
    assert not any("A " in m["content"] for m in b.payload["messages"])


def test_step2_sliding_window_drops_the_oldest_turns():
    history = [{"role": "user" if i % 2 == 0 else "assistant", "content": f"turn {i} " + "word " * 50} for i in range(40)]
    messages = compile_messages(history, "now", "sys", 300, count_text)
    kept = messages[1:-1]
    assert sum(count_text(m["content"]) for m in kept) <= 300
    assert kept[-1]["content"].startswith("turn 39")
    assert kept[0]["role"] == "user"
    assert messages[0] == {"role": "system", "content": "sys"}
    assert messages[-1] == {"role": "user", "content": "now"}
    assert history_token_budget() == 2000


# Step 3 ---------------------------------------------------------------------

def models_body(deepseek_input: str) -> dict:
    return {"data": [
        {"id": "deepseek/deepseek-chat", "context_length": 64000, "pricing": {"prompt": deepseek_input, "completion": "0.00000028"}},
        {"id": "openai/gpt-4o-mini", "context_length": 128000, "pricing": {"prompt": "0.00000015", "completion": "0.0000006"}},
        {"id": "openrouter/auto", "pricing": {"prompt": "-1", "completion": "-1"}},
    ]}


def test_step3_sync_updates_prices_in_place_without_duplicates():
    store = MemoryGatewayStore()
    run(sync_pricing(FakeOpenRouter(models=models_body("0.00000014")), store))
    assert store.pricing["deepseek/deepseek-chat"].input_price_per_million == Decimal("0.14")
    run(sync_pricing(FakeOpenRouter(models=models_body("0.0000002")), store))
    row = run(store.get_pricing("deepseek/deepseek-chat"))
    assert row.input_price_per_million == Decimal("0.20")
    assert row.output_price_per_million == Decimal("0.28")
    assert row.context_window == 64000
    assert sorted(store.pricing) == ["deepseek/deepseek-chat", "openai/gpt-4o-mini"]
    assert [r.model_id for r in parse_models(models_body("0.0000002"))].count("deepseek/deepseek-chat") == 1


# Step 4 ---------------------------------------------------------------------

def test_step4_large_input_is_blocked_before_openrouter():
    with TestClient(app) as client:
        fake = FakeOpenRouter()
        app.state.openrouter = fake
        headers = add_user("user_poor")
        run(app.state.gateway.upsert_pricing([SONNET]))
        run(app.state.gateway.set_balance("user_poor", Decimal("0.01")))
        document = " ".join(f"w{i}" for i in range(6000))
        assert count_text(document) >= 10_000
        res = client.post("/api/v1/chat", headers=headers, json={"model": SONNET.model_id, "message": document})
        assert res.status_code == 402
        assert res.json()["error"]["code"] == "insufficient_balance"
        assert fake.calls == []


def test_step4_short_prompt_gets_max_tokens_capped_to_the_balance():
    with TestClient(app) as client:
        fake = FakeOpenRouter()
        app.state.openrouter = fake
        headers = add_user("user_tight")
        run(app.state.gateway.upsert_pricing([SONNET]))
        run(app.state.gateway.set_balance("user_tight", Decimal("0.01")))
        res = client.post("/api/v1/chat", headers=headers, json={"model": SONNET.model_id, "message": "Summarise the moon landing in one line."})
        assert res.status_code == 200, res.text
        payload = fake.calls[0]
        tokens = count_messages(payload["messages"])
        input_cost = Decimal(tokens) * Decimal("1.15") * Decimal(3) / Decimal(1_000_000)
        expected = int((Decimal("0.01") - input_cost) / (Decimal(15) / Decimal(1_000_000)))
        assert payload["max_tokens"] == expected
        assert 0 < payload["max_tokens"] < 667
        assert Decimal(payload["max_tokens"]) * Decimal(15) / Decimal(1_000_000) + input_cost <= Decimal("0.01")


def test_step4_formula_matches_the_brief():
    flight = billing.preflight(Decimal("0.01"), 10, SONNET)
    assert flight.estimated_input_cost == Decimal("0.0000345")
    assert flight.max_tokens == 664
    assert billing.preflight(Decimal("0.01"), 10_000, SONNET).allowed is False


def test_step4_stream_is_severed_at_the_affordable_limit():
    with TestClient(app) as client:
        fake = FakeOpenRouter(chunks=["one ", "two ", "three ", "four ", "five "] * 400, usage={"prompt_tokens": 30, "completion_tokens": 9999})
        app.state.openrouter = fake
        headers = add_user("user_stream")
        run(app.state.gateway.upsert_pricing([SONNET]))
        run(app.state.gateway.set_balance("user_stream", Decimal("0.001")))
        with client.stream("POST", "/api/v1/chat", headers=headers, json={"model": SONNET.model_id, "message": "count", "stream": True}) as res:
            body = "".join(res.iter_text())
        assert res.status_code == 200
        limit = fake.calls[0]["max_tokens"]
        assert body.count('"delta"') <= limit
        assert "budget_exhausted" in body
        assert body.rstrip().endswith("data: [DONE]")


# Step 5 ---------------------------------------------------------------------

def test_step5_billing_formula_deduction_lock_and_audit():
    store = MemoryGatewayStore()
    os.environ["GATEWAY_MARKUP"] = "1.20"

    async def scenario():
        await store.upsert_pricing([CHEAP])
        await store.set_balance("user_bill", Decimal("2.00"))
        prep = await prepare(store, "user_bill", CHEAP.model_id, "bill me", False)
        return await settle(store, prep, {"prompt_tokens": 5000, "completion_tokens": 2000}, "done", "gen-9")

    raw = billing.raw_cost(5000, 2000, Decimal("1.00"), Decimal("2.00"))
    assert raw == Decimal("0.009")
    assert billing.final_deduction(raw, Decimal("1.20")) == Decimal("0.0108")
    bill = run(scenario())
    assert Decimal(bill["raw_cost"]) == Decimal("0.009")
    assert Decimal(bill["deduction"]) == Decimal("0.0108")
    assert store.accounts["user_bill"].balance == Decimal("1.9892")
    assert store.accounts["user_bill"].billing_locked is False
    audit = store.audit[-1]
    assert audit["deduction"] == Decimal("0.0108")
    assert audit["balance_before"] - audit["balance_after"] == Decimal("0.0108")
    assert audit["prompt_tokens"] == 5000 and audit["completion_tokens"] == 2000
    assert audit["response_text"] == "done"
    assert run(store.history("user_bill")) == [{"role": "user", "content": "bill me"}, {"role": "assistant", "content": "done"}]
    os.environ.pop("GATEWAY_MARKUP", None)


def test_step5_hitting_zero_locks_the_account():
    with TestClient(app) as client:
        fake = FakeOpenRouter(usage={"prompt_tokens": 5000, "completion_tokens": 5000})
        app.state.openrouter = fake
        headers = add_user("user_zero")
        run(app.state.gateway.upsert_pricing([CHEAP]))
        run(app.state.gateway.set_balance("user_zero", Decimal("0.005")))
        first = client.post("/api/v1/chat", headers=headers, json={"model": CHEAP.model_id, "message": "hi"})
        assert first.status_code == 200, first.text
        assert first.json()["billing"]["billing_locked"] is True
        again = client.post("/api/v1/chat", headers=headers, json={"model": CHEAP.model_id, "message": "hi"})
        assert again.status_code == 402
        assert again.json()["error"]["code"] == "billing_locked"
        assert len(fake.calls) == 1


def test_unknown_model_and_missing_key():
    with TestClient(app) as client:
        headers = add_user("user_misc")
        run(app.state.gateway.set_balance("user_misc", Decimal("2")))
        assert client.post("/api/v1/chat", headers=headers, json={"model": "x/y", "message": "hi"}).status_code == 503
        app.state.openrouter = FakeOpenRouter()
        res = client.post("/api/v1/chat", headers=headers, json={"model": "x/y", "message": "hi"})
        assert res.status_code == 400
        assert res.json()["error"]["code"] == "unknown_model"
