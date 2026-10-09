/** Private document index. Applied as user.db migration 2, after the chat tables. */
export const LIBRARY_MIGRATION = `
CREATE TABLE attachments (
  id              TEXT PRIMARY KEY,
  sha256          TEXT NOT NULL UNIQUE,
  original_name   TEXT NOT NULL,
  mime            TEXT NOT NULL,
  size_bytes      INTEGER NOT NULL,
  stored_path     TEXT NOT NULL,
  added_at        INTEGER NOT NULL
);

CREATE TABLE conversation_files (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  attachment_id   TEXT NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
  added_at        INTEGER NOT NULL,
  PRIMARY KEY (conversation_id, attachment_id)
);

CREATE TABLE attachment_jobs (
  id              TEXT PRIMARY KEY,
  attachment_id   TEXT NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed','cancelled')),
  priority        INTEGER NOT NULL DEFAULT 5,
  stage           TEXT,
  progress        REAL NOT NULL DEFAULT 0,
  resume_cursor   TEXT,
  attempts        INTEGER NOT NULL DEFAULT 0,
  error           TEXT,
  created_at      INTEGER NOT NULL,
  started_at      INTEGER,
  finished_at     INTEGER
);
CREATE INDEX idx_jobs_pick ON attachment_jobs(status, priority, created_at);

CREATE TABLE documents (
  id              INTEGER PRIMARY KEY,
  attachment_id   TEXT NOT NULL UNIQUE REFERENCES attachments(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  mime            TEXT,
  page_count      INTEGER,
  content_hash    TEXT NOT NULL,
  meta_json       TEXT NOT NULL DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ready','failed')),
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE TABLE chunks (
  id              INTEGER PRIMARY KEY,
  document_id     INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  ord             INTEGER NOT NULL,
  heading         TEXT,
  text            TEXT NOT NULL,
  word_count      INTEGER NOT NULL,
  locator_kind    TEXT,
  locator_label   TEXT,
  page_start      INTEGER,
  page_end        INTEGER,
  created_at      INTEGER NOT NULL,
  UNIQUE (document_id, ord)
);

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

CREATE VIRTUAL TABLE chunk_vectors USING vec0(
  chunk_id INTEGER PRIMARY KEY,
  embedding float[256] distance_metric=cosine
);
`
