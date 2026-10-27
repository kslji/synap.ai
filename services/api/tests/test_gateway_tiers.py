"""Credit tiers and unlocks (ADR 0008).

The gateway deliberately splits three things, and this suite pins each separately:

  * the *unit* - 1 credit = $0.40 of workload, while the ledger stays exact USD;
  * *access* - the account's purchase tier decides which models it may use at all,
    answered with 403 ``model_locked`` plus the price of unlocking;
  * *affordability* - the balance still decides whether this one turn is payable (402).

Plus the two foot-guns the ADR closed: a retired allowlist id that no upstream price
list backs, and a 0-priced model being handed its entire context window to spend.
"""
from __future__ import annotations

import logging
import re
import uuid
from decimal import Decimal
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient

from app.gateway import pricing as pricing_mod
from app.gateway import router as router_mod
from app.gateway.credits import CREDIT_USD, credits_to_usd, usd_to_credits
from app.gateway.errors import ModelLockedError
from app.gateway.model_allowlist import (
    ALLOWED_MODELS,
    DAILY,
    FRONTIER,
    TRIAL,
    allowed_ids,
    get,
    is_allowed,
    min_credits,
)
from app.gateway.preflight import ZERO_PRICE_MAX_OUTPUT_TOKENS, calculate_max_tokens
from app.gateway.service import GatewayService
from app.gateway.store import MemoryGatewayStore
from app.main import app
from app.tokens import issue_access_token

REPO = Path(__file__).resolve().parents[3]

TIER_0 = "google/gemini-2.5-flash"  # Trial
TIER_1 = "openai/gpt-4.1"           # Daily - unlocked by $2
TIER_2 = "anthropic/claude-opus-4.5"  # Frontier - unlocked by $10


# --- fixtures -----------------------------------------------------------------


def _service(store: MemoryGatewayStore, client: Any, api_key: str = "test-key") -> GatewayService:
    return GatewayService(
        store=store,
        http_client=client,
        openrouter_api_key=api_key,
        openrouter_base_url="https://test.openrouter.ai/api/v1",
    )


def _json_client(payload: dict[str, Any]) -> tuple[Any, dict[str, Any]]:
    sink: dict[str, Any] = {"calls": 0}
    response = MagicMock()
    response.json.return_value = payload
    response.raise_for_status = MagicMock()

    async def post(url: str, json: dict[str, Any] | None = None, headers=None, timeout=None):
        sink["calls"] += 1
        sink["payload"] = json
        return response

    return MagicMock(post=post), sink


async def _seeded_store(*, tier0: bool = False) -> tuple[MemoryGatewayStore, str]:
    """A paid account holding the top tier, with pricing for all three models.

    ``tier0`` leaves the account on the free signup grant instead, for the cases that
    are about the gate itself.
    """
    store = MemoryGatewayStore()
    await store.seed_model_tiers([(m.model_id, m.min_credits, m.tier_label) for m in ALLOWED_MODELS])
    user_id = str(uuid.uuid4())
    await store.ensure_gateway_account(user_id, CREDIT_USD)
    if not tier0:
        # A $10 top-up buys the frontier tier, so the gate is out of the way.
        await store.record_topup(
            user_id, credits=25, usd=credits_to_usd(25), provider="stripe", external_ref="pi_test_1",
        )
    for model_id in (TIER_0, TIER_1, TIER_2):
        await store.upsert_model_pricing(model_id, Decimal("1.00"), Decimal("2.00"), 4096)
    return store, user_id


# --- the credit unit ----------------------------------------------------------


def test_one_credit_is_a_fixed_workload_bundle_not_a_price():
    assert CREDIT_USD == Decimal("0.40")
    # The top-up ladder from the ADR: the integer a user buys, and what it costs.
    assert usd_to_credits(Decimal("2.00")) == 5
    assert usd_to_credits(Decimal("10.00")) == 25
    assert usd_to_credits(Decimal("20.00")) == 50
    assert credits_to_usd(5) == Decimal("2.00")
    assert credits_to_usd(25) == Decimal("10.00")


