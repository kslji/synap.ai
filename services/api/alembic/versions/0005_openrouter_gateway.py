"""OpenRouter gateway: model prices, per-user balance, chat history, billing audit

Revision ID: 0005_gateway
Revises: 0004_subscription
Create Date: 2026-10-20
"""
from alembic import op

from app.gateway.store import SCHEMA

revision = "0005_gateway"
down_revision = "0004_subscription"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(SCHEMA)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS billing_transactions, chat_messages, gateway_accounts, models_pricing")
