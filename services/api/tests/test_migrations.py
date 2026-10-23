"""Migration-chain invariants for the release (Item 1).

These run without a database: they assert the revision graph is a single
linear chain rooted at 0001_base, that 0001_base rebuilds the whole bootstrap
schema idempotently, and that the bind-param colon bug is fixed in 0003.
"""
import os
import re
from pathlib import Path

os.environ.setdefault("JWT_SECRET", "test-secret-test-secret-test-secret-ok")
os.environ["SURF_API_LITE"] = "1"

API_ROOT = Path(__file__).resolve().parents[1]
VERSIONS = API_ROOT / "alembic" / "versions"


def _read(name: str) -> str:
    return next(VERSIONS.glob(f"{name}*.py")).read_text()


def _rev_graph() -> dict[str, str | None]:
    graph: dict[str, str | None] = {}
    for path in VERSIONS.glob("*.py"):
        text = path.read_text()
        rev = re.search(r'^revision\s*=\s*"([^"]+)"', text, re.M)
        down = re.search(r'^down_revision\s*=\s*(?:"([^"]+)"|None)', text, re.M)
        if rev:
            graph[rev.group(1)] = down.group(1) if down and down.group(1) else None
    return graph


def test_single_root_and_single_head():
    graph = _rev_graph()
    roots = [r for r, d in graph.items() if d is None]
    assert roots == ["0001_base"], f"expected one root, got {roots}"
    downs = {d for d in graph.values() if d is not None}
    heads = [r for r in graph if r not in downs]
    assert heads == ["0007_drop_response_text"], f"expected one head, got {heads}"


def test_chain_is_linear_base_to_gateway():
    graph = _rev_graph()
    # walk back from the head; every revision must be reachable from 0001_base
    ups = {d: r for r, d in graph.items() if d}
    chain, node = [], "0001_base"
    while node:
        chain.append(node)
        node = ups.get(node)
    assert chain == ["0001_base", "0002_otp", "0003_licences", "0004_subscription",
                     "0005_gateway", "0006_drop_legacy", "0007_drop_response_text"]


def test_0001_base_runs_raw_ddl_without_bind_parsing():
    src = _read("0001_base")
    # the schema has `:word` sequences (jsonb samples) that op.execute would try to bind
    assert "exec_driver_sql" in src
    assert "op.execute(" not in src, "0001_base must not use op.execute on raw schema"


def test_0001_base_ddl_is_idempotent():
    src = _read("0001_base")
    for stmt in re.findall(r"CREATE TABLE\b[^;]*?\(", src):
        assert "IF NOT EXISTS" in stmt, f"non-idempotent CREATE TABLE: {stmt[:40]!r}"
    # every CREATE INDEX / CREATE UNIQUE INDEX uses IF NOT EXISTS
    for line in src.splitlines():
        s = line.strip()
        if s.startswith("CREATE ") and "INDEX" in s and "EXTENSION" not in s:
            assert "IF NOT EXISTS" in s, f"non-idempotent index DDL: {s[:50]!r}"
    # every plain INSERT INTO plans ... is guarded
    for m in re.finditer(r"INSERT INTO plans", src):
        tail = src[m.start(): m.start() + 400]
        assert "ON CONFLICT" in tail, "un-guarded plans INSERT breaks re-runs"
    # every FK ADD CONSTRAINT is inside a guarded DO block
    for m in re.finditer(r"ADD CONSTRAINT", src):
        head = src[max(0, m.start() - 40): m.start()]
        assert "DO $$" in head or "BEGIN" in head, f"unguarded ADD CONSTRAINT near {head[-30:]!r}"


def test_0001_base_covers_core_bootstrap_tables():
    src = _read("0001_base")
    for table in ("users", "plans", "devices", "otp_challenges", "licence_keys",
                  "auth_refresh_tokens", "documents", "chunks", "packs"):
        assert re.search(rf"CREATE TABLE IF NOT EXISTS {table}\b", src), f"0001_base missing {table}"


def test_0003_licence_seed_has_space_after_colon():
    # `:2` would be parsed as a bind parameter by SQLAlchemy text()
    assert '"max_devices": 2' in _read("0003_licences")
    assert '"max_devices":2' not in _read("0003_licences")


def test_0006_drops_legacy_tables_only():
    src = _read("0006_drop")
    for table in ("chat_messages", "search_requests", "search_quota_daily",
                  "source_suggestions", "training_examples"):
        assert f"DROP TABLE IF EXISTS {table}\"" in src, f"0006 missing drop of {table}"
    # must not drop tables the release still uses
    for table in ("users", "gateway_accounts", "billing_transactions", "agents", "niches"):
        assert f"DROP TABLE IF EXISTS {table}\"" not in src, f"0006 must not drop {table}"
    # the removed tables must not be re-created by boot-time gateway schema
    gateway_store = (API_ROOT / "app" / "gateway" / "store.py").read_text()
    assert "chat_messages" not in gateway_store