def test_partial_credits_are_never_minted():
    # Rounded down: $0.39 is not yet a credit, so a price can only ever help the user.
    assert usd_to_credits(Decimal("0.39")) == 0
    assert usd_to_credits(Decimal("0.40")) == 1
    assert usd_to_credits(Decimal("1.99")) == 4
    assert usd_to_credits(Decimal("0")) == 0
    assert usd_to_credits(Decimal("-5")) == 0


def test_signup_grant_is_one_credit_and_cannot_reach_tier_1():
    documented = (REPO / "deploy" / ".env.example").read_text(encoding="utf-8")
    value = re.search(r"^GATEWAY_STARTING_CREDIT=(\S+)$", documented, re.M).group(1)
    grant = Decimal(value)
    assert usd_to_credits(grant) == 1, "the trial is exactly one credit"
    assert 1 < min_credits(TIER_1), "a trial must not be able to reach a paid tier for free"


# --- the ledger and the purchase tier -----------------------------------------


@pytest.mark.asyncio
async def test_signup_seeds_balance_grant_and_a_ledger_row():
    store = MemoryGatewayStore()
    user_id = str(uuid.uuid4())
    await store.ensure_gateway_account(user_id, CREDIT_USD)

    account = await store.get_gateway_account(user_id)
    assert account["balance"] == CREDIT_USD
    assert account["signup_credit"] == CREDIT_USD, "a grant stays distinguishable from a purchase"
    assert account["max_topup_credits"] == 0, "a grant never unlocks a tier"
    grant = [row for row in store.credit_ledger if row["kind"] == "signup_grant"]
    assert len(grant) == 1 and grant[0]["credits_delta"] == Decimal(1)


@pytest.mark.asyncio
async def test_topup_unlocks_and_the_tier_only_ever_goes_up():
    store = MemoryGatewayStore()
    user_id = str(uuid.uuid4())
    await store.ensure_gateway_account(user_id, CREDIT_USD)

    await store.record_topup(user_id, credits=5, usd=credits_to_usd(5), provider="stripe", external_ref="pi_2")
    assert await store.get_max_topup_credits(user_id) == 5
    assert await store.get_user_balance(user_id) == (Decimal("2.40"), False)

    # A smaller later purchase raises the balance but never lowers the tier already bought.
    await store.record_topup(user_id, credits=1, usd=credits_to_usd(1), provider="razorpay", external_ref="pay_3")
    assert await store.get_max_topup_credits(user_id) == 5
    kinds = [row["kind"] for row in store.credit_ledger]
    assert kinds == ["signup_grant", "topup", "topup"]
    assert store.credit_ledger[-1]["payment_provider"] == "razorpay"
    assert store.credit_ledger[-1]["external_ref"] == "pay_3"


@pytest.mark.asyncio
async def test_spend_is_written_to_the_ledger_again():
    store, user_id = await _seeded_store()
    client, _sink = _json_client({"choices": [{"message": {"content": "hi"}}], "usage": {"prompt_tokens": 10, "completion_tokens": 5}})
    await _service(store, client).handle_chat_request(user_id=user_id, model=TIER_1, prompt="Hi", stream=False)

    spend = [row for row in store.credit_ledger if row["kind"] == "spend"]
    assert len(spend) == 1
    assert spend[0]["usd_delta"] < 0, "a spend is negative money"
    assert spend[0]["credits_delta"] < 0


# --- the tier gate ------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_model_above_the_purchase_tier_is_locked_with_the_unlock_price():
    store, user_id = await _seeded_store(tier0=True)
    client, sink = _json_client({"choices": [{"message": {"content": "hi"}}]})
    service = _service(store, client)

    with pytest.raises(ModelLockedError) as exc_info:
        await service.handle_chat_request(user_id=user_id, model=TIER_1, prompt="Hi", stream=False)

    exc = exc_info.value
    assert exc.model_id == TIER_1
    assert exc.required_credits == 5
    assert exc.current_max_topup_credits == 0
    assert exc.unlock_usd == Decimal("2.00")
    assert exc.payload() == {
        "error": "model_locked",
        "model_id": TIER_1,
        "required_credits": 5,
        "current_max_topup_credits": 0,
        "unlock_usd": 2.0,
    }
    assert sink["calls"] == 0, "a locked model never reaches the provider"
    assert await store.get_user_balance(user_id) == (CREDIT_USD, False), "and never bills anything"


