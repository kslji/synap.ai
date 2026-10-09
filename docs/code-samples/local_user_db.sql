-- =====================================================================
-- user.db  — the user's PRIVATE database (SQLCipher-encrypted, read-write)
-- Opened by the Electron main process (better-sqlite3-multiple-ciphers, SQLCipher v4 mode) with a random 32-byte raw key
-- kept encrypted by Electron safeStorage (Keychain / DPAPI). See ts/db.ts and ts/key-store.ts.
-- then: PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
-- sqlite-vec is registered as an auto-extension before opening.
-- Timestamps: INTEGER unix epoch milliseconds (UTC). IDs: TEXT UUIDv7 unless noted.
-- =====================================================================

CREATE TABLE schema_migrations (
  version     INTEGER PRIMARY KEY,
  applied_at  INTEGER NOT NULL
);

-- ---------- settings, identity, device ----------
CREATE TABLE app_settings (
  key         TEXT PRIMARY KEY,                 -- e.g. 'privacy.offline_only', 'web.allowed', 'telemetry.opt_in'
  value_json  TEXT NOT NULL,                    -- JSON value: true / 3 / "dark"
  updated_at  INTEGER NOT NULL
);

CREATE TABLE user_profile (                     -- exactly one row (id = 1) once activated
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  user_id         TEXT NOT NULL,                -- Supabase auth user id (UUID)
  email           TEXT,
  display_name    TEXT,
  plan            TEXT NOT NULL DEFAULT 'free', -- billing hook (free | pro | team ...)
  features_json   TEXT NOT NULL DEFAULT '{}',   -- feature flags from the device license
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE TABLE session_cache (                    -- one row; SECRETS live in safeStorage-encrypted files (OS keychain), not here
  id                      INTEGER PRIMARY KEY CHECK (id = 1),
  device_license          TEXT,                 -- Ed25519-signed license token (verifiable offline)
  license_expires_at      INTEGER,              -- online services stop after this; offline core never does
  offline_grace_days      INTEGER NOT NULL DEFAULT 30,
  access_expires_at       INTEGER,              -- Supabase access token expiry (token itself in memory only)
  last_online_check_at    INTEGER,
  max_seen_wallclock      INTEGER NOT NULL DEFAULT 0, -- anti clock-rollback for license checks
  updated_at              INTEGER NOT NULL
);

CREATE TABLE device (                           -- this machine
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  device_id       TEXT NOT NULL UNIQUE,         -- UUID created on first launch
  server_device_id TEXT,                        -- id returned by POST /devices
  name            TEXT NOT NULL,                -- "Kabir's MacBook Air"
  os              TEXT NOT NULL,                -- macos | windows
  os_version      TEXT,
  arch            TEXT NOT NULL,                -- aarch64 | x86_64
  cpu_model       TEXT,
  cpu_cores       INTEGER,
  ram_bytes       INTEGER NOT NULL,
  gpus_json       TEXT NOT NULL DEFAULT '[]',   -- from `llama-server --list-devices`
  hw_tier         INTEGER NOT NULL,             -- 0..3, see §11
  device_pubkey   TEXT,                         -- Ed25519 public key (private key encrypted via safeStorage)
  registered_at   INTEGER,
  updated_at      INTEGER NOT NULL
);

-- ---------- models & agents ----------
CREATE TABLE models (
  id              TEXT PRIMARY KEY,             -- 'qwen3.5-4b-q4_k_m' (id from models.registry.json)
  kind            TEXT NOT NULL CHECK (kind IN ('chat','embedding','vision','mmproj','whisper','vad','lora','reranker')),
  family          TEXT NOT NULL,                -- 'qwen3.5', 'embeddinggemma-2', 'whisper'
  file_name       TEXT NOT NULL,
  path            TEXT NOT NULL,                -- absolute path in app data dir
  quant           TEXT,                         -- 'Q4_K_M', 'Q8_0'
  params_b        REAL,                         -- 4.0 (billions)
  size_bytes      INTEGER NOT NULL,
  sha256          TEXT NOT NULL,
  context_len     INTEGER,                      -- context we run it with
  min_ram_bytes   INTEGER,                      -- smallest RAM tier allowed
  hw_fit          TEXT NOT NULL DEFAULT 'ok' CHECK (hw_fit IN ('ok','slow','too_big')),
  base_model_id   TEXT REFERENCES models(id),   -- for LoRA adapters / mmproj: which base it belongs to
  license         TEXT,                         -- 'apache-2.0', 'mit'
  source_url      TEXT,
  status          TEXT NOT NULL DEFAULT 'installed' CHECK (status IN ('downloading','verifying','installed','failed','removed')),
  is_default      INTEGER NOT NULL DEFAULT 0,
  installed_at    INTEGER NOT NULL
);
CREATE INDEX idx_models_kind ON models(kind, status);

CREATE TABLE installed_agents (
  agent_id        TEXT NOT NULL,                -- 'general', 'marine-engineer'
  version         TEXT NOT NULL,                -- semver '1.2.0'
  name            TEXT NOT NULL,
  manifest_json   TEXT NOT NULL,                -- full verified manifest (§9.2)
  manifest_sha256 TEXT NOT NULL,
  signature       BLOB,                         -- Ed25519 over manifest bytes (NULL only for built-in)
  signing_key_id  TEXT,
  source          TEXT NOT NULL CHECK (source IN ('builtin','download','usb')),
  status          TEXT NOT NULL CHECK (status IN ('active','previous','disabled','failed')),
  adapter_model_id TEXT REFERENCES models(id),  -- optional LoRA (future)
  installed_at    INTEGER NOT NULL,
  PRIMARY KEY (agent_id, version)
);
CREATE UNIQUE INDEX uq_agent_active ON installed_agents(agent_id) WHERE status = 'active';

-- ---------- chats ----------
CREATE TABLE conversations (
  id              TEXT PRIMARY KEY,
  title           TEXT,
  agent_id        TEXT NOT NULL DEFAULT 'general',  -- current agent
  agent_version   TEXT,
  model_id        TEXT REFERENCES models(id),
  web_allowed     INTEGER NOT NULL DEFAULT 1,       -- per-conversation toggle
  offline_only    INTEGER NOT NULL DEFAULT 0,
  summary         TEXT,                             -- rolling summary = long-term memory of this chat
  summary_upto_message_id TEXT,
  pinned          INTEGER NOT NULL DEFAULT 0,
  archived        INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX idx_conv_updated ON conversations(archived, updated_at DESC);
CREATE INDEX idx_conv_agent ON conversations(agent_id, updated_at DESC);

CREATE TABLE agent_conversations (               -- history of which agent handled which part of a chat
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  agent_id        TEXT NOT NULL,
  agent_version   TEXT NOT NULL,
  routed_by       TEXT NOT NULL CHECK (routed_by IN ('user','auto')),
  route_confidence REAL,
  started_at      INTEGER NOT NULL,
  ended_at        INTEGER,
  PRIMARY KEY (conversation_id, started_at)
);

CREATE TABLE messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('system','user','assistant','tool')),
  content         TEXT NOT NULL,
  citations_json  TEXT NOT NULL DEFAULT '[]',   -- [{"n":1,"db":"pack:general-core@2026.10.08","chunk_id":123,
                                                --   "title":"...","url":"...","page":4,"date":"2026-09-30"}]
  tool_calls_json TEXT,                         -- assistant: [{"id":"call_1","name":"calculator","arguments":{...}}]
  tool_call_id    TEXT,                         -- tool role: which call this result answers
  agent_id        TEXT,
  gate_decision   TEXT CHECK (gate_decision IN ('answer','borderline','insufficient','web','refused')),
  grounding       TEXT CHECK (grounding IN ('local','web','mixed','none')),
  model_id        TEXT,
  tokens_in       INTEGER,
  tokens_out      INTEGER,
  latency_ms      INTEGER,
  status          TEXT NOT NULL DEFAULT 'complete' CHECK (status IN ('streaming','complete','error','cancelled')),
  created_at      INTEGER NOT NULL
);
CREATE INDEX idx_msg_conv ON messages(conversation_id, created_at);

