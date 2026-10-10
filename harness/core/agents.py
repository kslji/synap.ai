"""Score the code and assistant measurements. The Node script only measures."""
from __future__ import annotations


def score_agents(rows: list[dict]) -> list[dict]:
    scored = []
    for row in rows:
        fields = row.get("fields") or {}
        reasons: list[str] = []
        for key, value in fields.items():
            if key == "winner" and value not in {"bm25-symbols", "hybrid", "embeddinggemma", "qwen3-embedding"}:
                reasons.append(f"winner={value!r}")
            elif key == "coderank" and value != "not-feasible":
                reasons.append(f"coderank={value!r}")
            elif key == "qwenEmbedding" and value != "measured":
                reasons.append(f"qwenEmbedding={value!r}")
            elif key not in {"winner", "coderank", "qwenEmbedding"} and value is not True:
                reasons.append(f"{key}={value!r}")
        scored.append({
            "id": row.get("id"),
            "suite": row.get("suite") or "code",
            "weight": row.get("weight") or 1,
            "ok": not reasons,
            "reasons": reasons,
        })
    return scored
