"""Score the scripted code-agent task-splitting measurements. The Node script only measures."""
from __future__ import annotations


def score_code_split(rows: list[dict]) -> list[dict]:
    scored = []
    for row in rows:
        fields = row.get("fields") or {}
        reasons = check(str(row.get("id")), fields)
        scored.append({
            "id": row.get("id"),
            "suite": "code-split",
            "weight": row.get("weight") or 1,
            "ok": not reasons,
            "reasons": reasons,
        })
    return scored


def check(case_id: str, fields: dict) -> list[str]:
    reasons: list[str] = []

    def need(key: str, expected) -> None:
        if fields.get(key) != expected:
            reasons.append(f"{key}={fields.get(key)!r} expected {expected!r}")

    def flag(key: str) -> None:
        if fields.get(key) is not True:
            reasons.append(f"{key} is not true")

    if case_id == "split-order":
        need("order", ["def", "call", "spec"])
        need("writes", ["def", "call", "spec"])
        need("stopped", "finish")
        need("steps", 3)
        flag("reviewedBeforeWrite")
    elif case_id == "split-retry":
        need("tries", 3)
        need("plannerCalls", 0)
        flag("fixed")
        need("kind", "edit")
    elif case_id == "split-replan":
        flag("replanned")
        need("stopped", "finish")
        need("value", 4)
    elif case_id == "split-suggest":
        need("suggestion", "qwen3.5-4b-q6_k")
        need("downloaded", False)
        flag("unchanged")
        need("stopped", "failed")
        flag("mentionsDownload")
    elif case_id == "mode-gate":
        need("wroteBeforeAsk", False)
        flag("askUnchanged")
        flag("askNoCommand")
        flag("autoWrote")
        flag("autoRanCheck")
        flag("autoNoAsk")
        flag("pausedInstall")
        flag("blockedDelete")
    elif case_id == "fix-ts":
        flag("fixed")
        flag("legacyKept")
        flag("rolledBack")
        flag("sawAddDiagnostic")
        flag("skippedLegacy")
        need("introduced", "none")
        need("tries", 2)
    elif case_id == "fix-py":
        flag("fixed")
        flag("legacyKept")
        flag("rolledBack")
        flag("sawCalcDiagnostic")
        flag("skippedLegacy")
        flag("narrowBeforeFull")
        need("introduced", "none")
        need("tries", 2)
    else:
        reasons.append("unknown code-split case")
    return reasons
