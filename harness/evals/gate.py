#!/usr/bin/env python3
"""Eval score gates. compare_eval() is used by the model eval runner
(core/run_eval.py) and by test_eval_gate.py. The auth-host go/no-go main()
left the repo with apps/host."""

from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))


def check(name: str, ok: bool, detail: str, rows: list) -> None:
    rows.append({"id": name, "ok": ok, "detail": detail})
    print(("PASS" if ok else "FAIL"), name, detail)


def compare_eval(report: dict, thresholds: dict, baseline: dict | None) -> list[dict]:
    """Fail when a suite is under its floor or below the baseline by more than the tolerance."""
    rows: list[dict] = []
    suites = report.get("suites") or {}
    spec = (thresholds or {}).get("suites") or {}
    base_suites = (baseline or {}).get("suites") or {}
    default_tol = float((thresholds or {}).get("regression_tolerance", 0.05))
    for name, entry in suites.items():
        rule = spec.get(name) or {}
        score = float(entry.get("score") or 0)
        minimum = float(rule.get("min_score", 0))
        tol = float(rule.get("regression_tolerance", default_tol))
        if score + 1e-9 < minimum:
            rows.append({"id": f"{name}-threshold", "ok": False, "detail": f"score {score:.3f} < {minimum:.3f}"})
        else:
            rows.append({"id": f"{name}-threshold", "ok": True, "detail": f"score {score:.3f} >= {minimum:.3f}"})
        if baseline is None:
            continue
        if name not in base_suites:
            rows.append({"id": f"{name}-regression", "ok": False, "detail": "suite missing from baseline"})
            continue
        prev = float(base_suites[name].get("score") or 0)
        if score + 1e-9 < prev - tol:
            rows.append({"id": f"{name}-regression", "ok": False, "detail": f"{score:.3f} < baseline {prev:.3f} - {tol:.3f}"})
        else:
            rows.append({"id": f"{name}-regression", "ok": True, "detail": f"{score:.3f} vs baseline {prev:.3f} (tol {tol:.3f})"})
    if baseline is not None:
        for name in base_suites:
            if name not in suites:
                rows.append({"id": f"{name}-missing", "ok": False, "detail": "suite missing from this run"})
    return rows

