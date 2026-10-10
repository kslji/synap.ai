#!/usr/bin/env python3
"""Production go/no-go for the local host. No cloud LLM. Writes last-report.json."""

from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
HOST_DIR = ROOT / "apps" / "host"
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HOST_DIR))

REPORT = Path(__file__).with_name("last-report.json")
LOOPBACK = ("127.0.0.1", "localhost")


def check(name: str, ok: bool, detail: str, rows: list) -> None:
    rows.append({"id": name, "ok": ok, "detail": detail})
    print(("PASS" if ok else "FAIL"), name, detail)


def loopback_url(url: str | None) -> bool:
    if not url:
        return True
    return any(h in url for h in LOOPBACK)


def main() -> int:
    # Host checks stay behind this function so `from gate import compare_eval`
    # does not pull the auth host (the desktop eval job does not install it).
    from http_client import get_json
    from test_convert import run_checks as convert_checks
    from test_guardrails import run_checks as guardrail_checks
    from test_local_first import run_checks as local_first_checks
    from test_moss import run_checks as moss_checks
    from test_reply_repair import run_checks as reply_repair_checks

    rows: list[dict] = []
    rows.extend(guardrail_checks())
    rows.extend(moss_checks())
    rows.extend(reply_repair_checks())
    rows.extend(local_first_checks())
    rows.extend(convert_checks())
    from test_eval_gate import run_checks as eval_gate_checks  # noqa: E402
    rows.extend(eval_gate_checks())

    try:
        health = get_json("/health")
    except Exception as exc:
        check("host-up", False, str(exc), rows)
        REPORT.write_text(json.dumps({"ok": False, "checks": rows}, indent=2), encoding="utf-8")
        return 1

    check("host-up", True, "127.0.0.1:18765", rows)
    privacy = health.get("privacy") or {}
    check(
        "zero-knowledge-platform-bytes",
        privacy.get("platform_bytes") == 0,
        str(privacy),
        rows,
    )
    moss = health.get("moss") or {}
    check("moss-on-device", bool(moss.get("enabled") or moss.get("backend")), str(moss), rows)

    local = health.get("local_llm") or {}
    backend = local.get("backend")
    url = local.get("url")
    check(
        "local-llm-loopback",
        loopback_url(url),
        f"backend={backend} url={url}",
        rows,
    )
    if backend:
        check(
            "local-llm-not-saas",
            "openai" not in str(url).lower() and "anthropic" not in str(url).lower(),
            str(url),
            rows,
        )

    ram = (health.get("runtime") or {}).get("ram_gb")
    if ram is None:
        ram = (health.get("ram") or {}).get("ram_gb")
    check("ram-reported", isinstance(ram, (int, float)) and ram > 0, str(ram), rows)

    failed = [r for r in rows if not r["ok"]]
    report = {
        "ok": not failed,
        "active_model": health.get("active_model"),
        "local_llm": {"backend": backend, "url": url},
        "checks": rows,
    }
    REPORT.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print("REPORT", REPORT)
    return 1 if failed else 0


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


if __name__ == "__main__":
    sys.exit(main())
