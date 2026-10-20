"""Builds the OpenRouter messages array from this user's history only. The backend is the source of truth."""
from __future__ import annotations

import os
from collections.abc import Callable

DEFAULT_SYSTEM_PROMPT = "You are Surf, a helpful assistant. Answer clearly and briefly."
ROLES = {"user", "assistant"}


def system_prompt() -> str:
    return os.environ.get("GATEWAY_SYSTEM_PROMPT", DEFAULT_SYSTEM_PROMPT)


def history_token_budget() -> int:
    return int(os.environ.get("GATEWAY_HISTORY_TOKENS", "2000"))


def compile_messages(history: list[dict], prompt: str, system: str, budget: int, count: Callable[[str], int]) -> list[dict]:
    """[system, ...newest history that fits `budget` tokens (oldest dropped first), user prompt].

    The window never starts on an assistant turn, so the array stays system → user → assistant → ….
    """
    kept: list[dict] = []
    used = 0
    for row in reversed([r for r in history if r.get("role") in ROLES and r.get("content")]):
        cost = count(row["content"])
        if used + cost > budget:
            break
        kept.append({"role": row["role"], "content": row["content"]})
        used += cost
    kept.reverse()
    while kept and kept[0]["role"] == "assistant":
        kept.pop(0)
    return [{"role": "system", "content": system}, *kept, {"role": "user", "content": prompt}]