@pytest.mark.asyncio
async def test_the_trial_tier_still_works_so_signup_is_not_a_dead_end():
    store, user_id = await _seeded_store(tier0=True)
    client, _sink = _json_client({"choices": [{"message": {"content": "hi"}}], "usage": {"prompt_tokens": 10, "completion_tokens": 5}})
    result = await _service(store, client).handle_chat_request(user_id=user_id, model=TIER_0, prompt="Hi", stream=False)
    assert isinstance(result, dict) and "billing" in result


@pytest.mark.asyncio
async def test_a_tier_1_topup_unlocks_tier_1_but_not_tier_2():
    store, user_id = await _seeded_store(tier0=True)
    await store.record_topup(user_id, credits=5, usd=credits_to_usd(5), provider="stripe")
    client, _sink = _json_client({"choices": [{"message": {"content": "hi"}}], "usage": {"prompt_tokens": 10, "completion_tokens": 5}})
    service = _service(store, client)

    assert isinstance(await service.handle_chat_request(user_id=user_id, model=TIER_1, prompt="Hi", stream=False), dict)
    with pytest.raises(ModelLockedError) as exc_info:
        await service.handle_chat_request(user_id=user_id, model=TIER_2, prompt="Hi", stream=False)
    assert exc_info.value.required_credits == 25
    assert exc_info.value.unlock_usd == Decimal("10.00")


@pytest.mark.asyncio
async def test_the_gate_falls_back_to_the_allowlist_when_tiers_are_unseeded():
    """Fail closed: a missing tier row must never be read as "free"."""
    store = MemoryGatewayStore()
    user_id = str(uuid.uuid4())
    await store.ensure_gateway_account(user_id, Decimal("100.00"))  # rich, but unbought tier
    await store.upsert_model_pricing(TIER_1, Decimal("1.00"), Decimal("2.00"), 4096)
    client, _sink = _json_client({"choices": [{"message": {"content": "hi"}}]})

    with pytest.raises(ModelLockedError):
        await _service(store, client).handle_chat_request(user_id=user_id, model=TIER_1, prompt="Hi", stream=False)


@pytest.mark.asyncio
async def test_access_and_affordability_are_different_answers():
    """A big balance does not buy a tier; both stay independent (403 vs 402)."""
    store, user_id = await _seeded_store(tier0=True)
    store.gateway_accounts[user_id]["balance"] = Decimal("500.00")
    client, _sink = _json_client({"choices": [{"message": {"content": "hi"}}]})
    with pytest.raises(ModelLockedError):
        await _service(store, client).handle_chat_request(user_id=user_id, model=TIER_2, prompt="Hi", stream=False)


def test_an_unlisted_model_requires_the_top_tier():
    # The fail-closed default, so a stale or typo'd id cannot land in the free tier.
    assert min_credits("x-ai/grok-4") == 25
    assert min_credits(TIER_0) == 0


# --- the fallback list must not escalate --------------------------------------


def test_fallbacks_stay_within_the_account_purchase_tier():
    service = _service(MemoryGatewayStore(), MagicMock())
    # Tier 0: the cross-provider default is Tier 1, so a trial gets no fallback at all.
    assert service.model_fallbacks(TIER_0, 0) == [TIER_0]
    # Tier 1 buys the default back; Tier 2 also gets its same-provider sibling.
    assert service.model_fallbacks(TIER_0, 5) == [TIER_0, TIER_1]
    assert service.model_fallbacks(TIER_2, 25) == [TIER_2, "anthropic/claude-sonnet-4.5", TIER_1]


