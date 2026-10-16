"""subscription length on licence keys

Revision ID: 0004_subscription
Revises: 0003_licences
Create Date: 2026-10-16
"""
from alembic import op

revision = "0004_subscription"
down_revision = "0003_licences"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
    ALTER TABLE licence_keys ADD COLUMN IF NOT EXISTS term_months int NOT NULL DEFAULT 1
    """)
    op.execute("""
    ALTER TABLE licence_keys ADD COLUMN IF NOT EXISTS subscription_ends_at timestamptz
    """)
    op.execute("""
    UPDATE licence_keys
    SET subscription_ends_at = created_at + interval '1 month'
    WHERE subscription_ends_at IS NULL
    """)
    op.execute("""
    ALTER TABLE licence_keys ALTER COLUMN subscription_ends_at SET NOT NULL
    """)
    op.execute("""
    DO $$ BEGIN
      ALTER TABLE licence_keys
        ADD CONSTRAINT licence_term_months CHECK (term_months IN (1, 3, 6, 12));
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$
    """)


def downgrade() -> None:
    op.execute("ALTER TABLE licence_keys DROP CONSTRAINT IF EXISTS licence_term_months")
    op.execute("ALTER TABLE licence_keys DROP COLUMN IF EXISTS subscription_ends_at")
    op.execute("ALTER TABLE licence_keys DROP COLUMN IF EXISTS term_months")
