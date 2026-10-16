"""Score the no-fabrication suite. Every case must pass. A miss is a failed gate."""
from __future__ import annotations


def score_no_fabrication(rows: list[dict]) -> list[dict]:
    scored = []
    for row in rows:
        fields = row.get("fields") or {}
        reasons: list[str] = []
        answer = str(fields.get("answer") or "")
        if fields.get("ok") is not True:
            reasons.append(str(fields.get("detail") or "case failed"))
        for needle in fields.get("forbidden") or []:
            if needle and str(needle) in answer:
                reasons.append(f"invented {needle}")
        for needle in fields.get("required") or []:
            if str(needle) not in answer:
                reasons.append(f"missing {needle}")
        scored.append({
            "id": row.get("id"),
            "suite": "no-fabrication",
            "weight": row.get("weight") or 1,
            "ok": not reasons,
            "reasons": reasons,
        })
    return scored
