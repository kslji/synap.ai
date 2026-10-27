"""Curated OpenRouter model allowlist for Surf IDE, with credit tiers.

This module is the single source of truth for which models the IDE may use *and*
the purchase tier that unlocks each. Only famous, paid models are permitted; free
(``:free``) models are excluded and rejected at request time even though the pricing
sync still stores them in ``models_pricing``.

Tiers follow ADR 0008: a model is usable once the account's ``max_topup_credits``
reaches ``min_credits``. 1 credit = $0.40 (see ``credits.py``), so the tiers mean:

    min_credits 0  ->  free with the signup grant         (Tier 0 · Trial)
    min_credits 5  ->  unlocked by a $2 top-up            (Tier 1 · Daily)
    min_credits 25 ->  unlocked by a $10 top-up           (Tier 2 · Frontier)

Edit ``ALLOWED_MODELS`` to add or remove a model or change its tier; ``model_tiers``
is seeded from here at startup, so there is no second list to keep in sync.
"""
from __future__ import annotations

from dataclasses import dataclass

TRIAL = "Trial"
DAILY = "Daily"
FRONTIER = "Frontier"


@dataclass(frozen=True)
class AllowedModel:
    """A model the gateway will accept, and the tier that unlocks it."""

    model_id: str
    label: str
    provider: str
    min_credits: int
    tier_label: str


ALLOWED_MODELS: tuple[AllowedModel, ...] = (
    # Tier 0 · Trial — economy models a signup grant can run immediately.
    AllowedModel("google/gemini-2.5-flash", "Gemini 2.5 Flash", "Google", 0, TRIAL),
    # Tier 1 · Daily — balanced coding workhorses, unlocked by a $2 top-up.
    AllowedModel("openai/gpt-5-mini", "GPT-5 Mini", "OpenAI", 5, DAILY),
    AllowedModel("openai/gpt-4.1", "GPT-4.1", "OpenAI", 5, DAILY),
    AllowedModel("anthropic/claude-sonnet-4.5", "Claude Sonnet 4.5", "Anthropic", 5, DAILY),
    AllowedModel("deepseek/deepseek-chat", "DeepSeek V3", "DeepSeek", 5, DAILY),
    AllowedModel("qwen/qwen3-coder", "Qwen3 Coder", "Qwen", 5, DAILY),
    # Tier 2 · Frontier — heavy reasoning, unlocked by a $10 top-up.
    AllowedModel("openai/gpt-5", "GPT-5", "OpenAI", 25, FRONTIER),
    AllowedModel("google/gemini-2.5-pro", "Gemini 2.5 Pro", "Google", 25, FRONTIER),
    AllowedModel("x-ai/grok-4.5", "Grok 4.5", "xAI", 25, FRONTIER),
    AllowedModel("openai/o3", "o3", "OpenAI", 25, FRONTIER),
    AllowedModel("anthropic/claude-opus-4.5", "Claude Opus 4.5", "Anthropic", 25, FRONTIER),
)

_ALLOWED_BY_ID: dict[str, AllowedModel] = {m.model_id: m for m in ALLOWED_MODELS}


def is_allowed(model_id: str) -> bool:
    """True if the model is on the curated allowlist."""
    return model_id in _ALLOWED_BY_ID


def allowed_ids() -> tuple[str, ...]:
    """All permitted model IDs, in declaration order."""
    return tuple(_ALLOWED_BY_ID.keys())


def get(model_id: str) -> AllowedModel | None:
    """Return the allowlist entry for a model, or None if not permitted."""
    return _ALLOWED_BY_ID.get(model_id)


def min_credits(model_id: str) -> int:
    """The purchase tier a model needs. Unlisted models require the top tier, so a
    stale id can never silently fall through to the free tier."""
    entry = _ALLOWED_BY_ID.get(model_id)
    return entry.min_credits if entry else 25
