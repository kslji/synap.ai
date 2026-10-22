#!/usr/bin/env python3
"""Secrets stay out of the deploy .env.example. The auth host and its example
left the repo with the legacy backend; the browser pack that used
allowInBrowserLlm is gone."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def check(name: str, ok: bool, detail: str, rows: list) -> None:
    rows.append({"id": name, "ok": ok, "detail": detail})
    print(("PASS" if ok else "FAIL"), name, detail)


def run_checks() -> list[dict]:
    rows: list[dict] = []
    # deploy/.env.example (stack): signing/JWT/mail secrets are blank placeholders.
    stack = (ROOT / "deploy" / ".env.example").read_text(encoding="utf-8")
    for key in (
        "JWT_SECRET",
        "OPENROUTER_API_KEY",
        "LICENCE_SIGNING_KEY_HEX",
        "PACK_SIGNING_KEY_HEX",
        "SMTP_PASSWORD",
    ):
        line = next((row for row in stack.splitlines() if row.startswith(f"{key}=")), "")
        check(f"stack-example-{key.lower()}-empty", line == f"{key}=", line or "missing", rows)
    # Legacy host-only assignments must not creep back into any example.
    joined = stack
    for ghost in ("MOSS_PROJECT_KEY=", "LIVEKIT_API_SECRET=secret", "ADMIN_PASSWORD=x"):
        check(
            f"no-host-legacy-{ghost.split('=')[0].lower()}",
            ghost not in joined,
            "apps/host-era config stays out of the stack example",
            rows,
        )
    return rows


def main() -> int:
    rows = run_checks()
    return 1 if any(not row["ok"] for row in rows) else 0


if __name__ == "__main__":
    sys.exit(main())
