"""Curated OpenRouter model allowlist for Surf IDE.

This module is the single source of truth for which models the IDE may use.
Only famous, paid models from OpenAI, Anthropic, Google (Gemini) and a small
set of other well-known providers are permitted. Free (``:free``) models are
intentionally excluded and are rejected at request time even though the pricing
sync still stores them in ``models_pricing``.

Edit this file to add or remove a model; no other change is required.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class AllowedModel:
    """A model the gateway will accept and surface in the IDE picker."""

    model_id: str
    label: str
    provider: str


ALLOWED_MODELS: tuple[AllowedModel, ...] = (
    # OpenAI
    AllowedModel("openai/gpt-5", "GPT-5", "OpenAI"),
    AllowedModel("openai/gpt-5-mini", "GPT-5 Mini", "OpenAI"),
    AllowedModel("openai/gpt-4.1", "GPT-4.1", "OpenAI"),
    # Anthropic
    AllowedModel("anthropic/claude-sonnet-4.5", "Claude Sonnet 4.5", "Anthropic"),
    AllowedModel("anthropic/claude-opus-4.1", "Claude Opus 4.1", "Anthropic"),
    # Google (Gemini / Antigravity)
    AllowedModel("google/gemini-2.5-pro", "Gemini 2.5 Pro", "Google"),
    AllowedModel("google/gemini-2.5-flash", "Gemini 2.5 Flash", "Google"),
    # Other famous
    AllowedModel("x-ai/grok-4", "Grok 4", "xAI"),
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
