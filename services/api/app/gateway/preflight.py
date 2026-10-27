"""Pre-flight checks: token counting, cost calculation, safety buffers."""
from __future__ import annotations

import logging
import math
from decimal import Decimal

from .tokenizer import count_messages_tokens

log = logging.getLogger("surf.gateway.preflight")

# Safety buffer multiplier to absorb tokenizer discrepancies
SAFETY_BUFFER = Decimal("1.15")

# Ceiling for a zero-priced model. A 0 output price must not translate into "generate
# up to the entire context window": Surf bills paid models only, so a 0-priced row is
# an anomaly and we cap its output instead of trusting the free branch.
ZERO_PRICE_MAX_OUTPUT_TOKENS = 4096


class PreFlightError(Exception):
    """Base exception for pre-flight failures."""
    pass


class InsufficientBalanceError(PreFlightError):
    """User doesn't have enough balance to cover estimated cost."""
    def __init__(self, required: Decimal, available: Decimal):
        self.required = required
        self.available = available
        super().__init__(f"Insufficient balance: need ${required:.6f}, have ${available:.6f}")


class UnknownModelError(PreFlightError):
    """Model not found in pricing table."""
    def __init__(self, model_id: str):
        self.model_id = model_id
        super().__init__(f"Unknown model: {model_id}")


def calculate_estimated_cost(
    messages: list[dict[str, str]],
    input_price_per_million: Decimal,
    safety_buffer: Decimal = SAFETY_BUFFER,
) -> tuple[int, Decimal]:
    """Calculate estimated input cost with safety buffer.
    
    Args:
        messages: Chat messages to send
        input_price_per_million: Price per 1M input tokens
        safety_buffer: Multiplier for tokenizer discrepancy (default 1.15)
        
    Returns:
        (buffered_token_count, estimated_cost)
    """
    token_count = count_messages_tokens(messages)
    buffered_count = math.ceil(token_count * float(safety_buffer))
    
    # Cost = tokens * (price / 1,000,000)
    cost = Decimal(buffered_count) * input_price_per_million / Decimal("1000000")
    
    return (buffered_count, cost)


def calculate_max_tokens(
    balance: Decimal,
    estimated_input_cost: Decimal,
    output_price_per_million: Decimal,
    context_window: int | None = None,
) -> int:
    """Calculate maximum affordable output tokens.
    
    Formula:
        max_tokens = floor((balance - input_cost) / (output_price / 1M))
    
    Args:
        balance: User's current balance
        estimated_input_cost: Estimated cost for input tokens
        output_price_per_million: Price per 1M output tokens
        context_window: Optional model context window limit
        
    Returns:
        Maximum tokens the user can afford
    """
    if output_price_per_million <= Decimal("0"):
        # A paid gateway should never bill a 0-output-price model. Cap its output at a
        # safe ceiling rather than handing back the whole context window (the old
        # behaviour, which let a mispriced row trigger an enormous un-metered reply).
        return min(ZERO_PRICE_MAX_OUTPUT_TOKENS, context_window or ZERO_PRICE_MAX_OUTPUT_TOKENS)
    
    remaining_budget = balance - estimated_input_cost
    if remaining_budget <= Decimal("0"):
        return 0
    
    # max_tokens = remaining_budget / (output_price_per_million / 1,000,000)
    max_tokens = int(
        remaining_budget * Decimal("1000000") / output_price_per_million
    )
    
    # Cap by context window if provided
    if context_window and max_tokens > context_window:
        max_tokens = context_window
    
    return max(0, max_tokens)


def preflight_check(
    messages: list[dict[str, str]],
    balance: Decimal,
    input_price_per_million: Decimal,
    output_price_per_million: Decimal,
    context_window: int | None = None,
    safety_buffer: Decimal = SAFETY_BUFFER,
) -> tuple[int, int, Decimal]:
    """Run complete pre-flight check.
    
    Args:
        messages: Chat messages to send
        balance: User's current balance
        input_price_per_million: Price per 1M input tokens
        output_price_per_million: Price per 1M output tokens
        context_window: Optional model context window limit
        safety_buffer: Multiplier for tokenizer discrepancy
        
    Returns:
        (buffered_input_tokens, max_output_tokens, estimated_input_cost)
        
    Raises:
        InsufficientBalanceError: If balance can't cover estimated input cost
    """
    buffered_tokens, estimated_cost = calculate_estimated_cost(
        messages, input_price_per_million, safety_buffer
    )
    
    if balance < estimated_cost:
        raise InsufficientBalanceError(estimated_cost, balance)
    
    max_tokens = calculate_max_tokens(
        balance, estimated_cost, output_price_per_million, context_window
    )
    
    return (buffered_tokens, max_tokens, estimated_cost)
