"""licence keys and device activations

Revision ID: 0003_licences
Revises: 0002_otp
Create Date: 2026-10-16
"""
from alembic import op

revision = "0003_licences"
down_revision = "0002_otp"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
    INSERT INTO plans(code, name, features, offline_grace_days)
    VALUES ('pro', 'Pro', '{"max_devices": 2,"packs":["general-core"]}', 7)
    ON CONFLICT (code) DO NOTHING
    """)
    op.execute("""
    CREATE TABLE IF NOT EXISTS licence_keys (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      key_hash text NOT NULL UNIQUE,
      key_hint text NOT NULL,
      plan_code text NOT NULL REFERENCES plans(code),
      features jsonb NOT NULL DEFAULT '[]',
      max_devices int NOT NULL DEFAULT 2 CHECK (max_devices > 0),
      status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked','refunded')),
      provider text,
      provider_ref text,
      created_at timestamptz NOT NULL DEFAULT now(),
      revoked_at timestamptz,
      refunded_at timestamptz
    )
    """)
    op.execute("""
    CREATE UNIQUE INDEX IF NOT EXISTS idx_licence_provider
      ON licence_keys (provider, provider_ref) WHERE provider_ref IS NOT NULL
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_licence_user ON licence_keys (user_id)")
    op.execute("""
    CREATE TABLE IF NOT EXISTS licence_devices (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      licence_id uuid NOT NULL REFERENCES licence_keys(id) ON DELETE CASCADE,
      device_id_hash text NOT NULL,
      name text,
      os text,
      activated_at timestamptz NOT NULL DEFAULT now(),
      last_seen_at timestamptz,
      deactivated_at timestamptz,
      UNIQUE (licence_id, device_id_hash)
    )
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS licence_devices")
    op.execute("DROP TABLE IF EXISTS licence_keys")
