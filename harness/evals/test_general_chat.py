#!/usr/bin/env python3
"""Agent must answer first-time general questions via context injection — no per-task training."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HOST = ROOT / "apps" / "host" / "main.py"
SYS_HARNESS = ROOT / "harness" / "prompts" / "system.md"
SYS_WEB = ROOT / "apps" / "web" / "public" / "system.md"
GROUNDED = ROOT / "apps" / "web" / "src" / "lib" / "groundedContext.ts"
AGENT = ROOT / "apps" / "web" / "public" / "local-agent.html"


def check(name: str, ok: bool, detail: str, rows: list) -> None:
    rows.append({"id": name, "ok": ok, "detail": detail})
    print(("PASS" if ok else "FAIL"), name, detail)


def run_checks() -> list[dict]:
    rows: list[dict] = []
    host = HOST.read_text(encoding="utf-8")
    sys_h = SYS_HARNESS.read_text(encoding="utf-8")
    sys_w = SYS_WEB.read_text(encoding="utf-8")
    grounded = GROUNDED.read_text(encoding="utf-8")
    agent = AGENT.read_text(encoding="utf-8")

    check(
        "system-allows-general-first-time",
        "general questions immediately" in sys_h.lower() or "general questions" in sys_h.lower(),
        "harness system.md",
        rows,
    )
    check(
        "system-web-matches-general",
        "general questions" in sys_w.lower() and ("train" in sys_w.lower() or "training" in sys_w.lower()),
        "web system.md",
        rows,
    )
    check(
        "system-modes-general-and-files",
        "General chat" in sys_h and "File-grounded" in sys_h,
        "modes",
        rows,
    )
    check(
        "host-general-turn-injection",
        "_GENERAL_TURN" in host and "No files are attached on this turn" in host,
        "host cue",
        rows,
    )
    check(
        "host-injects-when-no-files",
        "ground = _GENERAL_TURN" in host,
        "else branch",
        rows,
    )
    check(
        "grounded-generalTurnCue",
        "export function generalTurnCue" in grounded and "export function fileTurnCue" in grounded,
        "cues",
        rows,
    )
    check(
        "grounded-system-first-time",
        "First-time users may ask general questions" in grounded,
        "groundedSystem",
        rows,
    )
    check(
        "agent-general-turn-context",
        "TURN CONTEXT: No files are attached on this turn" in agent,
        "local-agent",
        rows,
    )
    check(
        "agent-empty-says-general-ok",
        "General questions work with no files" in agent,
        "empty copy",
        rows,
    )
    # Must not claim documents-only as the only mode in the primary who-you-are blurb.
    check(
        "system-not-documents-only",
        "You only know what is in the attached files" not in sys_h,
        "removed exclusive file lock",
        rows,
    )
    return rows


def main() -> int:
    rows = run_checks()
    return 1 if any(not r["ok"] for r in rows) else 0


if __name__ == "__main__":
    sys.exit(main())
