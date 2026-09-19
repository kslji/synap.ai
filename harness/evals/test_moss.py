#!/usr/bin/env python3
"""Moss must retrieve user files only — never product README / seed notes.

Also verifies primary/secondary flow:
  1) Moss SDK when credentials + client work
  2) Keyword fallback when SDK fails, creds missing, or local_only (offline)
"""

from __future__ import annotations

import asyncio
import json
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

HERE = Path(__file__).resolve().parent
HOST_DIR = HERE.parents[1] / "apps" / "host"
sys.path.insert(0, str(HOST_DIR))

from moss_runtime import MossRuntime, is_product_leak  # noqa: E402

FIXTURES = HERE / "fixtures"
CASES = HERE / "retrieval_cases.json"


def _load_corpus(runtime: MossRuntime) -> None:
    mapping = {
        "file-invoice-northwind.txt": FIXTURES / "invoice-northwind.txt",
        "file-bakery-readme.md": FIXTURES / "bakery-readme.md",
        "file-handbook-payroll.txt": FIXTURES / "handbook-payroll.txt",
    }
    for doc_id, path in mapping.items():
        runtime.add(doc_id, path.read_text(encoding="utf-8"))


def _blob(hits: dict) -> str:
    return " ".join(str(d.get("text") or "") for d in hits.get("docs") or [])


def _check_primary_secondary_flow(rows: list[dict]) -> None:
    """Moss SDK primary → keyword secondary when creds fail / offline."""
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        with patch("moss_runtime.current_dir", return_value=root):
            runtime = MossRuntime()
            runtime.add(
                "file-harbor",
                "Harbor ferry leaves at 06:40 from Pier 4. Tickets at the booth.",
            )

            # No credentials → secondary keyword only
            with patch("moss_runtime.load_creds", return_value=("", "")):
                runtime._bind_sdk()
                rows.append(
                    {
                        "id": "moss-flow-no-creds-binds-keyword",
                        "ok": runtime._client is None and runtime.backend == "keyword-fallback",
                        "detail": f"backend={runtime.backend} client={runtime._client}",
                    }
                )
                hits = asyncio.run(runtime.query("harbor ferry pier", local_only=False))
                rows.append(
                    {
                        "id": "moss-flow-no-creds-uses-keyword",
                        "ok": hits.get("backend") == "moss-local-session-fallback"
                        and "Pier 4" in _blob(hits),
                        "detail": f"backend={hits.get('backend')} blob={_blob(hits)[:120]!r}",
                    }
                )

            # Creds present + mock Moss SDK success → primary backend "moss"
            mock_doc = SimpleNamespace(
                id="file-harbor",
                text="Harbor ferry leaves at 06:40 from Pier 4.",
                score=0.99,
            )
            mock_session = MagicMock()
            mock_session.load_from_disk = AsyncMock()
            mock_session.save_to_disk = AsyncMock()
            mock_session.add_docs = AsyncMock()
            mock_session.query = AsyncMock(return_value=SimpleNamespace(docs=[mock_doc]))
            mock_client = MagicMock()
            mock_client.session = AsyncMock(return_value=mock_session)

            runtime._client = mock_client
            runtime.backend = "moss"
            hits = asyncio.run(runtime.query("when does the ferry leave", local_only=False))
            rows.append(
                {
                    "id": "moss-flow-sdk-primary",
                    "ok": hits.get("backend") == "moss"
                    and mock_session.query.await_count >= 1
                    and "Pier 4" in _blob(hits),
                    "detail": f"backend={hits.get('backend')} ms={hits.get('time_taken_ms')} "
                    f"calls={mock_session.query.await_count}",
                }
            )

            # SDK raises (creds exhausted / auth) → secondary keyword, still grounded
            boom_client = MagicMock()
            boom_client.session = AsyncMock(side_effect=RuntimeError("creds exhausted"))
            runtime._client = boom_client
            runtime.backend = "moss"
            hits = asyncio.run(runtime.query("ferry pier harbor", local_only=False))
            rows.append(
                {
                    "id": "moss-flow-sdk-fail-falls-to-keyword",
                    "ok": hits.get("backend") == "moss-local-session-fallback"
                    and "Pier 4" in _blob(hits),
                    "detail": f"backend={hits.get('backend')} blob={_blob(hits)[:120]!r}",
                }
            )

            # Offline / local_only → never call SDK even if client is bound
            skip_client = MagicMock()
            skip_client.session = AsyncMock(return_value=mock_session)
            runtime._client = skip_client
            hits = asyncio.run(runtime.query("ferry pier", local_only=True))
            rows.append(
                {
                    "id": "moss-flow-offline-skips-sdk",
                    "ok": hits.get("backend") == "moss-local-session-fallback"
                    and skip_client.session.await_count == 0
                    and "Pier 4" in _blob(hits),
                    "detail": f"backend={hits.get('backend')} sdk_calls={skip_client.session.await_count}",
                }
            )


