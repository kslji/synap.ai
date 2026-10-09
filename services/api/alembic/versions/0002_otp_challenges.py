"""otp challenges for email login

Revision ID: 0002_otp
Revises:
Create Date: 2026-10-09
"""
from alembic import op

revision = "0002_otp"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
    CREATE TABLE IF NOT EXISTS otp_challenges (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email citext NOT NULL,
      purpose text NOT NULL DEFAULT 'login',
      code_hash text NOT NULL,
      expires_at timestamptz NOT NULL,
      attempts int NOT NULL DEFAULT 0,
      consumed boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now()
    )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_otp_email ON otp_challenges (email, created_at DESC)")
    op.execute("ALTER TABLE users ALTER COLUMN id SET DEFAULT gen_random_uuid()")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS otp_challenges")
