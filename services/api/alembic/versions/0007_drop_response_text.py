"""Drop billing_transactions.response_text: the server never stores AI replies

Product rule: the gateway may audit token/cost accounting but must not keep
the model's answer (or any user code) on the server. Fresh installs already
get the column-free schema from app.gateway.store.SCHEMA (imported by
0005_gateway); this migration removes the column from databases created
before the rule.

Old migrations are never edited; this is a forward-only cleanup. The
downgrade re-adds the (nullable) column but cannot restore dropped data.

Revision ID: 0007_drop_response_text
Revises: 0006_drop_legacy
Create Date: 2026-10-23
"""
from alembic import op


revision = "0007_drop_response_text"
down_revision = "0006_drop_legacy"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Remove the reply-content column (stored data is not recoverable by design)."""
    op.execute("ALTER TABLE billing_transactions DROP COLUMN IF EXISTS response_text")


def downgrade() -> None:
    """Recreate the column (schema only; the dropped replies are gone)."""
    op.execute("ALTER TABLE billing_transactions ADD COLUMN IF NOT EXISTS response_text TEXT")
