"""Score the desktop document measurements. The Node script only measures."""
from __future__ import annotations


def score_documents(rows: list[dict]) -> list[dict]:
    scored = []
    for row in rows:
        fields = row.get("fields") or {}
        reasons = check(str(row.get("id")), fields)
        scored.append({
            "id": row.get("id"),
            "suite": "documents",
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

    if case_id == "fill-docx":
        need("value", "Sea Lark")
        need("port", "Bergen")
        need("callSign", "GL-1")
        need("font", "Calibri")
        need("size", 24)
        need("color", "1F4E79")
        flag("bold")
        flag("italic")
        flag("untouched")
        flag("hashSame")
        flag("control")
        if not str(fields.get("citation") or "").startswith("line"):
            reasons.append("missing citation")
    elif case_id == "fill-acroform":
        need("value", "North")
        flag("contains")
        flag("hashSame")
        if abs(float(fields.get("size") or 0) - 12) > 0.6:
            reasons.append(f"font size {fields.get('size')}")
    elif case_id == "fill-plain-pdf":
        need("value", "Sea Lark")
        need("font", "Helvetica")
        flag("visible")
        flag("otherLine")
        flag("hashSame")
        need("pages", 1)
        if abs(float(fields.get("size") or 0) - 12) > 0.6:
            reasons.append("size drifted")
        if int(fields.get("outside") or 0) > 40:
            reasons.append(f"layout changed outside the blank ({fields.get('outside')} px)")
        if int(fields.get("changed") or 0) < 1:
            reasons.append("filled text did not change the page")
    elif case_id == "fill-shrink":
        flag("shrunk")
        need("pages", 1)
        if float(fields.get("size") or 99) >= 12:
            reasons.append("did not shrink")
    elif case_id == "fill-png":
        need("value", "12")
        need("width", 420)
        need("height", 140)
        flag("hashSame")
        if int(fields.get("boxes") or 0) < 1:
            reasons.append("no blank box")
    elif case_id == "fill-xlsx":
        need("value", "Bergen")
        need("other", "leave me")
        flag("hashSame")
    elif case_id == "fill-hindi":
        need("value", "समुद्र")
        flag("found")
    elif case_id == "fill-missing":
        need("value", "not found in source")
        need("found", False)
    elif case_id == "fill-injection":
        need("value", "LK-4401")
        need("pwned", False)
    elif case_id == "fill-math":
        need("value", "28")
    elif case_id == "fill-roles":
        need("ask", "ask")
        need("known", "template-first")
    elif case_id.startswith("convert-pdf-"):
        flag("hashSame")
        flag("magic")
        if case_id not in {"convert-pdf-png", "convert-pdf-jpeg"}:
            flag("hasRope")
    elif case_id == "convert-md-pdf":
        flag("magic")
        flag("hasCode")
        flag("warning")
    elif case_id == "convert-docx-pdf":
        flag("magic")
        flag("hasCode")
    elif case_id == "convert-html-pdf":
        flag("hasCode")
    elif case_id == "convert-png-pdf":
        flag("magic")
        flag("warning")
    elif case_id == "convert-intent":
        flag("word")
        flag("knots")
    elif case_id == "convert-sibling":
        flag("different")
        flag("docx")
    else:
        reasons.append("unknown document case")
    return reasons
