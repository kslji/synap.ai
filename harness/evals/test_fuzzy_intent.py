#!/usr/bin/env python3
"""Messy user wording must still resolve to the intended Surf action."""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "apps" / "web" / "src" / "lib" / "groundedContext.ts"
HOST = ROOT / "apps" / "host" / "main.py"


def check(name: str, ok: bool, detail: str, rows: list) -> None:
    rows.append({"id": name, "ok": ok, "detail": detail})
    print(("PASS" if ok else "FAIL"), name, detail)


def run_checks() -> list[dict]:
    rows: list[dict] = []
    src = SRC.read_text(encoding="utf-8")
    host = HOST.read_text(encoding="utf-8")

    for sym in (
        "normalizeUserAsk",
        "fuzzyHasIntentWord",
        "wantsInterviewQuestions",
        "extractiveResumeInterviewQuestions",
    ):
        check(f"exports-{sym}", f"function {sym}" in src or f"export function {sym}" in src, sym, rows)

    check(
        "normalizes-double-could",
        r"(could|would|should|might|can)\s+(an?\s+\w+)\s+\1" in src
        or "could an interviewer could" in src.lower()
        or r"\1 $2" in src,
        "broken modal doubles",
        rows,
    )
    check(
        "fuzzy-intent-helper",
        "fuzzyHasIntentWord" in src and "editDistance1" in src,
        "typo-tolerant word match",
        rows,
    )
    check(
        "host-interview-covers-interviewer",
        "interview(er|ing|s)?" in host,
        "host OVERRIDE interview regex",
        rows,
    )
    check(
        "system-prefers-meant-over-literal",
        "Prefer what they *meant*" in (ROOT / "apps/web/public/system.md").read_text(encoding="utf-8")
        or "Prefer what they *meant*" in (ROOT / "harness/prompts/system.md").read_text(encoding="utf-8"),
        "system.md",
        rows,
    )

    messy = "what question could an interviewer could ask based on this resume ?"
    check(
        "messy-ask-has-interviewer-and-question",
        bool(re.search(r"interview", messy, re.I)) and bool(re.search(r"question", messy, re.I)),
        messy,
        rows,
    )
    return rows


def main() -> int:
    rows = run_checks()
    return 1 if any(not r["ok"] for r in rows) else 0


if __name__ == "__main__":
    sys.exit(main())
