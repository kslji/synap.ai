#!/usr/bin/env python3
"""Secrets stay out of .env.example. The browser pack that used allowInBrowserLlm is gone."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def check(name: str, ok: bool, detail: str, rows: list) -> None:
    rows.append({"id": name, "ok": ok, "detail": detail})
    print(("PASS" if ok else "FAIL"), name, detail)


def run_checks() -> list[dict]:
    rows: list[dict] = []
    example = (ROOT / ".env.example").read_text(encoding="utf-8")
    for key in ("ADMIN_PASSWORD", "SMTP_PASSWORD", "MOSS_PROJECT_KEY", "MOSS_PROJECT_ID"):
        line = next((row for row in example.splitlines() if row.startswith(f"{key}=")), "")
        check(f"env-example-{key.lower()}-empty", line == f"{key}=", line or "missing", rows)
    check(
        "env-example-has-no-livekit-dev-secret",
        "LIVEKIT_API_SECRET=secret" not in example and "LIVEKIT_API_KEY=devkey" not in example,
        "dev livekit secrets are not active assignments",
        rows,
    )
    check(
        "env-example-does-not-seal-a-zip",
        "moss_vault.enc" not in example and "seal:moss" not in example,
        "zip vault seal removed",
        rows,
    )
    return rows


def main() -> int:
    rows = run_checks()
    return 1 if any(not row["ok"] for row in rows) else 0


if __name__ == "__main__":
    sys.exit(main())
