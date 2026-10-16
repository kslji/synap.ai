"""Score screenshot OCR measurements. The Node script reads the fixtures."""
from __future__ import annotations


def score_screenshots(rows: list[dict]) -> list[dict]:
    scored = []
    for row in rows:
        fields = row.get("fields") or {}
        reasons = check(str(row.get("id")), fields)
        scored.append({
            "id": row.get("id"),
            "suite": "screenshots",
            "weight": row.get("weight") or 1,
            "ok": not reasons,
            "reasons": reasons,
        })
    return scored


def check(case_id: str, fields: dict) -> list[str]:
    reasons: list[str] = []
    needles = {
        "shot-type-error": ("TypeError", "map"),
        "shot-ts-error": ("TS2304", "formatName"),
        "shot-assert": ("AssertionError", "equal"),
    }.get(case_id)
    if needles is None:
        return ["unknown screenshot case"]
    extracted = str(fields.get("extracted") or "")
    if not extracted.strip():
        reasons.append("extracted text is empty")
    for needle in needles:
        if fields.get(needle) is not True and needle not in extracted:
            reasons.append(f"missing {needle}")
    return reasons
