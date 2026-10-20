"""Gateway tables: per-user balance, chat history, model prices, and the billing audit trail.

MemoryGatewayStore backs lite mode and tests. PostgresGatewayStore has the same methods.
Every read and write is keyed by user_id, so one user's history never reaches another's payload.
"""
from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass
from decimal import Decimal

from .billing import Pricing


def starting_credit() -> Decimal:
    return Decimal(os.environ.get("GATEWAY_STARTING_CREDIT", "0"))


@dataclass
class Account:
    user_id: str
    balance: Decimal
    billing_locked: bool


@dataclass
class Charge:
    balance_before: Decimal
    balance_after: Decimal
    billing_locked: bool
    audit_id: int


class MemoryGatewayStore:
    def __init__(self) -> None:
        self.accounts: dict[str, Account] = {}
        self.messages: list[dict] = []
        self.pricing: dict[str, Pricing] = {}
        self.audit: list[dict] = []
        self._lock = asyncio.Lock()

    async def ensure_schema(self) -> None:
        return None

    async def account(self, user_id: str) -> Account:
        if user_id not in self.accounts:
            credit = starting_credit()
            self.accounts[user_id] = Account(user_id, credit, credit <= 0)
        return self.accounts[user_id]

    async def set_balance(self, user_id: str, balance: Decimal) -> Account:
        balance = Decimal(balance)
        self.accounts[user_id] = Account(user_id, balance, balance <= 0)
        return self.accounts[user_id]

    async def history(self, user_id: str, limit: int = 50) -> list[dict]:
        rows = [m for m in self.messages if m["user_id"] == user_id]
        return [{"role": m["role"], "content": m["content"]} for m in rows[-limit:]]

    async def add_message(self, user_id: str, role: str, content: str) -> None:
        self.messages.append({"user_id": user_id, "role": role, "content": content})

    async def upsert_pricing(self, rows: list[Pricing]) -> int:
        for row in rows:
            self.pricing[row.model_id] = row
        return len(rows)

    async def get_pricing(self, model_id: str) -> Pricing | None:
        return self.pricing.get(model_id)

    async def charge(self, user_id: str, amount: Decimal, record: dict, prompt: str, reply: str) -> Charge:
        async with self._lock:
            account = await self.account(user_id)
            before = account.balance
            after = before - Decimal(amount)
            account.balance = after
            account.billing_locked = after <= 0
            audit_id = len(self.audit) + 1
            self.audit.append({**record, "id": audit_id, "user_id": user_id, "deduction": Decimal(amount),
                               "balance_before": before, "balance_after": after, "response_text": reply})
            await self.add_message(user_id, "user", prompt)
            if reply:
                await self.add_message(user_id, "assistant", reply)
            return Charge(before, after, account.billing_locked, audit_id)


SCHEMA = """
CREATE TABLE IF NOT EXISTS models_pricing (
  model_id text PRIMARY KEY,
  input_price_per_million numeric(24,12) NOT NULL,
  output_price_per_million numeric(24,12) NOT NULL,
  context_window int,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS gateway_accounts (
  user_id text PRIMARY KEY,
  balance numeric(24,12) NOT NULL,
  billing_locked boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS chat_messages (
  id bigserial PRIMARY KEY,
  user_id text NOT NULL,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_user ON chat_messages (user_id, id DESC);
CREATE TABLE IF NOT EXISTS billing_transactions (
  id bigserial PRIMARY KEY,
  user_id text NOT NULL,
  model_id text NOT NULL,
  generation_id text,
  prompt_tokens int NOT NULL,
  completion_tokens int NOT NULL,
  input_price_per_million numeric(24,12) NOT NULL,
  output_price_per_million numeric(24,12) NOT NULL,
  raw_cost numeric(24,12) NOT NULL,
  markup numeric(10,4) NOT NULL,
  deduction numeric(24,12) NOT NULL,
  balance_before numeric(24,12) NOT NULL,
  balance_after numeric(24,12) NOT NULL,
  response_text text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_billing_user ON billing_transactions (user_id, id DESC);
"""


