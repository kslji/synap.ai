-- =====================================================================
-- Production Postgres (16/17) + pgvector — Harbor backend & pipeline
-- Managed by Alembic migrations in services/api. Times are timestamptz (UTC).
-- =====================================================================
CREATE EXTENSION IF NOT EXISTS vector;     -- pgvector
CREATE EXTENSION IF NOT EXISTS citext;     -- case-insensitive email/domain
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()

-- ---------------------------------------------------------------------
-- Billing HOOK (not used in Phase 1; everyone is on 'free')
-- ---------------------------------------------------------------------
CREATE TABLE plans (
  code            text PRIMARY KEY,                    -- 'free', 'pro', 'fleet'
  name            text NOT NULL,
  features        jsonb NOT NULL DEFAULT '{}',          -- {"web_search_per_day":100,"packs":["general-core"],"max_devices":2}
  offline_grace_days int NOT NULL DEFAULT 30,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);
INSERT INTO plans(code, name, features) VALUES
  ('free', 'Free', '{"web_search_per_day":100,"max_devices":3,"packs":["general-core"]}');

CREATE TABLE subscriptions (                           -- placeholder for Stripe/Razorpay later
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL,                        -- FK added below
  plan_code       text NOT NULL REFERENCES plans(code),
  provider        text,                                 -- 'razorpay' | 'stripe' | 'manual'
  provider_ref    text,
  status          text NOT NULL CHECK (status IN ('trialing','active','past_due','cancelled','expired')),
  current_period_end timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- People & devices
-- ---------------------------------------------------------------------
CREATE TABLE users (                                   -- the "Person" table
  id              uuid PRIMARY KEY,                     -- = Supabase auth.users.id (JWT "sub")
  email           citext UNIQUE,
  display_name    text,
  country         text,                                 -- ISO-3166 alpha-2, optional
  occupation      text,                                 -- self-declared: 'marine_engineer', 'site_engineer' ...
  plan_code       text NOT NULL DEFAULT 'free' REFERENCES plans(code),
  roles           text[] NOT NULL DEFAULT '{}',         -- {'admin','curator','domain_expert'}
  telemetry_opt_in boolean NOT NULL DEFAULT false,
  training_opt_in boolean NOT NULL DEFAULT false,       -- may share rated answers for future LoRA
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz,
  deleted_at      timestamptz                           -- soft delete; hard-delete job after 30 days
);
ALTER TABLE subscriptions ADD CONSTRAINT fk_sub_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

CREATE TABLE devices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_uid      text NOT NULL,                        -- client-generated UUID
  name            text,
  os              text NOT NULL CHECK (os IN ('macos','windows','linux')),
  arch            text NOT NULL,
  app_version     text NOT NULL,
  hw_tier         smallint,
  ram_gb          smallint,
  device_pubkey   text,                                 -- Ed25519 public key; requests can be signed
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz,
  UNIQUE (user_id, device_uid)
);
CREATE INDEX idx_devices_user ON devices(user_id) WHERE status = 'active';

CREATE TABLE device_licenses (                         -- every offline license we sign (audit + revocation)
  jti             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id       uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  plan_code       text NOT NULL REFERENCES plans(code),
  features        jsonb NOT NULL,
  issued_at       timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,                 -- online-service validity (e.g. 30 days)
  signing_key_id  text NOT NULL,
  revoked_at      timestamptz
);
CREATE INDEX idx_licenses_device ON device_licenses(device_id, issued_at DESC);

-- Desktop API sessions. Supabase Auth proves identity once at login; our API then issues its own
-- short-lived access JWT + this rotating, device-bound refresh token (stored hashed). See §10.
CREATE TABLE auth_refresh_tokens (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id       uuid REFERENCES devices(id) ON DELETE CASCADE,
  token_hash      bytea NOT NULL UNIQUE,                -- SHA-256 of the opaque token; never store raw
  family_id       uuid NOT NULL,                        -- rotation family (reuse detection)
  issued_at       timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  revoked_at      timestamptz,
  replaced_by     uuid
);

