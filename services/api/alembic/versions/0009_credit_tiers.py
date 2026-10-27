"""Credit tiers and unlocks (ADR 0008): model_tiers, account purchase tier, credit ledger

Adds the access layer on top of the micro-billing gateway from 0005:

  * gateway_accounts.signup_credit / max_topup_credits — the free trial grant kept
    distinct from a real purchase, and the monotonic purchase tier that unlocks
    model tiers.
  * model_tiers — per-model min_credits, seeded from model_allowlist at startup (a
    standalone table so the 6-hour models_pricing sync can never wipe it).
  * credit_ledger — auditable grant / top-up / spend / refund rows for reconciliation.

These mirror the DDL in app.gateway.store.SCHEMA, which the gateway also runs on
ensure_schema; every statement is IF NOT EXISTS / ADD COLUMN IF NOT EXISTS so a
fresh install (0001 -> ... -> this) and an existing deployment both land correctly.

Revision ID: 0009_credit_tiers
Revises: 0008_drop_web_search_feature
Create Date: 2026-10-27
"""
from alembic import op


revision = "0009_credit_tiers"
down_revision = "0008_drop_web_search_feature"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE gateway_accounts ADD COLUMN IF NOT EXISTS signup_credit NUMERIC(24,12) NOT NULL DEFAULT 0")
    op.execute("ALTER TABLE gateway_accounts ADD COLUMN IF NOT EXISTS max_topup_credits SMALLINT NOT NULL DEFAULT 0")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS model_tiers (
          model_id TEXT PRIMARY KEY,
          min_credits SMALLINT NOT NULL DEFAULT 0,
          tier_label TEXT NOT NULL DEFAULT 'standard'
        )
        """
    )
    op.execute(
        """
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
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_credit_ledger_user ON credit_ledger(user_id, created_at DESC)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS credit_ledger")
    op.execute("DROP TABLE IF EXISTS model_tiers")
    op.execute("ALTER TABLE gateway_accounts DROP COLUMN IF EXISTS max_topup_credits")
    op.execute("ALTER TABLE gateway_accounts DROP COLUMN IF EXISTS signup_credit")