class PostgresGatewayStore(MemoryGatewayStore):
    def __init__(self, pool) -> None:
        super().__init__()
        self.pool = pool

    async def ensure_schema(self) -> None:
        async with self.pool.connection() as conn:
            await conn.execute(SCHEMA)

    async def account(self, user_id: str) -> Account:
        credit = starting_credit()
        async with self.pool.connection() as conn:
            await conn.execute(
                "INSERT INTO gateway_accounts (user_id, balance, billing_locked) VALUES (%s, %s, %s) ON CONFLICT (user_id) DO NOTHING",
                (user_id, credit, credit <= 0),
            )
            row = await (await conn.execute("SELECT balance, billing_locked FROM gateway_accounts WHERE user_id = %s", (user_id,))).fetchone()
        return Account(user_id, Decimal(row[0]), bool(row[1]))

    async def set_balance(self, user_id: str, balance: Decimal) -> Account:
        balance = Decimal(balance)
        async with self.pool.connection() as conn:
            await conn.execute(
                """INSERT INTO gateway_accounts (user_id, balance, billing_locked) VALUES (%s, %s, %s)
                   ON CONFLICT (user_id) DO UPDATE SET balance = EXCLUDED.balance, billing_locked = EXCLUDED.billing_locked, updated_at = now()""",
                (user_id, balance, balance <= 0),
            )
        return Account(user_id, balance, balance <= 0)

    async def history(self, user_id: str, limit: int = 50) -> list[dict]:
        async with self.pool.connection() as conn:
            rows = await (await conn.execute(
                "SELECT role, content FROM chat_messages WHERE user_id = %s ORDER BY id DESC LIMIT %s", (user_id, limit),
            )).fetchall()
        return [{"role": r[0], "content": r[1]} for r in reversed(rows)]

    async def add_message(self, user_id: str, role: str, content: str) -> None:
        async with self.pool.connection() as conn:
            await conn.execute("INSERT INTO chat_messages (user_id, role, content) VALUES (%s, %s, %s)", (user_id, role, content))

    async def upsert_pricing(self, rows: list[Pricing]) -> int:
        async with self.pool.connection() as conn:
            async with conn.transaction():
                for row in rows:
                    await conn.execute(
                        """INSERT INTO models_pricing (model_id, input_price_per_million, output_price_per_million, context_window)
                           VALUES (%s, %s, %s, %s)
                           ON CONFLICT (model_id) DO UPDATE SET input_price_per_million = EXCLUDED.input_price_per_million,
                             output_price_per_million = EXCLUDED.output_price_per_million,
                             context_window = EXCLUDED.context_window, updated_at = now()""",
                        (row.model_id, row.input_price_per_million, row.output_price_per_million, row.context_window),
                    )
        return len(rows)

    async def get_pricing(self, model_id: str) -> Pricing | None:
        async with self.pool.connection() as conn:
            row = await (await conn.execute(
                "SELECT model_id, input_price_per_million, output_price_per_million, context_window FROM models_pricing WHERE model_id = %s",
                (model_id,),
            )).fetchone()
        return Pricing(row[0], Decimal(row[1]), Decimal(row[2]), row[3]) if row else None

    async def charge(self, user_id: str, amount: Decimal, record: dict, prompt: str, reply: str) -> Charge:
        await self.account(user_id)
        async with self.pool.connection() as conn:
            async with conn.transaction():
                row = await (await conn.execute("SELECT balance FROM gateway_accounts WHERE user_id = %s FOR UPDATE", (user_id,))).fetchone()
                before = Decimal(row[0])
                after = before - Decimal(amount)
                locked = after <= 0
                await conn.execute(
                    "UPDATE gateway_accounts SET balance = %s, billing_locked = %s, updated_at = now() WHERE user_id = %s",
                    (after, locked, user_id),
                )
                audit = await (await conn.execute(
                    """INSERT INTO billing_transactions (user_id, model_id, generation_id, prompt_tokens, completion_tokens,
                         input_price_per_million, output_price_per_million, raw_cost, markup, deduction, balance_before, balance_after, response_text)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
                    (user_id, record["model_id"], record.get("generation_id"), record["prompt_tokens"], record["completion_tokens"],
                     record["input_price_per_million"], record["output_price_per_million"], record["raw_cost"], record["markup"],
                     Decimal(amount), before, after, reply),
                )).fetchone()
                await conn.execute("INSERT INTO chat_messages (user_id, role, content) VALUES (%s, 'user', %s)", (user_id, prompt))
                if reply:
                    await conn.execute("INSERT INTO chat_messages (user_id, role, content) VALUES (%s, 'assistant', %s)", (user_id, reply))
        return Charge(before, after, locked, int(audit[0]))
