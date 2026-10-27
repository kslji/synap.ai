"""Post-flight billing: extract usage, calculate cost, deduct from balance."""
from __future__ import annotations

import logging
from decimal import Decimal
from typing import Any

log = logging.getLogger("surf.gateway.billing")


class BillingError(Exception):
    """Base exception for billing failures."""
    pass


def calculate_raw_cost(
    input_tokens: int,
    output_tokens: int,
    input_price_per_million: Decimal,
    output_price_per_million: Decimal,
) -> Decimal:
    """Calculate raw cost from OpenRouter usage.
    
    Formula:
        raw_cost = (input_tokens * input_price / 1M) + (output_tokens * output_price / 1M)
    
    Args:
        input_tokens: Number of input/prompt tokens
        output_tokens: Number of output/completion tokens
        input_price_per_million: Price per 1M input tokens
        output_price_per_million: Price per 1M output tokens
        
    Returns:
        Raw cost in USD
    """
    input_cost = Decimal(input_tokens) * input_price_per_million / Decimal("1000000")
    output_cost = Decimal(output_tokens) * output_price_per_million / Decimal("1000000")
    return input_cost + output_cost


def apply_markup(raw_cost: Decimal, markup_multiplier: Decimal) -> Decimal:
    """Apply markup to raw cost.
    
    Args:
        raw_cost: Raw cost from OpenRouter
        markup_multiplier: Markup multiplier (e.g., 1.20 for 20% markup)
        
    Returns:
        Final deduction amount
    """
    return raw_cost * markup_multiplier


def _first_int(usage: dict[str, Any], keys: tuple[str, ...]) -> int:
    """First present integer among the aliases, so a genuine 0 is kept (not skipped).
    A missing key contributes nothing."""
    for key in keys:
        value = usage.get(key)
        if value is not None:
            return int(value)
    return 0


def extract_usage(response: dict[str, Any]) -> tuple[int, int]:
    """Extract token usage from a provider response, normalised across providers.

    The gateway is OpenRouter today but will route direct calls to OpenAI, Anthropic
    and Google later, and each spells the usage block differently:

      - OpenRouter / OpenAI: prompt_tokens, completion_tokens
      - Anthropic /messages: input_tokens, output_tokens
      - Google generateContent: promptTokenCount, candidatesTokenCount

    Canonical model ids are `{provider}/{model}` and pricing/billing key off them, so
    only this extractor is provider-shaped; adding a direct route needs no schema change.

    Args:
        response: provider API response

    Returns:
        (input_tokens, output_tokens)
    """
    usage = response.get("usage", {}) or {}
    input_tokens = _first_int(usage, ("prompt_tokens", "input_tokens", "promptTokenCount"))
    output_tokens = _first_int(usage, ("completion_tokens", "output_tokens", "candidatesTokenCount"))
    return (input_tokens, output_tokens)


async def settle_billing(
    store: Any,
    user_id: str,
    model_id: str,
    response: dict[str, Any],
    markup_multiplier: Decimal,
    balance_before: Decimal,
) -> dict[str, Any]:
    """Settle billing after OpenRouter response.
    
    Args:
        store: Gateway store instance
        user_id: User ID
        model_id: Model ID
        response: OpenRouter response
        markup_multiplier: Markup multiplier
        balance_before: User's balance before this request
        
    Returns:
        Billing result dict with costs and new balance
        
    Raises:
        BillingError: If billing fails
    """
    try:
        # Extract usage from response
        input_tokens, output_tokens = extract_usage(response)
        
        # Get model pricing
        pricing = await store.get_model_pricing(model_id)
        if not pricing:
            raise BillingError(f"Model pricing not found for {model_id}")
        
        # Calculate raw cost
        raw_cost = calculate_raw_cost(
            input_tokens,
            output_tokens,
            pricing["input_price_per_million"],
            pricing["output_price_per_million"],
        )
        
        # Apply markup
        final_deduction = apply_markup(raw_cost, markup_multiplier)
        
        # Update balance
        new_balance, billing_locked = await store.update_user_balance(
            user_id=user_id,
            deduction=final_deduction,
            balance_before=balance_before,
        )
        
        # Save audit transaction
        tx_id = await store.save_billing_transaction(
            user_id=user_id,
            model_id=model_id,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            raw_cost=raw_cost,
            markup_multiplier=markup_multiplier,
            final_deduction=final_deduction,
            balance_before=balance_before,
            balance_after=new_balance,
        )
        
        result = {
            "transaction_id": tx_id,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "raw_cost": raw_cost,
            "markup_multiplier": markup_multiplier,
            "final_deduction": final_deduction,
            "balance_before": balance_before,
            "balance_after": new_balance,
            "billing_locked": billing_locked,
        }
        
        log.info(
            "user=%s model=%s tokens=%d/%d cost=$%.6f deduction=$%.6f balance=$%.6f locked=%s",
            user_id,
            model_id,
            input_tokens,
            output_tokens,
            raw_cost,
            final_deduction,
            new_balance,
            billing_locked,
        )
        
        return result
    except Exception as exc:
        log.error("billing settlement failed for user=%s: %s", user_id, exc)
        raise BillingError(f"Billing settlement failed: {exc}") from exc
