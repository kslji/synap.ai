"""Database schema and store for OpenRouter gateway."""
from __future__ import annotations

import json
import logging
from decimal import Decimal
from typing import Any

log = logging.getLogger("surf.gateway.store")

SCHEMA = """
-- Model pricing from OpenRouter
CREATE TABLE IF NOT EXISTS models_pricing (
  model_id TEXT PRIMARY KEY,
  input_price_per_million NUMERIC(24,12) NOT NULL,
  output_price_per_million NUMERIC(24,12) NOT NULL,
  context_window INT NOT NULL,
  last_synced TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-user gateway account with balance
CREATE TABLE IF NOT EXISTS gateway_accounts (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  balance NUMERIC(24,12) NOT NULL DEFAULT 0.0,
  billing_locked BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Billing audit trail
CREATE TABLE IF NOT EXISTS billing_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL,
  input_tokens INT NOT NULL,
  output_tokens INT NOT NULL,
  raw_cost NUMERIC(24,12) NOT NULL,
  markup_multiplier NUMERIC(4,2) NOT NULL,
  final_deduction NUMERIC(24,12) NOT NULL,
  balance_before NUMERIC(24,12) NOT NULL,
  balance_after NUMERIC(24,12) NOT NULL,
  response_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_billing_transactions_user ON billing_transactions(user_id, created_at DESC);
"""


