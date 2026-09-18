#!/usr/bin/env python3
"""Deterministic guardrail cases. No network, no model."""

from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
HOST_DIR = HERE.parents[1] / "apps" / "host"
sys.path.insert(0, str(HOST_DIR))

from guardrails import sanitize_user_text  # noqa: E402

CASES = HERE / "guardrail_cases.json"


def run_checks() -> list[dict]:
    rows: list[dict] = []
    for case in json.loads(CASES.read_text(encoding="utf-8")):
        cleaned, flags = sanitize_user_text(case["text"])
        expect = set(case.get("expect_flags") or [])
        ok_flags = set(flags) == expect
        ok_text = case["must_contain"].lower() in cleaned.lower()
        ok = ok_flags and ok_text
        rows.append(
            {
                "id": f"guardrail:{case['id']}",
                "ok": ok,
                "detail": f"flags={flags} expect={sorted(expect)} snippet={cleaned[:80]!r}",
            }
        )
        print(("PASS" if ok else "FAIL"), f"guardrail:{case['id']}", f"flags={flags}")
        if not ok:
            print("  cleaned:", cleaned[:200])
    return rows


def main() -> int:
    rows = run_checks()
    failed = [r for r in rows if not r["ok"]]
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
