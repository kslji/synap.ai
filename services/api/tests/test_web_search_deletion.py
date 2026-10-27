"""Item 7: web search is deleted everywhere, not just in the desktop app.

The server finished that path earlier (no /v1/search, no /v1/fetch), but the
dependencies, the READMEs, the tests and the free-plan seed still carried the
feature. These checks fail until every trace is gone. 0001_base is history and
is never edited: a forward migration (0008) strips web_search_per_day instead.
"""
import json
import re
from pathlib import Path

API_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = API_ROOT.parents[1]
VERSIONS = API_ROOT / "alembic" / "versions"

DEAD_PACKAGES = ("pymysql", "aiomysql", "trafilatura")

# The parts of the deleted stack that a document must not still describe as live.
SEARCH_GHOSTS = (
    "SearXNG",
    "search_requests",
    "search_quota_daily",
    "source_suggestions",
    "web_search_per_day",
    "/v1/search",
    "/v1/fetch",
    "trafilatura",
    "DuckDuckGo",
)

# The current architecture, read as today's truth: zero ghosts.
LIVE_DOCS = ("docs/ARCHITECTURE-SHORT.md",)

# Dated design records and step logs. History is not rewritten, so each one must
# carry a superseded note instead.
DATED_RECORDS = (
    "docs/ARCHITECTURE-FULL.md",
    "docs/HLD-LLD.md",
    "docs/IMPLEMENTATION.md",
    "docs/CURSOR_PROMPT.md",
    "docs/STEP-1.md",
    "docs/STEP-2.md",
    "docs/STEP-3.md",
    "docs/STEP-4.md",
    "docs/STEP-10.md",
    "docs/STEP-11.md",
    "docs/code-samples/production_postgres.sql",
)

SUPERSEDED = "web search was removed in phase 0"


def _api_python_files():
    for sub in ("app", "alembic", "tests"):
        yield from (API_ROOT / sub).rglob("*.py")


def test_requirements_drop_the_web_search_packages():
    text = (API_ROOT / "requirements.txt").read_text()
    for pkg in DEAD_PACKAGES:
        assert not re.search(rf"^{pkg}\b", text, re.M | re.I), f"{pkg} must be removed from requirements.txt"


def test_no_server_code_imports_the_web_search_packages():
    pattern = re.compile(rf"^\s*(?:import|from)\s+(?:{'|'.join(DEAD_PACKAGES)})\b", re.M)
    for path in _api_python_files():
        assert not pattern.search(path.read_text()), f"{path.relative_to(API_ROOT)} still imports a web-search package"


def test_readmes_no_longer_describe_a_search_service():
    readme = (API_ROOT / "README.md").read_text()
    for ghost in ("SEARXNG", "dev:search", "Search proxy", "web search", "SURF_DEV_OPEN"):
        assert ghost.lower() not in readme.lower(), f"services/api/README.md still mentions {ghost!r}"
    gateway = (API_ROOT / "app" / "gateway" / "README.md").read_text()
    for ghost in ("dev web search", "SearXNG", "/v1/search", "/v1/fetch"):
        assert ghost.lower() not in gateway.lower(), f"gateway/README.md still mentions {ghost!r}"


def test_server_tests_do_not_seed_search_environment():
    for path in (API_ROOT / "tests").glob("*.py"):
        for line in path.read_text().splitlines():
            if "os.environ" not in line:
                continue
            for ghost in ("SEARXNG_URL", "SEARXNG_SECRET", "FETCH_ALLOW_HOSTS"):
                assert ghost not in line, f"{path.name} still seeds {ghost} (web search is gone)"


def test_deploy_schema_does_not_advertise_web_search():
    """docker-entrypoint-initdb seeds plans straight from deploy/.

    Alembic 0008 cannot run before the seed, so the file itself must not hand
    out the dead quota knob.
    """
    text = (REPO_ROOT / "deploy" / "initdb" / "01_schema.sql").read_text()
    for ghost in ("web_search_per_day", "search_requests", "search_quota_daily", "source_suggestions"):
        assert ghost not in text, f"deploy/initdb/01_schema.sql still carries {ghost!r}"


def test_the_deleted_web_suite_leaves_no_dangling_gate():
    """search/no-fabrication-suite.ts was a web suite (gatherOnline, web-cache,
    quote caches), so it went with the purge. Every caller, scorer, threshold,
    baseline row and doc paragraph that pointed at it must go with it.

    The offline no-fabrication cases stay: step11-questions.ts builds them and
    model-eval still gates on minNoFabrication.
    """
    assert not (REPO_ROOT / "apps" / "desktop" / "src" / "main" / "core" / "search").exists()
    assert not (REPO_ROOT / "harness" / "core" / "no_fabrication.py").exists()
    for rel in (
        ".github/workflows/ci.yml",
        "harness/core/run_eval.py",
        "harness/evals/test_eval_gate.py",
        "harness/suites/shared/thresholds.yaml",
        "harness/baselines/quick.json",
        "docs/HARNESS.md",
    ):
        text = (REPO_ROOT / rel).read_text()
        for ghost in ("no-fabrication", "no_fabrication"):
            assert ghost not in text, f"{rel} still invokes the deleted web no-fabrication suite ({ghost})"


def test_a_forward_migration_strips_web_search_from_the_free_plan():
    stripped = [p for p in VERSIONS.glob("*.py") if "web_search_per_day" in p.read_text() and "0001" not in p.name]
    assert stripped, "a migration after 0001 must remove web_search_per_day from the plans features"
    src = stripped[0].read_text()
    assert re.search(r"UPDATE\s+plans\b", src, re.I), "the migration must update the seeded plan rows"
    # 0001 is history: it keeps its original seed and is never edited.
    base = next(VERSIONS.glob("0001*.py")).read_text()
    assert '"web_search_per_day":100' in base, "0001_base must remain byte-identical (no history rewrites)"


def test_live_docs_do_not_describe_the_deleted_search_stack():
    """ARCHITECTURE-SHORT is read as today's truth, so it must not name any part
    of the deleted stack - not the proxy, not the routes, not the tables.
    """
    for rel in LIVE_DOCS:
        text = (REPO_ROOT / rel).read_text()
        for ghost in SEARCH_GHOSTS:
            assert ghost.lower() not in text.lower(), f"{rel} still describes {ghost!r} as part of the product"


def test_dated_records_are_marked_superseded():
    """Dated design documents and step logs stay as written; each must say that
    the web-search parts of them no longer exist.
    """
    for rel in DATED_RECORDS:
        text = (REPO_ROOT / rel).read_text()
        assert SUPERSEDED in text.lower(), f"{rel} still presents web search without a superseded note"


def test_step11_doc_does_not_claim_the_deleted_web_suites():
    """The separate 42-case web no-fabrication suite and its CI gate went with
    web search, and the question bank shrank when the fresh-info cases went.
    """
    text = (REPO_ROOT / "docs" / "STEP-11.md").read_text()
    for ghost in (
        "no-fabrication suite is 42 cases",
        "including the no-fabrication gate",
        "fresh info",
        "116 questions",
        "46-question",
        "101-question",
    ):
        assert ghost not in text, f"docs/STEP-11.md still claims {ghost!r}"


def test_the_model_eval_baseline_note_describes_the_live_suites():
    """The note is read as today's gate. The measured rows inside the same file
    are past runs and stay exactly as they were recorded.
    """
    note = json.loads((REPO_ROOT / "harness" / "baselines" / "model-eval.json").read_text())["note"]
    for stale in ("46 questions", "101-question"):
        assert stale not in note, f"the baseline note still says {stale!r}"