def run_checks() -> list[dict]:
    rows: list[dict] = []
    spec = json.loads(CASES.read_text(encoding="utf-8"))
    forbidden = spec["forbidden_hit_substrings"]

    leak_seed = {
        "id": "seed-privacy",
        "text": "Small Cloud keeps chat on-device via Ollama. The static host never receives prompts.",
    }
    rows.append(
        {
            "id": "moss-seed-classified-as-leak",
            "ok": is_product_leak(leak_seed),
            "detail": "seed-privacy must be rejected",
        }
    )

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        with patch("moss_runtime.current_dir", return_value=root):
            runtime = MossRuntime()
            runtime.add("seed-ram", "Default model llama3.2:3b uses about 2.4 GB RAM while answering.")
            empty_after_seed = runtime.docs == 0
            rows.append(
                {
                    "id": "moss-refuses-product-seed-add",
                    "ok": empty_after_seed,
                    "detail": f"docs={runtime.docs}",
                }
            )

            stale = root / "moss_local.json"
            stale.write_text(
                json.dumps(
                    [
                        leak_seed,
                        {
                            "id": "file-ok",
                            "text": "Harbor ferry leaves at 06:40 from Pier 4.",
                        },
                    ]
                ),
                encoding="utf-8",
            )
            runtime.reload()
            ids = {d["id"] for d in runtime._docs}
            rows.append(
                {
                    "id": "moss-strips-stale-seed-on-load",
                    "ok": "seed-privacy" not in ids and "file-ok" in ids,
                    "detail": str(ids),
                }
            )

            runtime._docs = []
            runtime._persist()
            _load_corpus(runtime)
            rows.append(
                {
                    "id": "moss-indexes-user-corpus",
                    "ok": runtime.docs == 3,
                    "detail": f"docs={runtime.docs}",
                }
            )

            for case in spec["cases"]:
                hits = asyncio.run(runtime.query(case["query"], local_only=True))
                blob = _blob(hits)
                leak = [p for p in forbidden if p.lower() in blob.lower()]
                if case.get("expect_empty"):
                    ok = len(hits.get("docs") or []) == 0 and not leak
                    detail = f"hits={len(hits.get('docs') or [])} leak={leak}"
                else:
                    must = case.get("must_contain_any") or []
                    must_not = case.get("must_not_contain_any") or []
                    ok_hit = any(n.lower() in blob.lower() for n in must)
                    ok_not = not any(n.lower() in blob.lower() for n in must_not)
                    ok = ok_hit and ok_not and not leak
                    detail = f"leak={leak} blob={blob[:180]!r}"
                rows.append({"id": f"moss:{case['id']}", "ok": ok, "detail": detail})

    _check_primary_secondary_flow(rows)

    for row in rows:
        print(("PASS" if row["ok"] else "FAIL"), row["id"], row["detail"][:160])
    return rows


def main() -> int:
    rows = run_checks()
    return 1 if any(not r["ok"] for r in rows) else 0


if __name__ == "__main__":
    sys.exit(main())