-- ---------------------------------------------------------------------
-- Curation: niches & sources
-- ---------------------------------------------------------------------
CREATE TABLE niches (
  id              text PRIMARY KEY,                     -- 'general', 'marine', 'construction', 'aviation'
  name            text NOT NULL,
  description     text,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('planned','active','retired')),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sources (
  id              bigserial PRIMARY KEY,
  niche_id        text NOT NULL REFERENCES niches(id),
  domain          citext NOT NULL,                      -- 'imo.org'
  name            text,
  source_type     text NOT NULL CHECK (source_type IN ('commoncrawl','rss','sitemap','scrape','dump','api','manual')),
  feed_url        text,
  sitemap_url     text,
  include_patterns text[] NOT NULL DEFAULT '{}',        -- URL prefixes/regex to keep
  exclude_patterns text[] NOT NULL DEFAULT '{}',
  trust_level     smallint NOT NULL CHECK (trust_level BETWEEN 1 AND 5),  -- 5 = regulator/official
  crawl_frequency text NOT NULL CHECK (crawl_frequency IN ('daily','weekly','monthly','manual')),
  license         text,                                 -- 'CC BY-SA 4.0', 'public domain', 'permission on file', 'link-only'
  redistribution  text NOT NULL DEFAULT 'review' CHECK (redistribution IN ('full_text','excerpt_only','link_only','review')),
  robots_ok       boolean,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('candidate','active','paused','rejected')),
  last_crawled_at timestamptz,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (niche_id, domain, source_type)
);

CREATE TABLE source_suggestions (                      -- domains seen in live web answers (opt-in, domain only)
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

-- ---------------------------------------------------------------------
-- Ingestion: crawl runs, raw docs, Universal Table, chunks, embeddings
-- ---------------------------------------------------------------------
CREATE TABLE crawl_runs (
  id              bigserial PRIMARY KEY,
  kind            text NOT NULL CHECK (kind IN ('cc_monthly','rss','sitemap','scrape','dump','manual')),
  niche_id        text REFERENCES niches(id),
  cc_crawl_id     text,                                 -- 'CC-MAIN-2026-39'
  status          text NOT NULL DEFAULT 'running' CHECK (status IN ('running','succeeded','failed','partial')),
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz,
  r2_prefix       text,                                 -- raw/marine/CC-MAIN-2026-39/
  stats           jsonb NOT NULL DEFAULT '{}',          -- {"cdx_rows":..,"fetched":..,"kept":..,"dropped_quality":..}
  error           text
);

CREATE TABLE raw_documents (
  id              bigserial PRIMARY KEY,
  crawl_run_id    bigint NOT NULL REFERENCES crawl_runs(id),
  source_id       bigint REFERENCES sources(id),
  url             text NOT NULL,
  url_hash        bytea NOT NULL,                       -- sha256(canonical url)
  http_status     smallint,
  mime            text,
  payload_digest  text,                                 -- CC 'digest' (SHA-1 base32) or our sha256
  warc_filename   text,                                 -- CC path, NULL for own scraper
  warc_offset     bigint,
  warc_length     int,
  r2_key          text NOT NULL,                        -- where the raw record/HTML is stored
  fetched_at      timestamptz NOT NULL,
  UNIQUE (url_hash, payload_digest)
);
CREATE INDEX idx_raw_run ON raw_documents(crawl_run_id);

CREATE TABLE documents (                               -- the "Universal Table" (versioned)
  id              bigserial PRIMARY KEY,
  doc_uid         text NOT NULL,                        -- stable id: sha256(canonical url) hex[:32]
  version         int NOT NULL DEFAULT 1,               -- +1 whenever text_hash changes
  is_current      boolean NOT NULL DEFAULT true,
  url             text NOT NULL,
  domain          citext NOT NULL,
  niche_id        text NOT NULL REFERENCES niches(id),
  source_id       bigint REFERENCES sources(id),
  raw_document_id bigint REFERENCES raw_documents(id),
  crawl_run_id    bigint REFERENCES crawl_runs(id),
  title           text,
  text            text NOT NULL,                        -- cleaned main text (TOAST-compressed)
  text_hash       bytea NOT NULL,                       -- sha256(text) — change detection
  lang            text,
  lang_score      real,
  word_count      int,
  published_at    timestamptz,
  fetched_at      timestamptz NOT NULL,
  license         text,
  tags            jsonb NOT NULL DEFAULT '{}',          -- {"topics":["purifier"],"doc_type":"circular","imo_instrument":"SOLAS"}
  quality         jsonb NOT NULL DEFAULT '{}',          -- filter scores
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','superseded','removed','blocked')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (doc_uid, version)
);
CREATE UNIQUE INDEX uq_documents_current ON documents(doc_uid) WHERE is_current;
CREATE INDEX idx_documents_niche ON documents(niche_id, status, fetched_at DESC);
CREATE INDEX idx_documents_domain ON documents(domain);
CREATE INDEX idx_documents_tags ON documents USING gin (tags);

CREATE TABLE embedding_models (
  id              text PRIMARY KEY,                     -- 'embeddinggemma-2-text@256' (spec id, see embedding_spec.py)
  hf_model        text NOT NULL,                        -- 'google/embeddinggemma-2'
  file_name       text NOT NULL,                        -- 'embeddinggemma-2-Q8_0.gguf'
  file_sha256     text NOT NULL,
  native_dim      int NOT NULL,                         -- 768
  dim             int NOT NULL,                         -- 256 (Matryoshka truncation, re-normalised)
  pooling         text NOT NULL,                        -- 'mean'
  query_prefix    text NOT NULL,                        -- 'task: search result | query: '
  doc_template    text NOT NULL,                        -- 'title: {title} | text: {text}' 
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE chunks (
  id              bigserial PRIMARY KEY,
  document_id     bigint NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  ord             int NOT NULL,
  chunk_uid       text NOT NULL UNIQUE,                 -- sha256(doc_uid:version:ord:text)[:32]
  heading         text,
  text            text NOT NULL,
  token_count     int NOT NULL,
  chunker_version text NOT NULL,                        -- 'v1-350-50' — must match desktop
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, ord)
);

CREATE TABLE chunk_embeddings (
  chunk_id        bigint NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
  embedding_model_id text NOT NULL REFERENCES embedding_models(id),
  embedding       vector(256) NOT NULL,                 -- = embedding_models.dim; a new dim needs a new column/table
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chunk_id, embedding_model_id)
);
-- server-side similarity search (eval, dedup checks, admin search)
CREATE INDEX idx_chunk_emb_hnsw ON chunk_embeddings USING hnsw (embedding vector_cosine_ops);