class PostgresGatewayStore:
    """Postgres-backed gateway store for pricing, balances, and chat history."""

    def __init__(self, pool):
        self.pool = pool

    async def ensure_schema(self) -> None:
        """Create gateway tables if they don't exist."""
        async with self.pool.connection() as conn:
            await conn.execute(SCHEMA)
        log.info("gateway schema ensured")

    # --- Pricing ---
    async def upsert_model_pricing(
        self,
        model_id: str,
        input_price_per_million: Decimal,
        output_price_per_million: Decimal,
        context_window: int,
    ) -> None:
        """Insert or update model pricing."""
        async with self.pool.connection() as conn:
            await conn.execute(
                """
                INSERT INTO models_pricing (model_id, input_price_per_million, output_price_per_million, context_window, last_synced)
                VALUES (%s, %s, %s, %s, now())
                ON CONFLICT (model_id) DO UPDATE
                SET input_price_per_million = EXCLUDED.input_price_per_million,
                    output_price_per_million = EXCLUDED.output_price_per_million,
                    context_window = EXCLUDED.context_window,
                    last_synced = now()
                """,
                (model_id, input_price_per_million, output_price_per_million, context_window),
            )

    async def get_model_pricing(self, model_id: str) -> dict[str, Any] | None:
        """Get pricing for a specific model."""
        async with self.pool.connection() as conn:
            row = await conn.execute(
                "SELECT model_id, input_price_per_million, output_price_per_million, context_window, last_synced FROM models_pricing WHERE model_id = %s",
                (model_id,),
            )
            result = await row.fetchone()
            if not result:
                return None
            return {
                "model_id": result[0],
                "input_price_per_million": result[1],
                "output_price_per_million": result[2],
                "context_window": result[3],
                "last_synced": result[4],
            }

    async def list_model_pricing(self, model_ids: list[str]) -> dict[str, dict[str, Any]]:
        """Get pricing for several models at once, keyed by model_id.

        Missing models are simply absent from the result, so callers can tell
        which allowlisted models have not been synced yet.
        """
        out: dict[str, dict[str, Any]] = {}
        for model_id in model_ids:
            pricing = await self.get_model_pricing(model_id)
            if pricing:
                out[model_id] = pricing
        return out

    # --- User Balance ---
    async def ensure_gateway_account(self, user_id: str, starting_credit: Decimal) -> None:
        """Create gateway account for user if it doesn't exist."""
        async with self.pool.connection() as conn:
            await conn.execute(
                """
                INSERT INTO gateway_accounts (user_id, balance)
                VALUES (%s, %s)
                ON CONFLICT (user_id) DO NOTHING
                """,
                (user_id, starting_credit),
            )

    async def get_user_balance(self, user_id: str) -> tuple[Decimal, bool] | None:
        """Get user's balance and billing_locked status."""
        async with self.pool.connection() as conn:
            row = await conn.execute(
                "SELECT balance, billing_locked FROM gateway_accounts WHERE user_id = %s",
                (user_id,),
            )
            result = await row.fetchone()
            if not result:
                return None
            return (result[0], result[1])

    async def update_user_balance(
        self,
        user_id: str,
        deduction: Decimal,
        balance_before: Decimal,
    ) -> tuple[Decimal, bool]:
        """Deduct from user balance and return new balance + locked status.
        
        Uses SELECT ... FOR UPDATE to prevent race conditions.
        """
        async with self.pool.connection() as conn:
            async with conn.transaction():
                # Lock the row
                row = await conn.execute(
                    "SELECT balance FROM gateway_accounts WHERE user_id = %s FOR UPDATE",
                    (user_id,),
                )
                result = await row.fetchone()
                if not result:
                    raise ValueError(f"Gateway account not found for user {user_id}")
                
                current_balance = result[0]
                new_balance = current_balance - deduction
                billing_locked = new_balance <= Decimal("0")
                
                await conn.execute(
                    """
                    UPDATE gateway_accounts
                    SET balance = %s, billing_locked = %s, updated_at = now()
                    WHERE user_id = %s
                    """,
                    (new_balance, billing_locked, user_id),
                )
                
                return (new_balance, billing_locked)

    # --- Billing Audit ---
    async def save_billing_transaction(
        self,
        user_id: str,
        model_id: str,
        input_tokens: int,
        output_tokens: int,
        raw_cost: Decimal,
        markup_multiplier: Decimal,
        final_deduction: Decimal,
        balance_before: Decimal,
        balance_after: Decimal,
        response_text: str | None = None,
    ) -> str:
        """Save billing audit transaction and return its ID."""
        async with self.pool.connection() as conn:
            row = await conn.execute(
                """
                INSERT INTO billing_transactions (
                    user_id, model_id, input_tokens, output_tokens,
                    raw_cost, markup_multiplier, final_deduction,
                    balance_before, balance_after, response_text
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (
                    user_id,
                    model_id,
                    input_tokens,
                    output_tokens,
                    raw_cost,
                    markup_multiplier,
                    final_deduction,
                    balance_before,
                    balance_after,
                    response_text,
                ),
            )
            result = await row.fetchone()
            return str(result[0])


class MemoryGatewayStore:
    """In-memory gateway store for lite/dev mode."""

    def __init__(self):
        self.models_pricing: dict[str, dict[str, Any]] = {}
        self.gateway_accounts: dict[str, dict[str, Any]] = {}
        self.billing_transactions: list[dict[str, Any]] = []

    async def ensure_schema(self) -> None:
        """No-op for memory store."""
        pass

    # --- Pricing ---
    async def upsert_model_pricing(
        self,
        model_id: str,
        input_price_per_million: Decimal,
        output_price_per_million: Decimal,
        context_window: int,
    ) -> None:
        """Insert or update model pricing."""
        from datetime import datetime, timezone
        self.models_pricing[model_id] = {
            "model_id": model_id,
            "input_price_per_million": input_price_per_million,
            "output_price_per_million": output_price_per_million,
            "context_window": context_window,
            "last_synced": datetime.now(timezone.utc),
        }

    async def get_model_pricing(self, model_id: str) -> dict[str, Any] | None:
        """Get pricing for a specific model."""
        return self.models_pricing.get(model_id)

    async def list_model_pricing(self, model_ids: list[str]) -> dict[str, dict[str, Any]]:
        """Get pricing for several models at once, keyed by model_id."""
        return {mid: self.models_pricing[mid] for mid in model_ids if mid in self.models_pricing}

    # --- User Balance ---
    async def ensure_gateway_account(self, user_id: str, starting_credit: Decimal) -> None:
        """Create gateway account for user if it doesn't exist."""
        from datetime import datetime, timezone
        if user_id not in self.gateway_accounts:
            self.gateway_accounts[user_id] = {
                "user_id": user_id,
                "balance": starting_credit,
                "billing_locked": False,
                "created_at": datetime.now(timezone.utc),
                "updated_at": datetime.now(timezone.utc),
            }

    async def get_user_balance(self, user_id: str) -> tuple[Decimal, bool] | None:
        """Get user's balance and billing_locked status."""
        account = self.gateway_accounts.get(user_id)
        if not account:
            return None
        return (account["balance"], account["billing_locked"])

    async def update_user_balance(
        self,
        user_id: str,
        deduction: Decimal,
        balance_before: Decimal,
    ) -> tuple[Decimal, bool]:
        """Deduct from user balance and return new balance + locked status."""
        account = self.gateway_accounts.get(user_id)
        if not account:
            raise ValueError(f"Gateway account not found for user {user_id}")
        
        from datetime import datetime, timezone
        new_balance = account["balance"] - deduction
        billing_locked = new_balance <= Decimal("0")
        
        account["balance"] = new_balance
        account["billing_locked"] = billing_locked
        account["updated_at"] = datetime.now(timezone.utc)
        
        return (new_balance, billing_locked)

    # --- Billing Audit ---
    async def save_billing_transaction(
        self,
        user_id: str,
        model_id: str,
        input_tokens: int,
        output_tokens: int,
        raw_cost: Decimal,
        markup_multiplier: Decimal,
        final_deduction: Decimal,
        balance_before: Decimal,
        balance_after: Decimal,
        response_text: str | None = None,
    ) -> str:
        """Save billing audit transaction and return its ID."""
        import uuid
        from datetime import datetime, timezone
        
        tx_id = str(uuid.uuid4())
        self.billing_transactions.append({
            "id": tx_id,
            "user_id": user_id,
            "model_id": model_id,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "raw_cost": raw_cost,
            "markup_multiplier": markup_multiplier,
            "final_deduction": final_deduction,
            "balance_before": balance_before,
            "balance_after": balance_after,
            "response_text": response_text,
            "created_at": datetime.now(timezone.utc),
        })
        return tx_id
