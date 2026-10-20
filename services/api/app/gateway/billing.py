"""Money math for the OpenRouter gateway. Decimal only, prices are per 1M tokens."""
from __future__ import annotations

from dataclasses import dataclass
from decimal import ROUND_FLOOR, Decimal

MILLION = Decimal(1_000_000)
SAFETY_BUFFER = Decimal("1.15")
DEFAULT_MARKUP = Decimal("1.20")
FREE_MODEL_MAX_TOKENS = 4096


@dataclass(frozen=True)
class Pricing:
    model_id: str
    input_price_per_million: Decimal
    output_price_per_million: Decimal
    context_window: int | None = None


@dataclass(frozen=True)
class PreFlight:
    allowed: bool
    prompt_tokens: int
    buffered_tokens: Decimal
    estimated_input_cost: Decimal
    max_tokens: int


def buffered_tokens(prompt_tokens: int) -> Decimal:
    return Decimal(prompt_tokens) * SAFETY_BUFFER


def estimated_input_cost(prompt_tokens: int, input_price_per_million: Decimal) -> Decimal:
    return buffered_tokens(prompt_tokens) * Decimal(input_price_per_million) / MILLION


def max_affordable_output_tokens(balance: Decimal, input_cost: Decimal, output_price_per_million: Decimal) -> int:
    """(balance - input cost) / (output price per 1M / 1,000,000), rounded down."""
    left = Decimal(balance) - input_cost
    if left <= 0:
        return 0
    per_token = Decimal(output_price_per_million) / MILLION
    if per_token <= 0:
        return FREE_MODEL_MAX_TOKENS
    return int((left / per_token).to_integral_value(rounding=ROUND_FLOOR))


def preflight(balance: Decimal, prompt_tokens: int, pricing: Pricing) -> PreFlight:
    """Block when the buffered input alone costs more than the balance; otherwise cap max_tokens to what is left."""
    buffered = buffered_tokens(prompt_tokens)
    cost = estimated_input_cost(prompt_tokens, pricing.input_price_per_million)
    balance = Decimal(balance)
    if balance <= 0 or balance < cost:
        return PreFlight(False, prompt_tokens, buffered, cost, 0)
    limit = max_affordable_output_tokens(balance, cost, pricing.output_price_per_million)
    if pricing.context_window:
        room = pricing.context_window - int(buffered.to_integral_value(rounding=ROUND_FLOOR)) - 1
        limit = min(limit, max(room, 0))
    return PreFlight(limit >= 1, prompt_tokens, buffered, cost, limit)


def raw_cost(prompt_tokens: int, completion_tokens: int, input_price_per_million: Decimal, output_price_per_million: Decimal) -> Decimal:
    return (
        Decimal(prompt_tokens) * Decimal(input_price_per_million) / MILLION
        + Decimal(completion_tokens) * Decimal(output_price_per_million) / MILLION
    )


def final_deduction(raw: Decimal, markup: Decimal = DEFAULT_MARKUP) -> Decimal:
    return raw * Decimal(markup)
