"""Product rule: the server never stores AI replies or user code (Phase 0, item 1).

billing_transactions used to carry a `response_text` column holding the model's
answer. These tests run without a database and pin the new rule:

- a full billing settlement persists no response content anywhere in the store;
- the store's write API does not accept response text at all;
- the gateway SCHEMA has no column for it, so fresh installs never get one back;
- a forward migration exists that drops the column from existing databases,
  and the revision chain stays a single linear head ending at it.
"""
import inspect
import json
import os
import re
from decimal import Decimal
from pathlib import Path

import pytest

os.environ.setdefault("JWT_SECRET", "test-secret-test-secret-test-secret-ok")
os.environ["SURF_API_LITE"] = "1"

from app.gateway.billing import settle_billing
from app.gateway.store import SCHEMA, MemoryGatewayStore, PostgresGatewayStore

API_ROOT = Path(__file__).resolve().parents[1]
VERSIONS = API_ROOT / "alembic" / "versions"

SECRET_REPLY = "the model said: your secret function is do_step(n)"
SECRET_PROMPT = "refactor my private file please"


async def _settle_with_reply() -> MemoryGatewayStore:
    store = MemoryGatewayStore()
    await store.upsert_model_pricing("surf/test-model", Decimal("1"), Decimal("1"), 8192)
    await store.ensure_gateway_account("user-1", Decimal("10"))
    response = {
        "choices": [{"message": {"role": "assistant", "content": SECRET_REPLY}}],
        "usage": {"prompt_tokens": 10, "completion_tokens": 20},
    }
    await settle_billing(
        store=store,
        user_id="user-1",
        model_id="surf/test-model",
        response=response,
        markup_multiplier=Decimal("1.2"),
        balance_before=Decimal("10"),
    )
    return store


@pytest.mark.asyncio
async def test_billing_settlement_persists_no_response_content():
    store = await _settle_with_reply()
    assert len(store.billing_transactions) == 1, "the settlement itself must still be audited"
    dumped = json.dumps(store.billing_transactions, default=str)
    assert SECRET_REPLY not in dumped
    for tx in store.billing_transactions:
        assert "response_text" not in tx
    # Nothing else in the store may hold it either (auth/usage/credits/routing only).
    assert SECRET_REPLY not in json.dumps(store.gateway_accounts, default=str)
    assert SECRET_REPLY not in json.dumps(store.models_pricing, default=str)


def test_write_api_has_no_response_text_parameter():
    for cls in (MemoryGatewayStore, PostgresGatewayStore):
        params = inspect.signature(cls.save_billing_transaction).parameters
        assert "response_text" not in params, f"{cls.__name__} still accepts response_text"


def test_schema_has_no_response_column():
    assert "response_text" not in SCHEMA
    assert "TEXT" in SCHEMA, "sanity: the schema itself still parses"


def test_migration_drops_response_text_column():
    path = next(VERSIONS.glob("0007_drop_response_text*.py"), None)
    assert path is not None, "no 0007 migration exists to drop billing_transactions.response_text"
    src = path.read_text()
    assert re.search(r'billing_transactions\s+DROP COLUMN IF EXISTS response_text', src), (
        "0007 must drop exactly billing_transactions.response_text"
    )
    assert "DROP TABLE" not in src, "0007 must not drop any table"


def test_the_drop_migration_is_on_the_revision_chain():
    graph: dict[str, str | None] = {}
    for file in VERSIONS.glob("*.py"):
        text = file.read_text()
        rev = re.search(r'^revision\s*=\s*"([^"]+)"', text, re.M)
        down = re.search(r'^down_revision\s*=\s*(?:"([^"]+)"|None)', text, re.M)
        if rev:
            graph[rev.group(1)] = down.group(1) if down and down.group(1) else None
    downs = {d for d in graph.values() if d is not None}
    heads = [r for r in graph if r not in downs]
    assert len(heads) == 1, f"expected a single head, got {heads}"
    # The exact head is pinned in test_migrations.py; here 0007 only has to be
    # on the linear history so an existing database actually applies the drop.
    chain, node = [], heads[0]
    while node:
        chain.append(node)
        node = graph.get(node)
    assert "0007_drop_response_text" in chain, f"0007 is not on the chain to head {heads[0]}: {chain}"
