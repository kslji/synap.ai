"""Score the no-fabrication suite. Every case must pass. A miss is a failed gate."""
from __future__ import annotations

import re

# A quote chip links to the page. The host lives on that citation, not in the sentence.
_HOST = re.compile(r"[a-z0-9.-]+\.[a-z]{2,}", re.IGNORECASE)


def _host(needle: str) -> bool:
    return _HOST.fullmatch(needle) is not None


def score_no_fabrication(rows: list[dict]) -> list[dict]:
    scored = []
    for row in rows:
        fields = row.get("fields") or {}
        reasons: list[str] = []
        answer = str(fields.get("answer") or "")
        sources = str(fields.get("sources") or "")
        if fields.get("ok") is not True:
            reasons.append(str(fields.get("detail") or "case failed"))
        for needle in fields.get("forbidden") or []:
            text = str(needle)
            if text and (text in answer or (_host(text) and text in sources)):
                reasons.append(f"invented {text}")
        for needle in fields.get("required") or []:
            text = str(needle)
            if text in answer:
                continue
            if _host(text) and text in sources:
                continue
            reasons.append(f"missing {text}")
        scored.append({
            "id": row.get("id"),
            "suite": "no-fabrication",
            "weight": row.get("weight") or 1,
            "ok": not reasons,
            "reasons": reasons,
        })
    return scored