CREATE TABLE agent_memory (                      -- per-agent facts the user chose to keep ("my engine is a MAN B&W 6S50ME-C")
  id              TEXT PRIMARY KEY,
  agent_id        TEXT NOT NULL,
  key             TEXT NOT NULL,                -- 'vessel.main_engine'
  value           TEXT NOT NULL,
  source_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  UNIQUE (agent_id, key)
);

CREATE TABLE tool_runs (
  id              TEXT PRIMARY KEY,
  message_id      TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  tool_name       TEXT NOT NULL,                -- calculator | unit_convert | web_search | marine_fault_lookup ...
  args_json       TEXT NOT NULL,
  result_json     TEXT,
  status          TEXT NOT NULL CHECK (status IN ('ok','error','timeout','denied')),
  error           TEXT,
  duration_ms     INTEGER,
  created_at      INTEGER NOT NULL
);
CREATE INDEX idx_toolruns_msg ON tool_runs(message_id);

-- ---------- attachments & private index ----------
CREATE TABLE attachments (
  id              TEXT PRIMARY KEY,
  sha256          TEXT NOT NULL UNIQUE,         -- content address: same file twice = one copy
  original_name   TEXT NOT NULL,
  mime            TEXT NOT NULL,
  size_bytes      INTEGER NOT NULL,
  stored_path     TEXT NOT NULL,                -- attachments/ab/cd/<sha256>.<ext> (encrypted at rest: §12)
  source          TEXT NOT NULL DEFAULT 'upload' CHECK (source IN ('upload','web_save','extension','usb')),
  conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  added_at        INTEGER NOT NULL
);