# --- foot-gun 1: a retired allowlist id ---------------------------------------


def test_the_allowlist_is_tiered_and_labels_are_the_three_tiers():
    assert {m.min_credits for m in ALLOWED_MODELS} == {0, 5, 25}
    for model in ALLOWED_MODELS:
        assert model.tier_label in {TRIAL, DAILY, FRONTIER}
        assert model.min_credits == min_credits(model.model_id)
        assert get(model.model_id) is model
    # Every tier row source is an allowlisted, paid (never :free) model.
    assert set(allowed_ids()) == {m.model_id for m in ALLOWED_MODELS}
    assert all(":free" not in mid for mid in allowed_ids())


def test_the_retired_grok_id_is_gone_and_its_successor_is_tiered():
    # x-ai/grok-4 stopped existing upstream; a dead slug on the allowlist 400s for the
    # user with an opaque provider error, which is exactly what this guard is for.
    assert not is_allowed("x-ai/grok-4")
    assert is_allowed("x-ai/grok-4.5")
    assert get("x-ai/grok-4.5").min_credits == 25


@pytest.mark.asyncio
async def test_sync_reports_allowlisted_models_the_price_list_does_not_back(caplog):
    store = MemoryGatewayStore()
    for model_id in allowed_ids():
        if model_id != "x-ai/grok-4.5":  # simulate upstream retiring this slug
            await store.upsert_model_pricing(model_id, Decimal("1.00"), Decimal("2.00"), 4096)
    assert await pricing_mod.unpriced_allowlist_models(store) == ["x-ai/grok-4.5"]

    models = [
        {"id": mid, "context_length": 4096, "pricing": {"prompt": "0.000001", "completion": "0.000002"}}
        for mid in allowed_ids()
        if mid != "x-ai/grok-4.5"
    ]
    response = MagicMock()
    response.json.return_value = {"data": models}
    response.raise_for_status = MagicMock()
    client = MagicMock()
    client.get = AsyncMock(return_value=response)

    with caplog.at_level(logging.WARNING, logger="surf.gateway.pricing"):
        await pricing_mod.sync_pricing(store, client)
    assert "x-ai/grok-4.5" in caplog.text


# --- foot-gun 2: a zero-priced model ------------------------------------------


def test_a_zero_priced_model_does_not_get_the_whole_context_window():
    # The old free branch returned the context window, so one mispriced row let a
    # balance buy an enormous un-metered completion.
    assert calculate_max_tokens(Decimal("100"), Decimal("0"), Decimal("0"), 400_000) == ZERO_PRICE_MAX_OUTPUT_TOKENS
    assert calculate_max_tokens(Decimal("100"), Decimal("0"), Decimal("0")) == ZERO_PRICE_MAX_OUTPUT_TOKENS
    # A small context window is still respected - the ceiling never exceeds it.
    assert calculate_max_tokens(Decimal("100"), Decimal("0"), Decimal("0"), 1000) == 1000


def test_a_priced_model_is_still_clamped_to_what_the_balance_affords():
    # $1.00 remaining at $2/1M output = 500k tokens, capped by the window.
    assert calculate_max_tokens(Decimal("1.00"), Decimal("0"), Decimal("2.00"), 4096) == 4096
    assert calculate_max_tokens(Decimal("0.001"), Decimal("0.0005"), Decimal("2.00")) == 250
    assert calculate_max_tokens(Decimal("0.10"), Decimal("0.10"), Decimal("2.00")) == 0


# --- provider-shaped usage (direct API routing prep) ---------------------------


