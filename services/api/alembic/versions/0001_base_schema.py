"""base schema — the full Postgres surface from deploy/initdb/01_schema.sql

Revision ID: 0001_base
Revises:
Create Date: 2026-10-22

Squashes the production bootstrap schema into the migration chain so that
`alembic upgrade head` builds everything on an empty database. Every statement
is idempotent (CREATE ... IF NOT EXISTS, ON CONFLICT DO NOTHING, guarded FK
adds) so the migration also coexists with the container's initdb step, which
runs the same DDL before the API container starts.

The DDL is executed with exec_driver_sql on purpose: the schema comments and
jsonb literals contain `:word` sequences (e.g. `"family":"qwen3"`) that
SQLAlchemy's text() would otherwise try to bind as parameters.
"""
from alembic import op

revision = "0001_base"
down_revision = None
branch_labels = None
depends_on = None

_SCHEMA_SQL = """
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS plans (
  code            text PRIMARY KEY,
  name            text NOT NULL,
  features        jsonb NOT NULL DEFAULT '{}',
  offline_grace_days int NOT NULL DEFAULT 30,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);
INSERT INTO plans(code, name, features) VALUES
  ('free', 'Free', '{"web_search_per_day":100,"max_devices":3,"packs":["general-core"]}')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS subscriptions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL,
  plan_code       text NOT NULL REFERENCES plans(code),
  provider        text,
  provider_ref    text,
  status          text NOT NULL CHECK (status IN ('trialing','active','past_due','cancelled','expired')),
  current_period_end timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           citext UNIQUE,
  display_name    text,
  country         text,
  occupation      text,
  plan_code       text NOT NULL DEFAULT 'free' REFERENCES plans(code),
  roles           text[] NOT NULL DEFAULT '{}',
  telemetry_opt_in boolean NOT NULL DEFAULT false,
  training_opt_in boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz,
  deleted_at      timestamptz
);
DO $$ BEGIN
  ALTER TABLE subscriptions ADD CONSTRAINT fk_sub_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL; WHEN invalid_table_definition THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS otp_challenges (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           citext NOT NULL,
  purpose         text NOT NULL DEFAULT 'login',
  code_hash       text NOT NULL,
  expires_at      timestamptz NOT NULL,
  attempts        int NOT NULL DEFAULT 0,
  consumed        boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_otp_email ON otp_challenges (email, created_at DESC);

CREATE TABLE IF NOT EXISTS devices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_uid      text NOT NULL,
  name            text,
  os              text NOT NULL CHECK (os IN ('macos','windows','linux')),
  arch            text NOT NULL,
  app_version     text NOT NULL,
  hw_tier         smallint,
  ram_gb          smallint,
  device_pubkey   text,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz,
  UNIQUE (user_id, device_uid)
);
CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS device_licenses (
  jti             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id       uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  plan_code       text NOT NULL REFERENCES plans(code),
  features        jsonb NOT NULL,
  issued_at       timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  signing_key_id  text NOT NULL,
  revoked_at      timestamptz
);
CREATE INDEX IF NOT EXISTS idx_licenses_device ON device_licenses(device_id, issued_at DESC);

INSERT INTO plans(code, name, features, offline_grace_days) VALUES
  ('pro', 'Pro', '{"max_devices":2,"packs":["general-core"]}', 7)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS licence_keys (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_hash        text NOT NULL UNIQUE,
  key_hint        text NOT NULL,
  plan_code       text NOT NULL REFERENCES plans(code),
  features        jsonb NOT NULL DEFAULT '[]',
  max_devices     int NOT NULL DEFAULT 2 CHECK (max_devices > 0),
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked','refunded')),
  provider        text,
  provider_ref    text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  revoked_at      timestamptz,
  refunded_at     timestamptz,
  term_months     int NOT NULL DEFAULT 1 CHECK (term_months IN (1, 3, 6, 12)),
  subscription_ends_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_licence_provider ON licence_keys (provider, provider_ref) WHERE provider_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_licence_user ON licence_keys (user_id);

CREATE TABLE IF NOT EXISTS licence_devices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  licence_id      uuid NOT NULL REFERENCES licence_keys(id) ON DELETE CASCADE,
  device_id_hash  text NOT NULL,
  name            text,
  os              text,
  activated_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz,
  deactivated_at  timestamptz,
  UNIQUE (licence_id, device_id_hash)
);

CREATE TABLE IF NOT EXISTS auth_refresh_tokens (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id       uuid REFERENCES devices(id) ON DELETE CASCADE,
  token_hash      bytea NOT NULL UNIQUE,
  family_id       uuid NOT NULL,
  issued_at       timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  revoked_at      timestamptz,
  replaced_by     uuid
);

CREATE TABLE IF NOT EXISTS niches (
  id              text PRIMARY KEY,
  name            text NOT NULL,
  description     text,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('planned','active','retired')),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sources (
  id              bigserial PRIMARY KEY,
  niche_id        text NOT NULL REFERENCES niches(id),
  domain          citext NOT NULL,
  name            text,
  source_type     text NOT NULL CHECK (source_type IN ('commoncrawl','rss','sitemap','scrape','dump','api','manual')),
  feed_url        text,
  sitemap_url     text,
  include_patterns text[] NOT NULL DEFAULT '{}',
  exclude_patterns text[] NOT NULL DEFAULT '{}',
  trust_level     smallint NOT NULL CHECK (trust_level BETWEEN 1 AND 5),
  crawl_frequency text NOT NULL CHECK (crawl_frequency IN ('daily','weekly','monthly','manual')),
  license         text,
  redistribution  text NOT NULL DEFAULT 'review' CHECK (redistribution IN ('full_text','excerpt_only','link_only','review')),
  robots_ok       boolean,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('candidate','active','paused','rejected')),
  last_crawled_at timestamptz,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (niche_id, domain, source_type)
);

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

CREATE TABLE IF NOT EXISTS crawl_runs (
  id              bigserial PRIMARY KEY,
  kind            text NOT NULL CHECK (kind IN ('cc_monthly','rss','sitemap','scrape','dump','manual')),
  niche_id        text REFERENCES niches(id),
  cc_crawl_id     text,
  status          text NOT NULL DEFAULT 'running' CHECK (status IN ('running','succeeded','failed','partial')),
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz,
  r2_prefix       text,
  stats           jsonb NOT NULL DEFAULT '{}',
  error           text
);

CREATE TABLE IF NOT EXISTS raw_documents (
  id              bigserial PRIMARY KEY,
  crawl_run_id    bigint NOT NULL REFERENCES crawl_runs(id),
  source_id       bigint REFERENCES sources(id),
  url             text NOT NULL,
  url_hash        bytea NOT NULL,
  http_status     smallint,
  mime            text,
  payload_digest  text,
  warc_filename   text,
  warc_offset     bigint,
  warc_length     int,
  r2_key          text NOT NULL,
  fetched_at      timestamptz NOT NULL,
  UNIQUE (url_hash, payload_digest)
);
CREATE INDEX IF NOT EXISTS idx_raw_run ON raw_documents(crawl_run_id);

CREATE TABLE IF NOT EXISTS embedding_models (
  id              text PRIMARY KEY,
  hf_model        text NOT NULL,
  file_name       text NOT NULL,
  file_sha256     text NOT NULL,
  native_dim      int NOT NULL,
  dim             int NOT NULL,
  pooling         text NOT NULL,
  query_prefix    text NOT NULL,
  doc_template    text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS documents (
  id              bigserial PRIMARY KEY,
  doc_uid         text NOT NULL,
  version         int NOT NULL DEFAULT 1,
  is_current      boolean NOT NULL DEFAULT true,
  url             text NOT NULL,
  domain          citext NOT NULL,
  niche_id        text NOT NULL REFERENCES niches(id),
  source_id       bigint REFERENCES sources(id),
  raw_document_id bigint REFERENCES raw_documents(id),
  crawl_run_id    bigint REFERENCES crawl_runs(id),
  title           text,
  text            text NOT NULL,
  text_hash       bytea NOT NULL,
  lang            text,
  lang_score      real,
  word_count      int,
  published_at    timestamptz,
  fetched_at      timestamptz NOT NULL,
  license         text,
  tags            jsonb NOT NULL DEFAULT '{}',
  quality         jsonb NOT NULL DEFAULT '{}',
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','superseded','removed','blocked')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (doc_uid, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_documents_current ON documents(doc_uid) WHERE is_current;
CREATE INDEX IF NOT EXISTS idx_documents_niche ON documents(niche_id, status, fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_domain ON documents(domain);
CREATE INDEX IF NOT EXISTS idx_documents_tags ON documents USING gin (tags);

CREATE TABLE IF NOT EXISTS chunks (
  id              bigserial PRIMARY KEY,
  document_id     bigint NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  ord             int NOT NULL,
  chunk_uid       text NOT NULL UNIQUE,
  heading         text,
  text            text NOT NULL,
  token_count     int NOT NULL,
  chunker_version text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, ord)
);

CREATE TABLE IF NOT EXISTS chunk_embeddings (
  chunk_id        bigint NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
  embedding_model_id text NOT NULL REFERENCES embedding_models(id),
  embedding       vector(256) NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chunk_id, embedding_model_id)
);
CREATE INDEX IF NOT EXISTS idx_chunk_emb_hnsw ON chunk_embeddings USING hnsw (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS packs (
  id              text PRIMARY KEY,
  niche_id        text NOT NULL REFERENCES niches(id),
  title           text NOT NULL,
  description     text,
  min_plan_code   text NOT NULL DEFAULT 'free' REFERENCES plans(code),
  target_size_mb  int,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','deprecated')),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pack_versions (
  id              bigserial PRIMARY KEY,
  pack_id         text NOT NULL REFERENCES packs(id),
  version         text NOT NULL,
  status          text NOT NULL DEFAULT 'building'
                  CHECK (status IN ('building','built','eval_failed','approved','published','revoked')),
  embedding_model_id text NOT NULL REFERENCES embedding_models(id),
  chunker_version text NOT NULL,
  doc_count       int,
  chunk_count     int,
  size_bytes      bigint,
  snapshot_at     timestamptz NOT NULL,
  manifest        jsonb,
  signature       bytea,
  signing_key_id  text,
  min_app_version text NOT NULL DEFAULT '0.1.0',
  eval_run_id     bigint,
  published_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pack_id, version)
);
CREATE INDEX IF NOT EXISTS idx_pack_versions_pub ON pack_versions(pack_id, published_at DESC) WHERE status = 'published';

CREATE TABLE IF NOT EXISTS pack_files (
  id              bigserial PRIMARY KEY,
  pack_version_id bigint NOT NULL REFERENCES pack_versions(id) ON DELETE CASCADE,
  name            text NOT NULL,
  role            text NOT NULL CHECK (role IN ('index','manifest','signature','usb_bundle','attribution')),
  r2_key          text NOT NULL,
  size_bytes      bigint NOT NULL,
  sha256          text NOT NULL,
  uncompressed_sha256 text,
  compression     text CHECK (compression IN ('none','zstd')),
  UNIQUE (pack_version_id, name)
);

CREATE TABLE IF NOT EXISTS pack_deltas (
  id              bigserial PRIMARY KEY,
  pack_id         text NOT NULL REFERENCES packs(id),
  from_version_id bigint NOT NULL REFERENCES pack_versions(id),
  to_version_id   bigint NOT NULL REFERENCES pack_versions(id),
  method          text NOT NULL DEFAULT 'zstd-patch-from',
  r2_key          text NOT NULL,
  size_bytes      bigint NOT NULL,
  sha256          text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (from_version_id, to_version_id)
);

CREATE TABLE IF NOT EXISTS device_pack_installs (
  device_id       uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  pack_version_id bigint NOT NULL REFERENCES pack_versions(id),
  status          text NOT NULL CHECK (status IN ('downloading','active','previous','failed','removed')),
  source          text NOT NULL CHECK (source IN ('download','usb')),
  reported_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, pack_version_id)
);

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

CREATE TABLE IF NOT EXISTS search_quota_daily (
  device_id       uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  day             date NOT NULL,
  count           int NOT NULL DEFAULT 0,
  PRIMARY KEY (device_id, day)
);

CREATE TABLE IF NOT EXISTS agents (
  id              text PRIMARY KEY,
  niche_id        text NOT NULL REFERENCES niches(id),
  name            text NOT NULL,
  description     text,
  min_plan_code   text NOT NULL DEFAULT 'free' REFERENCES plans(code),
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','beta','active','retired')),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tools (
  name            text PRIMARY KEY,
  description     text NOT NULL,
  json_schema     jsonb NOT NULL,
  implementation  text NOT NULL,
  requires_network boolean NOT NULL DEFAULT false,
  safety_class    text NOT NULL DEFAULT 'safe' CHECK (safety_class IN ('safe','network','sensitive')),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS eval_sets (
  id              bigserial PRIMARY KEY,
  agent_id        text REFERENCES agents(id),
  niche_id        text NOT NULL REFERENCES niches(id),
  name            text NOT NULL,
  version         int NOT NULL DEFAULT 1,
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','retired')),
  approved_by     uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (name, version)
);

CREATE TABLE IF NOT EXISTS agent_versions (
  id              bigserial PRIMARY KEY,
  agent_id        text NOT NULL REFERENCES agents(id),
  version         text NOT NULL,
  manifest        jsonb NOT NULL,
  manifest_sha256 text NOT NULL,
  signature       bytea,
  signing_key_id  text,
  base_model_req  jsonb NOT NULL,
  required_packs  text[] NOT NULL DEFAULT '{}',
  adapter_r2_key  text,
  status          text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','eval_failed','approved','published','revoked')),
  eval_run_id     bigint,
  created_by      uuid REFERENCES users(id),
  published_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, version)
);

CREATE TABLE IF NOT EXISTS agent_tools (
  agent_version_id bigint NOT NULL REFERENCES agent_versions(id) ON DELETE CASCADE,
  tool_name       text NOT NULL REFERENCES tools(name),
  config          jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (agent_version_id, tool_name)
);

CREATE TABLE IF NOT EXISTS eval_items (
  id              bigserial PRIMARY KEY,
  eval_set_id     bigint NOT NULL REFERENCES eval_sets(id) ON DELETE CASCADE,
  question        text NOT NULL,
  expected_behavior text NOT NULL CHECK (expected_behavior IN ('answer','refuse','tool','web')),
  reference_answer text,
  must_cite       text[] NOT NULL DEFAULT '{}',
  expected_numeric jsonb,
  tags            text[] NOT NULL DEFAULT '{}',
  difficulty      smallint,
  author_id       uuid REFERENCES users(id),
  reviewer_id     uuid REFERENCES users(id),
  approved_at     timestamptz
);

CREATE TABLE IF NOT EXISTS eval_runs (
  id              bigserial PRIMARY KEY,
  eval_set_id     bigint NOT NULL REFERENCES eval_sets(id),
  agent_version_id bigint REFERENCES agent_versions(id),
  pack_version_id bigint REFERENCES pack_versions(id),
  chat_model      text NOT NULL,
  hw_profile      text,
  status          text NOT NULL DEFAULT 'running' CHECK (status IN ('running','passed','failed','error')),
  metrics         jsonb NOT NULL DEFAULT '{}',
  thresholds      jsonb NOT NULL DEFAULT '{}',
  baseline_run_id bigint REFERENCES eval_runs(id),
  report_r2_key   text,
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz
);
DO $$ BEGIN
  ALTER TABLE pack_versions  ADD CONSTRAINT fk_pv_eval FOREIGN KEY (eval_run_id) REFERENCES eval_runs(id);
EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL; WHEN invalid_table_definition THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE agent_versions ADD CONSTRAINT fk_av_eval FOREIGN KEY (eval_run_id) REFERENCES eval_runs(id);
EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL; WHEN invalid_table_definition THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS eval_results (
  eval_run_id     bigint NOT NULL REFERENCES eval_runs(id) ON DELETE CASCADE,
  eval_item_id    bigint NOT NULL REFERENCES eval_items(id),
  answer          text,
  citations       jsonb,
  gate_decision   text,
  scores          jsonb NOT NULL,
  passed          boolean NOT NULL,
  PRIMARY KEY (eval_run_id, eval_item_id)
);

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
"""

_TABLES = [
    "training_examples", "eval_results", "eval_runs", "agent_tools", "agent_versions",
    "eval_items", "eval_sets", "tools", "agents", "search_quota_daily", "search_requests",
    "device_pack_installs", "pack_deltas", "pack_files", "pack_versions", "packs",
    "chunk_embeddings", "chunks", "embedding_models", "documents", "raw_documents",
    "crawl_runs", "source_suggestions", "sources", "niches", "auth_refresh_tokens",
    "licence_devices", "licence_keys", "device_licenses", "devices", "otp_challenges",
    "subscriptions", "users", "plans",
]


def upgrade() -> None:
    op.get_bind().exec_driver_sql(_SCHEMA_SQL)


def downgrade() -> None:
    conn = op.get_bind()
    for table in _TABLES:
        conn.exec_driver_sql(f"DROP TABLE IF EXISTS {table} CASCADE")
