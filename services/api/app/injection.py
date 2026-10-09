"""Score untrusted passages for instruction-like text.

Flags are pattern ids. The passage text and the user's question are not stored.
The same rules live in injection_rules.json so the desktop scorer can match them.
"""
from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path

RULES = json.loads(Path(__file__).with_name("injection_rules.json").read_text(encoding="utf-8"))
HIGH = int(RULES["high"])
MEDIUM = int(RULES["medium"])


def _flags(text: str) -> int:
    value = 0
    if "i" in text:
        value |= re.IGNORECASE
    if "m" in text:
        value |= re.MULTILINE
    return value


_PATTERNS = [
    (item["id"], int(item["weight"]), re.compile(item["re"], _flags(item.get("flags", ""))))
    for item in RULES["patterns"]
]

# Zero-width, bidi overrides, and Unicode tag characters (U+E0000 block).
_CONTROLS = re.compile("[\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff\U000e0000-\U000e007f]")
_TEMPLATE = re.compile(r"<\|[^|>\n]{1,48}\|>")


def normalize_text(text: str) -> tuple[str, int]:
    folded = unicodedata.normalize("NFKC", text or "")
    removed = len(_CONTROLS.findall(folded))
    cleaned = _CONTROLS.sub("", folded)
    cleaned = _TEMPLATE.sub("", cleaned)
    return cleaned, removed


def score_text(text: str) -> dict:
    """Return score, pattern ids, and keep / downrank / drop. Does not store the text."""
    folded, _removed = normalize_text(text)
    score = 0
    flags: list[str] = []
    for name, weight, pattern in _PATTERNS:
        if pattern.search(folded):
            score += weight
            flags.append(name)
    action = "drop" if score >= HIGH else "downrank" if score >= MEDIUM else "keep"
    return {"score": score, "flags": flags, "action": action}


def filter_paragraphs(text: str) -> tuple[str, dict, list[dict]]:
    """Drop high-scoring paragraphs. Medium ones stay and downrank the chunk.

    Ignored entries are scores and flags only.
    """
    cleaned, _removed = normalize_text(text)
    paragraphs = [part.strip() for part in re.split(r"\n+", cleaned) if part.strip()]
    kept: list[str] = []
    ignored: list[dict] = []
    worst = "keep"
    flags: list[str] = []
    score = 0
    rank = {"keep": 0, "downrank": 1, "drop": 2}
    for paragraph in paragraphs:
        judged = score_text(paragraph)
        if judged["action"] == "drop":
            ignored.append({"score": judged["score"], "flags": judged["flags"]})
            continue
        kept.append(paragraph)
        flags.extend(flag for flag in judged["flags"] if flag not in flags)
        score = max(score, judged["score"])
        if rank[judged["action"]] > rank[worst]:
            worst = judged["action"]
    return "\n\n".join(kept), {"score": score, "flags": flags, "action": worst if kept else "drop"}, ignored
