#!/usr/bin/env python3
"""Error text is read from small screenshot fixtures. No model and no network."""

from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from screenshot_fixture import FIXTURES, extract_error_lines, read_screenshot  # noqa: E402


def check(name: str, ok: bool, detail: str, rows: list) -> None:
    rows.append({"id": name, "ok": ok, "detail": detail})
    print(("PASS" if ok else "FAIL"), name, detail)


def run_checks() -> list[dict]:
    rows: list[dict] = []
    folder = HERE / "fixtures" / "screenshots"
    for name, expected in FIXTURES.items():
        blob = (folder / name).read_bytes()
        check(f"screenshot-{name}-png", blob.startswith(b"\x89PNG\r\n\x1a\n"), f"{len(blob)} bytes", rows)
        text = read_screenshot(blob)
        lines = extract_error_lines(text)
        check(f"screenshot-{name}-text", text == expected, text, rows)
        check(f"screenshot-{name}-error", bool(lines) and expected in lines[0], " | ".join(lines), rows)
    stack = "TypeError: x is not a function\n    at render (App.tsx:12:5)"
    lines = extract_error_lines(stack)
    check("screenshot-stack-frame", lines == ["TypeError: x is not a function", "at render (App.tsx:12:5)"], " | ".join(lines), rows)
    return rows


def main() -> int:
    rows = run_checks()
    return 1 if any(not row["ok"] for row in rows) else 0


if __name__ == "__main__":
    raise SystemExit(main())