-- ---------------------------------------------------------------------
-- Packs
-- ---------------------------------------------------------------------
CREATE TABLE packs (
  id              text PRIMARY KEY,                     -- 'general-core', 'marine-core', 'marine-engines'
  niche_id        text NOT NULL REFERENCES niches(id),
  title           text NOT NULL,
  description     text,
  min_plan_code   text NOT NULL DEFAULT 'free' REFERENCES plans(code),   -- billing hook
  target_size_mb  int,                                  -- budget for the builder
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','deprecated')),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE pack_versions (
  id              bigserial PRIMARY KEY,
  pack_id         text NOT NULL REFERENCES packs(id),
  version         text NOT NULL,                        -- calendar version '2026.10.08'
  status          text NOT NULL DEFAULT 'building'
                  CHECK (status IN ('building','built','eval_failed','approved','published','revoked')),
  embedding_model_id text NOT NULL REFERENCES embedding_models(id),
  chunker_version text NOT NULL,
  doc_count       int,
  chunk_count     int,
  size_bytes      bigint,
  snapshot_at     timestamptz NOT NULL,                 -- documents included = is_current as of this time
  manifest        jsonb,
  signature       bytea,                                -- Ed25519 over the manifest bytes
  signing_key_id  text,
  min_app_version text NOT NULL DEFAULT '0.1.0',
  eval_run_id     bigint,                               -- FK added after eval_runs
  published_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pack_id, version)
);
CREATE INDEX idx_pack_versions_pub ON pack_versions(pack_id, published_at DESC) WHERE status = 'published';

