"""Drop legacy tables: server-side chat + web-search leftovers

Removes the tables deleted with the legacy host / unused backend code:
- chat_messages      (gateway no longer stores chat history server-side; it lives on the device)
- search_requests, search_quota_daily, source_suggestions  (web-search leftovers, no code reads them)
- training_examples  (opt-in LoRA path storing chat-format messages; nothing imports it)

Old migrations are never edited; this migration is forward-only cleanup with a
faithful (empty-schema) downgrade.

Revision ID: 0006_drop_legacy
Revises: 0005_gateway
Create Date: 2026-10-22
"""
from alembic import op


revision = "0006_drop_legacy"
down_revision = "0005_gateway"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Drop removed tables (data is not recoverable by design)."""
    op.execute("DROP TABLE IF EXISTS training_examples")
    op.execute("DROP TABLE IF EXISTS source_suggestions")
    op.execute("DROP TABLE IF EXISTS search_quota_daily")
    op.execute("DROP TABLE IF EXISTS search_requests")
    op.execute("DROP TABLE IF EXISTS chat_messages")


def downgrade() -> None:
    """Recreate the tables (schema only; dropped data is gone)."""
    op.execute("""
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant')),
  content TEXT NOT NULL,
  model_id TEXT,
  tokens_used INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_user_created ON chat_messages(user_id, created_at DESC);
""")
    op.execute("""
CREATE TABLE IF NOT EXISTS search_requests (
  id              bigserial PRIMARY KEY,
  device_id       uuid REFERENCES devices(id) ON DELETE SET NULL,
  user_id         uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  privacy_mode    boolean NOT NULL DEFAULT true,
  query_text      text,
  query_hmac      bytea,
  agent_id        text,
  result_count    smallint,
  latency_ms      int,
  status          text NOT NULL CHECK (status IN ('ok','rate_limited','upstream_error','blocked')),
  CHECK (NOT privacy_mode OR query_text IS NULL)
);
CREATE INDEX IF NOT EXISTS idx_search_device_time ON search_requests(device_id, created_at DESC);
""")
    op.execute("""
CREATE TABLE IF NOT EXISTS search_quota_daily (
  device_id       uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  day             date NOT NULL,
  count           int NOT NULL DEFAULT 0,
  PRIMARY KEY (device_id, day)
);
""")
    op.execute("""
CREATE TABLE IF NOT EXISTS source_suggestions (
  id              bigserial PRIMARY KEY,
  domain          citext NOT NULL,
  niche_hint      text REFERENCES niches(id),
  times_seen      int NOT NULL DEFAULT 1,
  distinct_devices int NOT NULL DEFAULT 1,
  first_seen_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  status          text NOT NULL DEFAULT 'new' CHECK (status IN ('new','accepted','rejected','duplicate')),
  reviewed_by     uuid REFERENCES users(id),
  reviewer_notes  text,
  UNIQUE (domain, niche_hint)
);
""")
    op.execute("""
CREATE TABLE IF NOT EXISTS training_examples (
  id              bigserial PRIMARY KEY,
  agent_id        text NOT NULL REFERENCES agents(id),
  origin          text NOT NULL CHECK (origin IN ('user_feedback','expert_written','expert_corrected','synthetic')),
  user_id         uuid REFERENCES users(id) ON DELETE SET NULL,
  consent_at      timestamptz,
  messages        jsonb NOT NULL,
  pii_scrubbed    boolean NOT NULL DEFAULT false,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','used')),
  reviewed_by     uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (origin <> 'user_feedback' OR consent_at IS NOT NULL)
);
""")
