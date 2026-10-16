"""Score the Step 11 suite. Every case must pass."""
from __future__ import annotations


def score_step11(rows: list[dict]) -> list[dict]:
    scored = []
    for row in rows:
        fields = row.get("fields") or {}
        ok = fields.get("ok") is True
        detail = str(fields.get("detail") or "")
        scored.append({
            "id": row.get("id"),
            "suite": "step11",
            "weight": row.get("weight") or 1,
            "ok": ok,
            "reasons": [] if ok else [detail or "case failed"],
        })
    return scored