CREATE TABLE pack_files (
  id              bigserial PRIMARY KEY,
  pack_version_id bigint NOT NULL REFERENCES pack_versions(id) ON DELETE CASCADE,
  name            text NOT NULL,                        -- 'pack.sqlite.zst', 'manifest.json', 'manifest.sig', 'general-core.pack'
  role            text NOT NULL CHECK (role IN ('index','manifest','signature','usb_bundle','attribution')),
  r2_key          text NOT NULL,
  size_bytes      bigint NOT NULL,
  sha256          text NOT NULL,                        -- of the stored (compressed) bytes
  uncompressed_sha256 text,                             -- of pack.sqlite after decompression
  compression     text CHECK (compression IN ('none','zstd')),
  UNIQUE (pack_version_id, name)
);

CREATE TABLE pack_deltas (
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

CREATE TABLE device_pack_installs (
  device_id       uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  pack_version_id bigint NOT NULL REFERENCES pack_versions(id),
  status          text NOT NULL CHECK (status IN ('downloading','active','previous','failed','removed')),
  source          text NOT NULL CHECK (source IN ('download','usb')),
  reported_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, pack_version_id)
);

-- ---------------------------------------------------------------------
-- Web search proxy: rate limiting & audit (privacy-preserving)
-- ---------------------------------------------------------------------
CREATE TABLE search_requests (
  id              bigserial PRIMARY KEY,
  device_id       uuid REFERENCES devices(id) ON DELETE SET NULL,
  user_id         uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  privacy_mode    boolean NOT NULL DEFAULT true,
  query_text      text,                                 -- ALWAYS NULL when privacy_mode (the default)
  query_hmac      bytea,                                -- NULL in privacy mode; else HMAC(daily salt, query) for abuse detection
  agent_id        text,
  result_count    smallint,
  latency_ms      int,
  status          text NOT NULL CHECK (status IN ('ok','rate_limited','upstream_error','blocked')),
  CHECK (NOT privacy_mode OR query_text IS NULL)
);
CREATE INDEX idx_search_device_time ON search_requests(device_id, created_at DESC);

CREATE TABLE search_quota_daily (                      -- fast counter for rate limiting (or keep it in Valkey)
  device_id       uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  day             date NOT NULL,
  count           int NOT NULL DEFAULT 0,
  PRIMARY KEY (device_id, day)
);

-- ---------------------------------------------------------------------
-- Niche agents & evaluation (§9)
-- ---------------------------------------------------------------------
CREATE TABLE agents (
  id              text PRIMARY KEY,                     -- 'general', 'marine-engineer'
  niche_id        text NOT NULL REFERENCES niches(id),
  name            text NOT NULL,
  description     text,
  min_plan_code   text NOT NULL DEFAULT 'free' REFERENCES plans(code),
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','beta','active','retired')),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tools (                                   -- registry of tools agents may enable
  name            text PRIMARY KEY,                     -- 'calculator', 'unit_convert', 'marine_fault_lookup'
  description     text NOT NULL,
  json_schema     jsonb NOT NULL,                       -- OpenAI-style function parameters
  implementation  text NOT NULL,                        -- 'builtin:calculator' | 'builtin:unit_convert' | 'pack-sql:fault_codes'
  requires_network boolean NOT NULL DEFAULT false,
  safety_class    text NOT NULL DEFAULT 'safe' CHECK (safety_class IN ('safe','network','sensitive')),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE agent_versions (
  id              bigserial PRIMARY KEY,
  agent_id        text NOT NULL REFERENCES agents(id),
  version         text NOT NULL,                        -- semver '1.0.0'
  manifest        jsonb NOT NULL,                       -- full agent manifest (§9.2)
  manifest_sha256 text NOT NULL,
  signature       bytea,
  signing_key_id  text,
  base_model_req  jsonb NOT NULL,                       -- {"family":"qwen3","min_params_b":4,"ctx":8192}
  required_packs  text[] NOT NULL DEFAULT '{}',
  adapter_r2_key  text,                                 -- future LoRA GGUF
  status          text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','eval_failed','approved','published','revoked')),
  eval_run_id     bigint,
  created_by      uuid REFERENCES users(id),
  published_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, version)
);