@pytest.mark.parametrize(
    "usage,expected",
    [
        ({"prompt_tokens": 10, "completion_tokens": 4}, (10, 4)),  # OpenRouter / OpenAI
        ({"input_tokens": 11, "output_tokens": 5}, (11, 5)),  # Anthropic /messages
        ({"promptTokenCount": 12, "candidatesTokenCount": 6}, (12, 6)),  # Google
        ({"prompt_tokens": 0, "completion_tokens": 0}, (0, 0)),  # a real 0 is not "missing"
        ({}, (0, 0)),
    ],
)
def test_usage_is_normalised_across_provider_spellings(usage: dict[str, int], expected: tuple[int, int]):
    from app.gateway.billing import extract_usage

    assert extract_usage({"usage": usage}) == expected


# --- endpoints ----------------------------------------------------------------


def _token(user_id: str) -> str:
    return issue_access_token("dev-1", user_id, "tier@example.com")["token"]


def test_chat_on_a_locked_model_is_a_403_with_the_unlock_payload():
    """The shape both pickers render their "Unlock with $10 top-up" CTA from."""
    uid = f"user-tier-{uuid.uuid4().hex[:8]}"
    with TestClient(app) as client:
        # Startup already seeded model_tiers into the app's store; this account has
        # money but no purchase tier, which is precisely the case 403 is for.
        app.state.gateway.store.gateway_accounts[uid] = {
            "user_id": uid, "balance": Decimal("50.00"), "billing_locked": False,
            "signup_credit": CREDIT_USD, "max_topup_credits": 0,
        }
        resp = client.post(
            "/api/v1/chat",
            json={"model": TIER_2, "prompt": "hi", "stream": False},
            headers={"Authorization": f"Bearer {_token(uid)}"},
        )
        assert resp.status_code == 403
        body = resp.json()
        assert body["error"] == "model_locked"
        assert body["model_id"] == TIER_2
        assert body["required_credits"] == 25
        assert body["current_max_topup_credits"] == 0
        assert body["unlock_usd"] == 10.0
        # An access denial, not a debt lock: the untouched balance proves nothing was spent.
        assert app.state.gateway.store.gateway_accounts[uid]["balance"] == Decimal("50.00")


@pytest.mark.asyncio
async def test_models_exposes_tier_lock_and_unlock_price():
    store = MemoryGatewayStore()
    await store.seed_model_tiers([(m.model_id, m.min_credits, m.tier_label) for m in ALLOWED_MODELS])
    for model_id in (TIER_0, TIER_1):
        await store.upsert_model_pricing(model_id, Decimal("1.00"), Decimal("2.00"), 4096)
    await store.record_topup("picker", credits=5, usd=credits_to_usd(5), provider="stripe")
    gateway = _service(store, MagicMock())

    result = await router_mod.list_models(user_id="picker", gateway=gateway)
    by_id = {m["id"]: m for m in result["models"]}
    assert result["max_topup_credits"] == 5
    # Only priced allowlisted models appear - TIER_2 has no pricing row yet.
    assert set(by_id) == {TIER_0, TIER_1}
    assert by_id[TIER_0]["locked"] is False and by_id[TIER_0]["min_credits"] == 0
    assert by_id[TIER_1]["locked"] is False and by_id[TIER_1]["tier_label"] == DAILY
    assert by_id[TIER_1]["unlock_usd"] == 2.0

    # An account with no purchase tier sees the same model as locked, with what it costs.
    trial_rows = {m["id"]: m for m in (await router_mod.list_models(user_id="nobody", gateway=gateway))["models"]}
    assert trial_rows[TIER_1]["locked"] is True
    assert trial_rows[TIER_0]["locked"] is False


@pytest.mark.asyncio
async def test_balance_reports_whole_credits_and_the_purchase_tier():
    store = MemoryGatewayStore()
    user_id = "balance-user"
    await store.ensure_gateway_account(user_id, CREDIT_USD)
    await store.record_topup(user_id, credits=5, usd=credits_to_usd(5), provider="stripe")
    gateway = _service(store, MagicMock())

    body = await router_mod.get_balance(user_id=user_id, gateway=gateway)
    assert body["balance"] == pytest.approx(2.40)
    assert body["credits"] == 6, "whole credits, floored - the same unit the store sells"
    assert body["max_topup_credits"] == 5
    assert body["billing_locked"] is False
