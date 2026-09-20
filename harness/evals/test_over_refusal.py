#!/usr/bin/env python3
"""Over-refusal: tiny models must not reuse a violence refusal on benign asks."""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "apps" / "web" / "src" / "lib" / "groundedContext.ts"
CHAT = ROOT / "apps" / "web" / "src" / "components" / "LocalChat.tsx"


def check(name: str, ok: bool, detail: str, rows: list) -> None:
    rows.append({"id": name, "ok": ok, "detail": detail})
    print(("PASS" if ok else "FAIL"), name, detail)


def run_checks() -> list[dict]:
    rows: list[dict] = []
    src = SRC.read_text(encoding="utf-8")
    chat = CHAT.read_text(encoding="utf-8")

    for sym in (
        "looksLikeSafetyRefusal",
        "looksLikeHarmfulAsk",
        "isOverRefusal",
        "stripRefusalContamination",
        "overRefusalRetryHint",
    ):
        check(f"exports-{sym}", f"export function {sym}" in src, sym, rows)

    check(
        "chat-wires-over-refusal",
        "isOverRefusal" in chat and "stripRefusalContamination" in chat and "overRefusalRetryHint" in chat,
        "LocalChat",
        rows,
    )
    check(
        "chat-retries-over-refusal",
        "Rephrasing a clearer answer" in chat,
        "retry UX",
        rows,
    )

    # Sanity: harmful vs benign patterns exist as source of truth for the TS helpers.
    check(
        "harmful-mentions-car-hit",
        "hit" in src and "car" in src and "looksLikeHarmfulAsk" in src,
        "harm patterns",
        rows,
    )
    check(
        "over-refusal-requires-not-harmful",
        re.search(r"looksLikeSafetyRefusal\(reply\).*!looksLikeHarmfulAsk\(ask\)", src, re.S)
        is not None
        or "looksLikeSafetyRefusal(reply) && !looksLikeHarmfulAsk(ask)" in src,
        "definition",
        rows,
    )
    return rows


def main() -> int:
    rows = run_checks()
    return 1 if any(not r["ok"] for r in rows) else 0


if __name__ == "__main__":
    sys.exit(main())
