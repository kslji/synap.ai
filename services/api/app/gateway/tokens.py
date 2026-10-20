"""Local prompt token counts for the pre-flight check (tiktoken cl100k_base, plus a buffer in billing.py)."""
from __future__ import annotations

import math
from functools import lru_cache

MESSAGE_OVERHEAD = 4
REPLY_PRIMER = 3


@lru_cache(maxsize=1)
def _encoding():
    try:
        import tiktoken

        return tiktoken.get_encoding("cl100k_base")
    except Exception:  # noqa: BLE001 - no tokenizer file offline; fall back to a conservative estimate
        return None


def count_text(text: str) -> int:
    enc = _encoding()
    if enc is None:
        return math.ceil(len(text) / 3)
    return len(enc.encode(text, disallowed_special=()))


def count_messages(messages: list[dict]) -> int:
    return sum(MESSAGE_OVERHEAD + count_text(str(m.get("content") or "")) for m in messages) + REPLY_PRIMER
