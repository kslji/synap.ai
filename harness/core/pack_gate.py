"""Pack signing refuses unless an eval suite passed.

A niche with no cases falls back to the shared suite. That is the Marine
template today: the folder can exist before its cases do.
"""
from __future__ import annotations

import json
import os
from pathlib import Path


def assert_can_sign(niche: str, report_path: str | Path | None = None) -> str:
    raw = report_path if report_path is not None else os.environ.get("SURF_EVAL_REPORT", "")
    path = Path(raw) if raw else None
    if path is None or not path.is_file():
        raise SystemExit("refusing to sign: no eval report. Run ./harness/run.sh quick first.")
    try:
        report = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SystemExit(f"refusing to sign: eval report is not json ({exc})") from exc
    suites = report.get("suites") or {}
    niche_entry = suites.get(niche)
    if isinstance(niche_entry, dict) and int(niche_entry.get("cases") or 0) > 0:
        name, entry = niche, niche_entry
    else:
        name, entry = "shared", suites.get("shared")
    if not isinstance(entry, dict):
        raise SystemExit(f"refusing to sign: suite {name} is missing from {path}")
    if not entry.get("ok"):
        raise SystemExit(f"refusing to sign: suite {name} did not pass (score={entry.get('score')})")
    return name
