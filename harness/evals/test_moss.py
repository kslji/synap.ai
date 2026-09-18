#!/usr/bin/env python3
"""Moss must retrieve user files only — never product README / seed notes."""

from __future__ import annotations

import asyncio
import json
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch

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

    for row in rows:
        print(("PASS" if row["ok"] else "FAIL"), row["id"], row["detail"][:160])
    return rows


def main() -> int:
    rows = run_checks()
    return 1 if any(not r["ok"] for r in rows) else 0


if __name__ == "__main__":
    sys.exit(main())
