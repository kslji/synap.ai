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

-- Signup grant is kept separate from a real purchase, and max_topup_credits is the
-- monotonic purchase tier that unlocks model tiers (ADR 0008). Added idempotently so
-- an existing gateway_accounts table picks them up on the next ensure_schema.
ALTER TABLE gateway_accounts ADD COLUMN IF NOT EXISTS signup_credit NUMERIC(24,12) NOT NULL DEFAULT 0;
ALTER TABLE gateway_accounts ADD COLUMN IF NOT EXISTS max_topup_credits SMALLINT NOT NULL DEFAULT 0;

-- Credit tier per model. A standalone table (not a column on models_pricing) because
-- the 6-hour pricing sync wipes and repopulates models_pricing; tier maps are seeded
-- from model_allowlist at startup, never from the sync.
CREATE TABLE IF NOT EXISTS model_tiers (
  model_id TEXT PRIMARY KEY,
  min_credits SMALLINT NOT NULL DEFAULT 0,
  tier_label TEXT NOT NULL DEFAULT 'standard'
);

-- Auditable credit money movement: grant, purchase, spend, refund. user_id is TEXT
-- (not a UUID FK) so a Lite/test user id is valid too; reconciliation joins on the
-- external_ref / invoice_no the payment provider supplies.
CREATE TABLE IF NOT EXISTS credit_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('signup_grant','topup','spend','refund')),
  credits_delta NUMERIC(12,4) NOT NULL,
  usd_delta NUMERIC(24,12) NOT NULL,
  payment_provider TEXT,
  external_ref TEXT,
  invoice_no TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_user ON credit_ledger(user_id, created_at DESC);

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

    # --- Credit tiers (seeded from model_allowlist at startup, never by the sync) ---
    async def seed_model_tiers(self, models: list[tuple[str, int, str]]) -> None:
        """Upsert (model_id, min_credits, tier_label) rows from the allowlist."""
        async with self.pool.connection() as conn:
            async with conn.transaction():
                for model_id, min_credits, tier_label in models:
                    await conn.execute(
                        """
                        INSERT INTO model_tiers (model_id, min_credits, tier_label)
                        VALUES (%s, %s, %s)
                        ON CONFLICT (model_id) DO UPDATE
                        SET min_credits = EXCLUDED.min_credits, tier_label = EXCLUDED.tier_label
                        """,
                        (model_id, min_credits, tier_label),
                    )

    async def get_model_tier(self, model_id: str) -> dict[str, Any] | None:
        async with self.pool.connection() as conn:
            row = await conn.execute(
                "SELECT min_credits, tier_label FROM model_tiers WHERE model_id = %s",
                (model_id,),
            )
            result = await row.fetchone()
            if not result:
                return None
            return {"min_credits": int(result[0]), "tier_label": result[1]}

    async def list_model_tiers(self, model_ids: list[str]) -> dict[str, dict[str, Any]]:
        out: dict[str, dict[str, Any]] = {}
        for model_id in model_ids:
            tier = await self.get_model_tier(model_id)
            if tier:
                out[model_id] = tier
        return out

    # --- User Balance ---
    async def ensure_gateway_account(self, user_id: str, starting_credit: Decimal) -> None:
        """Create gateway account for user if it doesn't exist.

        ``starting_credit`` seeds both the balance and the ``signup_credit`` grant, so
        a purchase and the free trial are distinguishable. First creation of a funded
        account writes one ``signup_grant`` ledger row. Safe to re-run: an existing
        account is left untouched.
        """
        from .credits import CREDIT_USD
        async with self.pool.connection() as conn:
            async with conn.transaction():
                row = await conn.execute(
                    """
                    INSERT INTO gateway_accounts (user_id, balance, signup_credit)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (user_id) DO NOTHING
                    RETURNING user_id
                    """,
                    (user_id, starting_credit, starting_credit),
                )
                created = await row.fetchone()
                if created and starting_credit > 0:
                    await conn.execute(
                        """
                        INSERT INTO credit_ledger (user_id, kind, credits_delta, usd_delta)
                        VALUES (%s, 'signup_grant', %s, %s)
                        """,
                        (user_id, starting_credit / CREDIT_USD, starting_credit),
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

    async def get_max_topup_credits(self, user_id: str) -> int:
        """The account's monotonic purchase tier (0 if unknown)."""
        async with self.pool.connection() as conn:
            row = await conn.execute(
                "SELECT max_topup_credits FROM gateway_accounts WHERE user_id = %s",
                (user_id,),
            )
            result = await row.fetchone()
            return int(result[0]) if result else 0

    async def get_gateway_account(self, user_id: str) -> dict[str, Any] | None:
        """Full account view for the balance/tier endpoint."""
        async with self.pool.connection() as conn:
            row = await conn.execute(
                "SELECT balance, billing_locked, signup_credit, max_topup_credits FROM gateway_accounts WHERE user_id = %s",
                (user_id,),
            )
            result = await row.fetchone()
            if not result:
                return None
            return {
                "balance": result[0],
                "billing_locked": result[1],
                "signup_credit": result[2],
                "max_topup_credits": int(result[3]),
            }

    async def record_topup(
        self,
        user_id: str,
        *,
        credits: int,
        usd: Decimal,
        provider: str,
        external_ref: str | None = None,
        invoice_no: str | None = None,
    ) -> None:
        """Settle a paid top-up: add USD to balance, raise the purchase tier
        monotonically (GREATEST), and write a ``topup`` ledger row. A top-up is
        positive money so it also clears a billing lock."""
        async with self.pool.connection() as conn:
            async with conn.transaction():
                await self.ensure_gateway_account(user_id, Decimal("0"))
                row = await conn.execute(
                    "SELECT balance FROM gateway_accounts WHERE user_id = %s FOR UPDATE",
                    (user_id,),
                )
                current = (await row.fetchone())[0]
                new_balance = current + usd
                await conn.execute(
                    """
                    UPDATE gateway_accounts
                    SET balance = %s, max_topup_credits = GREATEST(max_topup_credits, %s),
                        billing_locked = (%s <= 0), updated_at = now()
                    WHERE user_id = %s
                    """,
                    (new_balance, credits, new_balance, user_id),
                )
                await conn.execute(
                    """
                    INSERT INTO credit_ledger
                        (user_id, kind, credits_delta, usd_delta, payment_provider, external_ref, invoice_no)
                    VALUES (%s, 'topup', %s, %s, %s, %s, %s)
                    """,
                    (user_id, credits, usd, provider, external_ref, invoice_no),
                )

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

                # Mirror the deduction into the credit ledger. credits_delta is the
                # USD spend expressed in fractional credits (4dp); spend never changes
                # the purchase tier, so max_topup_credits is left alone.
                from .credits import CREDIT_USD
                await conn.execute(
                    """
                    INSERT INTO credit_ledger (user_id, kind, credits_delta, usd_delta)
                    VALUES (%s, 'spend', %s, %s)
                    """,
                    (user_id, -(deduction / CREDIT_USD), -deduction),
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
    ) -> str:
        """Save billing audit transaction and return its ID.

        Token/cost accounting only: the server never persists model replies
        or user code (product rule; see 0007_drop_response_text).
        """
        async with self.pool.connection() as conn:
            row = await conn.execute(
                """
                INSERT INTO billing_transactions (
                    user_id, model_id, input_tokens, output_tokens,
                    raw_cost, markup_multiplier, final_deduction,
                    balance_before, balance_after
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
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
                ),
            )
            result = await row.fetchone()
            return str(result[0])


class MemoryGatewayStore:
    """In-memory gateway store for lite/dev mode."""

    def __init__(self):
        self.models_pricing: dict[str, dict[str, Any]] = {}
        self.model_tiers: dict[str, dict[str, Any]] = {}
        self.gateway_accounts: dict[str, dict[str, Any]] = {}
        self.billing_transactions: list[dict[str, Any]] = []
        self.credit_ledger: list[dict[str, Any]] = []

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

    # --- Credit tiers ---
    async def seed_model_tiers(self, models: list[tuple[str, int, str]]) -> None:
        for model_id, min_credits, tier_label in models:
            self.model_tiers[model_id] = {"min_credits": int(min_credits), "tier_label": tier_label}

    async def get_model_tier(self, model_id: str) -> dict[str, Any] | None:
        return self.model_tiers.get(model_id)

    async def list_model_tiers(self, model_ids: list[str]) -> dict[str, dict[str, Any]]:
        return {mid: self.model_tiers[mid] for mid in model_ids if mid in self.model_tiers}

    # --- User Balance ---
    async def ensure_gateway_account(self, user_id: str, starting_credit: Decimal) -> None:
        """Create gateway account for user if it doesn't exist."""
        from datetime import datetime, timezone
        if user_id not in self.gateway_accounts:
            self.gateway_accounts[user_id] = {
                "user_id": user_id,
                "balance": starting_credit,
                "billing_locked": False,
                "signup_credit": starting_credit,
                "max_topup_credits": 0,
                "created_at": datetime.now(timezone.utc),
                "updated_at": datetime.now(timezone.utc),
            }
            if starting_credit > 0:
                from .credits import CREDIT_USD
                self.credit_ledger.append({
                    "user_id": user_id, "kind": "signup_grant",
                    "credits_delta": starting_credit / CREDIT_USD, "usd_delta": starting_credit,
                    "payment_provider": None, "external_ref": None, "invoice_no": None,
                    "created_at": datetime.now(timezone.utc),
                })

    async def get_user_balance(self, user_id: str) -> tuple[Decimal, bool] | None:
        """Get user's balance and billing_locked status."""
        account = self.gateway_accounts.get(user_id)
        if not account:
            return None
        return (account["balance"], account["billing_locked"])

    async def get_max_topup_credits(self, user_id: str) -> int:
        account = self.gateway_accounts.get(user_id)
        return int(account.get("max_topup_credits", 0)) if account else 0

    async def get_gateway_account(self, user_id: str) -> dict[str, Any] | None:
        account = self.gateway_accounts.get(user_id)
        if not account:
            return None
        return {
            "balance": account["balance"],
            "billing_locked": account["billing_locked"],
            "signup_credit": account.get("signup_credit", Decimal("0")),
            "max_topup_credits": int(account.get("max_topup_credits", 0)),
        }

    async def record_topup(
        self,
        user_id: str,
        *,
        credits: int,
        usd: Decimal,
        provider: str,
        external_ref: str | None = None,
        invoice_no: str | None = None,
    ) -> None:
        from datetime import datetime, timezone
        await self.ensure_gateway_account(user_id, Decimal("0"))
        account = self.gateway_accounts[user_id]
        account["balance"] = account["balance"] + usd
        account["max_topup_credits"] = max(int(account["max_topup_credits"]), int(credits))
        account["billing_locked"] = account["balance"] <= Decimal("0")
        account["updated_at"] = datetime.now(timezone.utc)
        self.credit_ledger.append({
            "user_id": user_id, "kind": "topup", "credits_delta": Decimal(credits), "usd_delta": usd,
            "payment_provider": provider, "external_ref": external_ref, "invoice_no": invoice_no,
            "created_at": datetime.now(timezone.utc),
        })

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

        from .credits import CREDIT_USD
        self.credit_ledger.append({
            "user_id": user_id, "kind": "spend",
            "credits_delta": -(deduction / CREDIT_USD), "usd_delta": -deduction,
            "payment_provider": None, "external_ref": None, "invoice_no": None,
            "created_at": datetime.now(timezone.utc),
        })

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
    ) -> str:
        """Save billing audit transaction and return its ID (no reply content)."""
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
            "created_at": datetime.now(timezone.utc),
        })
        return tx_id