CREATE TABLE attachment_jobs (                  -- the background queue
  id              TEXT PRIMARY KEY,
  attachment_id   TEXT NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('convert','ocr','transcribe','video','embed','reindex')),
  status          TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed','cancelled','paused')),
  priority        INTEGER NOT NULL DEFAULT 5,   -- 1 = highest (file attached to the current chat)
  stage           TEXT,                         -- 'ocr page 12/40'
  progress        REAL NOT NULL DEFAULT 0,      -- 0..1
  resume_cursor   TEXT,                         -- JSON: {"last_page": 12} or {"last_ms": 600000}
  attempts        INTEGER NOT NULL DEFAULT 0,
  error           TEXT,
  created_at      INTEGER NOT NULL,
  started_at      INTEGER,
  finished_at     INTEGER
);
CREATE INDEX idx_jobs_pick ON attachment_jobs(status, priority, created_at);

CREATE TABLE documents (                        -- one per attachment / saved web page / note
  id              INTEGER PRIMARY KEY,          -- integer: used as FTS/vec rowid space parent
  attachment_id   TEXT REFERENCES attachments(id) ON DELETE CASCADE,
  source_type     TEXT NOT NULL CHECK (source_type IN ('file','web','note','extension','transcript')),
  title           TEXT NOT NULL,
  url             TEXT,
  mime            TEXT,
  lang            TEXT,
  page_count      INTEGER,
  duration_ms     INTEGER,
  collection      TEXT,                         -- user folders / tags
  meta_json       TEXT NOT NULL DEFAULT '{}',   -- author, created date, OCR stats, whisper model...
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ready','failed','deleted')),
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX idx_docs_status ON documents(status, source_type);

CREATE TABLE chunks (
  id              INTEGER PRIMARY KEY,
  document_id     INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  ord             INTEGER NOT NULL,             -- order within document
  heading         TEXT,                         -- nearest heading path "3 Fuel system > 3.2 Purifier"
  text            TEXT NOT NULL,
  token_count     INTEGER NOT NULL,
  page_start      INTEGER,                      -- for citations (PDF/PPTX slide)
  page_end        INTEGER,
  t_start_ms      INTEGER,                      -- for audio/video citations
  t_end_ms        INTEGER,
  ocr_confidence  REAL,
  created_at      INTEGER NOT NULL,
  UNIQUE (document_id, ord)
);

-- Keyword index; external-content so text is stored once (in chunks)
CREATE VIRTUAL TABLE chunks_fts USING fts5(
  heading, text,
  content = 'chunks', content_rowid = 'id',
  tokenize = 'porter unicode61 remove_diacritics 2'
);
CREATE TRIGGER chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts(rowid, heading, text) VALUES (new.id, new.heading, new.text);
END;
CREATE TRIGGER chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, heading, text) VALUES ('delete', old.id, old.heading, old.text);
END;
CREATE TRIGGER chunks_au AFTER UPDATE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, heading, text) VALUES ('delete', old.id, old.heading, old.text);
  INSERT INTO chunks_fts(rowid, heading, text) VALUES (new.id, new.heading, new.text);