CREATE TABLE agent_tools (                             -- which tools an agent version enables, with config
  agent_version_id bigint NOT NULL REFERENCES agent_versions(id) ON DELETE CASCADE,
  tool_name       text NOT NULL REFERENCES tools(name),
  config          jsonb NOT NULL DEFAULT '{}',          -- e.g. {"max_calls":3,"pack":"marine-core"}
  PRIMARY KEY (agent_version_id, tool_name)
);

CREATE TABLE eval_sets (
  id              bigserial PRIMARY KEY,
  agent_id        text REFERENCES agents(id),
  niche_id        text NOT NULL REFERENCES niches(id),
  name            text NOT NULL,                        -- 'marine-golden'
  version         int NOT NULL DEFAULT 1,
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','retired')),
  approved_by     uuid REFERENCES users(id),            -- domain expert sign-off
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (name, version)
);

CREATE TABLE eval_items (
  id              bigserial PRIMARY KEY,
  eval_set_id     bigint NOT NULL REFERENCES eval_sets(id) ON DELETE CASCADE,
  question        text NOT NULL,
  expected_behavior text NOT NULL CHECK (expected_behavior IN ('answer','refuse','tool','web')),
  reference_answer text,
  must_cite       text[] NOT NULL DEFAULT '{}',         -- doc_uids or URL prefixes that must be cited
  expected_numeric jsonb,                               -- {"value":12.5,"unit":"bar","tolerance":0.01}
  tags            text[] NOT NULL DEFAULT '{}',         -- {'purifier','safety-critical'}
  difficulty      smallint,
  author_id       uuid REFERENCES users(id),
  reviewer_id     uuid REFERENCES users(id),
  approved_at     timestamptz
);

CREATE TABLE eval_runs (
  id              bigserial PRIMARY KEY,
  eval_set_id     bigint NOT NULL REFERENCES eval_sets(id),
  agent_version_id bigint REFERENCES agent_versions(id),
  pack_version_id bigint REFERENCES pack_versions(id),
  chat_model      text NOT NULL,                        -- 'qwen3.5-4b-q4_k_m'
  hw_profile      text,                                 -- 'tier1-cpu' — run on the weakest supported tier
  status          text NOT NULL DEFAULT 'running' CHECK (status IN ('running','passed','failed','error')),
  metrics         jsonb NOT NULL DEFAULT '{}',          -- {"groundedness":0.93,"citation_accuracy":0.9,"refusal_correctness":0.95,"numeric_accuracy":1.0}
  thresholds      jsonb NOT NULL DEFAULT '{}',
  baseline_run_id bigint REFERENCES eval_runs(id),      -- previous published run (regression check)
  report_r2_key   text,
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz
);
ALTER TABLE pack_versions  ADD CONSTRAINT fk_pv_eval FOREIGN KEY (eval_run_id) REFERENCES eval_runs(id);
ALTER TABLE agent_versions ADD CONSTRAINT fk_av_eval FOREIGN KEY (eval_run_id) REFERENCES eval_runs(id);

CREATE TABLE eval_results (
  eval_run_id     bigint NOT NULL REFERENCES eval_runs(id) ON DELETE CASCADE,
  eval_item_id    bigint NOT NULL REFERENCES eval_items(id),
  answer          text,
  citations       jsonb,
  gate_decision   text,
  scores          jsonb NOT NULL,                       -- per-metric scores
  passed          boolean NOT NULL,
  PRIMARY KEY (eval_run_id, eval_item_id)
);

-- Future LoRA path: opt-in examples (no data arrives unless the user explicitly shares)
CREATE TABLE training_examples (
  id              bigserial PRIMARY KEY,
  agent_id        text NOT NULL REFERENCES agents(id),
  origin          text NOT NULL CHECK (origin IN ('user_feedback','expert_written','expert_corrected','synthetic')),
  user_id         uuid REFERENCES users(id) ON DELETE SET NULL,
  consent_at      timestamptz,                          -- required when origin = 'user_feedback'
  messages        jsonb NOT NULL,                       -- chat-format SFT sample incl. sources
  pii_scrubbed    boolean NOT NULL DEFAULT false,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','used')),
  reviewed_by     uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (origin <> 'user_feedback' OR consent_at IS NOT NULL)
);
