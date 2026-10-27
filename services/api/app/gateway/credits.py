"""Credits — the fixed $0.40 conversion the product exposes as integer credits.

The gateway ledger stays exact USD (see ADR 0008). A *credit* is a coarse bundle of
expected workload (1 credit ≈ ~100 standard small-model turns), so a user reasons in
integers and a raw OpenRouter price move changes our margin, not what they unlock.
Every $→credit conversion in the product goes through here so the constant lives once.
"""
from __future__ import annotations

from decimal import ROUND_FLOOR, Decimal

# One credit is worth this many USD. 100 economy turns ≈ $0.40 at current pricing.
CREDIT_USD = Decimal("0.40")


def usd_to_credits(usd: Decimal | int | str) -> int:
    """Whole credits a USD amount buys, rounded down (never mint a partial credit)."""
    amount = usd if isinstance(usd, Decimal) else Decimal(str(usd))
    if amount <= 0:
        return 0
    return int((amount / CREDIT_USD).to_integral_value(rounding=ROUND_FLOOR))


def credits_to_usd(credits: int) -> Decimal:
    """The USD list price of an integer credit count (e.g. the 'unlock at' figure)."""
    return Decimal(credits) * CREDIT_USD