END;

-- Vector index (sqlite-vec). Rows deleted by the app when chunks are deleted (no FK on virtual tables).
CREATE VIRTUAL TABLE chunk_vectors USING vec0(
  chunk_id     INTEGER PRIMARY KEY,
  embedding    float[256] distance_metric=cosine,   -- EmbeddingGemma 2, 768 -> 256 (Matryoshka), re-normalised
  source_type  TEXT                               -- metadata column: filter file/web/transcript in KNN
);

-- ---------- packs ----------
CREATE TABLE packs (
  pack_id         TEXT NOT NULL,                -- 'general-core', 'marine-core'
  version         TEXT NOT NULL,                -- '2026.10.08' (calendar versioning)
  niche           TEXT NOT NULL,
  title           TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('downloading','verifying','active','previous','failed','removed')),
  path            TEXT,                         -- packs/general-core/2026.10.08/pack.sqlite
  size_bytes      INTEGER,
  sha256          TEXT NOT NULL,
  manifest_json   TEXT NOT NULL,
  signature       BLOB NOT NULL,
  signing_key_id  TEXT NOT NULL,
  embedding_model TEXT NOT NULL,                -- must equal the installed embedding model id
  source          TEXT NOT NULL CHECK (source IN ('download','usb','bundled')),
  bytes_downloaded INTEGER NOT NULL DEFAULT 0,  -- resume support
  installed_at    INTEGER,
  activated_at    INTEGER,
  PRIMARY KEY (pack_id, version)
);
CREATE UNIQUE INDEX uq_pack_active ON packs(pack_id) WHERE status = 'active';

CREATE TABLE pack_sources (                     -- attribution shown in the UI ("This pack includes...")
  pack_id         TEXT NOT NULL,
  version         TEXT NOT NULL,
  domain          TEXT NOT NULL,
  title           TEXT,
  license         TEXT,                         -- 'CC BY-SA 4.0', 'public domain', 'publisher permission'
  trust_level     INTEGER,                      -- 1..5
  doc_count       INTEGER,
  PRIMARY KEY (pack_id, version, domain),
  FOREIGN KEY (pack_id, version) REFERENCES packs(pack_id, version) ON DELETE CASCADE
);

-- ---------- sync, web cache, feedback ----------
CREATE TABLE sync_state (
  key             TEXT PRIMARY KEY,             -- 'packs.manifest', 'agents.manifest', 'app.update'
  etag            TEXT,
  last_success_at INTEGER,
  last_attempt_at INTEGER,
  last_error      TEXT,
  value_json      TEXT
);

CREATE TABLE web_cache (
  id              INTEGER PRIMARY KEY,
  url             TEXT NOT NULL,
  url_hash        TEXT NOT NULL UNIQUE,
  title           TEXT,
  http_status     INTEGER,
  fetched_at      INTEGER NOT NULL,
  expires_at      INTEGER NOT NULL,             -- default fetched_at + 7 days
  document_id     INTEGER REFERENCES documents(id) ON DELETE SET NULL,  -- chunks live in chunks/chunk_vectors
  kept            INTEGER NOT NULL DEFAULT 0    -- user clicked "save to my library"
);
CREATE INDEX idx_webcache_exp ON web_cache(kept, expires_at);

CREATE TABLE feedback (
  id              TEXT PRIMARY KEY,
  message_id      TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  rating          INTEGER NOT NULL CHECK (rating IN (-1, 1)),
  reasons_json    TEXT NOT NULL DEFAULT '[]',   -- ["wrong_fact","bad_citation","should_refuse","too_long"]
  comment         TEXT,
  share_for_training INTEGER NOT NULL DEFAULT 0, -- explicit per-item opt-in (future LoRA dataset)
  shared_at       INTEGER,                       -- when (if ever) it was uploaded
  created_at      INTEGER NOT NULL
);
