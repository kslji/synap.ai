#!/usr/bin/env python3
"""Pack must ship guardrail evals and runtime sanitizer matching host rules."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / "apps" / "web" / "public"
HARNESS = PUBLIC / "harness"


def check(name: str, ok: bool, detail: str, rows: list) -> None:
    rows.append({"id": name, "ok": ok, "detail": detail})
    print(("PASS" if ok else "FAIL"), name, detail)


def run_checks() -> list[dict]:
    rows: list[dict] = []
    for name in (
        "guardrails.py",
        "guardrail_cases.json",
        "custom_cases.json",
        "CUSTOM.md",
        "MOSS.md",
        "file_focus.py",
        "file_focus_cases.json",
        "run-evals.py",
        "run-evals.sh",
        "run-evals.bat",
        "run-custom.py",
        "run-custom.sh",
        "run-custom.bat",
    ):
        check(f"pack-evals-{name}", (HARNESS / name).is_file(), str(HARNESS / name), rows)

    html = (PUBLIC / "local-agent.html").read_text(encoding="utf-8")
    check(
        "pack-runtime-injection-block",
        "[blocked-instruction]" in html and "prompt_injection_pattern" in html,
        "local-agent blocks injection patterns",
        rows,
    )
    check(
        "pack-runtime-secret-redact",
        "[redacted-key]" in html and "[redacted-private-key]" in html,
        "local-agent redacts secrets",
        rows,
    )
    check(
        "pack-runtime-sanitize-attachments",
        "sanitizeCorpusText" in html,
        "attachments sanitized before Moss/model",
        rows,
    )

    open_on = (ROOT / "apps" / "web" / "src" / "lib" / "openOnDevice.ts").read_text(encoding="utf-8")
    check(
        "zip-bakes-pack-evals",
        "run-evals.py" in open_on and "guardrail_cases.json" in open_on,
        "openOnDevice includes pack evals",
        rows,
    )
    check(
        "zip-bakes-file-focus",
        "file_focus.py" in open_on and "file_focus_cases.json" in open_on,
        "openOnDevice includes named-file focus evals",
        rows,
    )
    check(
        "zip-bakes-custom-harness",
        "custom_cases.json" in open_on and "run-custom.py" in open_on and "run-custom.sh" in open_on,
        "openOnDevice includes custom harness",
        rows,
    )
    check(
        "zip-bakes-moss-note",
        "MOSS.md" in open_on and "text document retrieval" in open_on,
        "openOnDevice bakes Moss retrieval note",
        rows,
    )

    # Execute pack eval runner against public/ as if it were a pack root.
    # run-evals.py expects ROOT = parent of harness/, so we run with cwd=public
    # but the script uses HERE.parent as ROOT — for public/harness that is public/,
    # which has moss_* and local-agent.html. agent.json may be missing in public/.
    # So only assert guardrail portion by importing pack guardrails directly.
    sys.path.insert(0, str(HARNESS))
    from guardrails import sanitize_user_text  # noqa: E402

    cases = json.loads((HARNESS / "guardrail_cases.json").read_text(encoding="utf-8"))
    failed = 0
    for case in cases:
        cleaned, flags = sanitize_user_text(case["text"])
        expect = set(case.get("expect_flags") or [])
        ok = set(flags) == expect and case["must_contain"].lower() in cleaned.lower()
        if not ok:
            failed += 1
            check(f"pack-guardrail:{case['id']}", False, f"flags={flags}", rows)
        else:
            check(f"pack-guardrail:{case['id']}", True, "ok", rows)
    check("pack-guardrail-suite", failed == 0, f"failed={failed}/{len(cases)}", rows)

    # Also run the pack runner if agent.json isn't required for guardrail section —
    # create a temp pack layout? Simpler: subprocess run-evals and allow agent.json fail
    # Actually run-evals requires agent.json. Skip subprocess or create temp.
    try:
        proc = subprocess.run(
            [sys.executable, str(HARNESS / "run-evals.py")],
            cwd=str(PUBLIC),
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
        # Without agent.json in public/, identity checks fail — that's expected.
        # Guardrail lines should still PASS.
        out = (proc.stdout or "") + (proc.stderr or "")
        guard_ok = out.count("PASS guardrail:") >= 10
        check(
            "pack-run-evals-guardrails-section",
            guard_ok,
            f"PASS guardrail count visible in output; rc={proc.returncode}",
            rows,
        )
    except Exception as exc:  # noqa: BLE001
        check("pack-run-evals-guardrails-section", False, str(exc), rows)

    try:
        proc = subprocess.run(
            [sys.executable, str(HARNESS / "run-custom.py")],
            cwd=str(PUBLIC),
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
        out = (proc.stdout or "") + (proc.stderr or "")
        check(
            "pack-run-custom-harness",
            proc.returncode == 0 and "Custom harness OK" in out,
            f"rc={proc.returncode}",
            rows,
        )
    except Exception as exc:  # noqa: BLE001
        check("pack-run-custom-harness", False, str(exc), rows)

    return rows


def main() -> int:
    rows = run_checks()
    return 1 if any(not r["ok"] for r in rows) else 0


if __name__ == "__main__":
    sys.exit(main())
