#!/usr/bin/env python3
"""
Run user-customizable pack harness cases from custom_cases.json.

Edit custom_cases.json for your product, then:
  bash harness/run-custom.sh
  harness\\run-custom.bat

Starter cases (enabled: true) prove the harness works.
TEMPLATE-* cases are disabled until you customize them.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from guardrails import sanitize_user_text  # noqa: E402

CASES_FILE = HERE / "custom_cases.json"


def check(name: str, ok: bool, detail: str = "") -> bool:
    print(("PASS" if ok else "FAIL"), name, detail)
    return ok


def load_cases() -> dict:
    if not CASES_FILE.is_file():
        raise SystemExit(f"Missing {CASES_FILE.name}. Re-download the pack or restore the template.")
    return json.loads(CASES_FILE.read_text(encoding="utf-8"))


def run_sanitize(case: dict) -> bool:
    text = str(case.get("text") or "")
    cleaned, flags = sanitize_user_text(text)
    expect = set(case.get("expect_flags") or [])
    ok_flags = set(flags) == expect
    must = str(case.get("must_contain") or "")
    ok_must = (not must) or (must.lower() in cleaned.lower())
    forbidden = case.get("must_not_contain") or []
    ok_forbid = all(str(x).lower() not in cleaned.lower() for x in forbidden)
    ok = ok_flags and ok_must and ok_forbid
    detail = f"flags={flags} expect={sorted(expect)}"
    if not ok:
        detail += f" cleaned={cleaned[:140]!r}"
    return check(f"custom:{case.get('id', '?')}", ok, detail)


def run_manual(case: dict) -> None:
    ask = case.get("ask") or case.get("text") or ""
    expect = case.get("expect") or ""
    print("MANUAL", case.get("id", "?"))
    print("  ask:   ", ask)
    print("  expect:", expect)
    if case.get("note"):
        print("  note:  ", case["note"])


def main() -> int:
    data = load_cases()
    cases = [c for c in (data.get("cases") or []) if c.get("enabled", True)]
    skipped = sum(1 for c in (data.get("cases") or []) if not c.get("enabled", True))

    print("Surf pack custom harness")
    print("File:", CASES_FILE)
    print(f"Enabled: {len(cases)}  ·  Disabled templates: {skipped}")
    print("Edit custom_cases.json to add your own cases, then re-run.")
    print()

    if data.get("how_to"):
        for line in data["how_to"][:3]:
            print(" ", line)
        print()

    bits: list[bool] = []
    manuals = 0
    for case in cases:
        kind = str(case.get("kind") or "sanitize").lower()
        if kind == "manual":
            run_manual(case)
            manuals += 1
            continue
        if kind == "sanitize":
            bits.append(run_sanitize(case))
            continue
        bits.append(check(f"custom:{case.get('id', '?')}", False, f"unknown kind={kind!r}"))

    passed = sum(1 for b in bits if b)
    failed = sum(1 for b in bits if not b)
    print()
    print(f"Custom sanitize: {passed} passed, {failed} failed · manual checklist: {manuals}")
    if failed:
        print("Fix failing cases in custom_cases.json, or disable them with \"enabled\": false.")
        return 1
    if not bits and not manuals:
        print("No enabled cases. Set enabled: true on at least one case in custom_cases.json.")
        return 1
    print("Custom harness OK. Duplicate TEMPLATE-* cases and enable them for your product.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
