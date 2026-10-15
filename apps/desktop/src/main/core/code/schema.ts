/** Per-project code index. FTS5 for keywords, sqlite-vec for 256-d embeddings. */

export const CODE_SCHEMA = `
CREATE TABLE files (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  sha256 TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  mtime_ms INTEGER NOT NULL,
  language TEXT NOT NULL
);
CREATE TABLE symbols (
  id INTEGER PRIMARY KEY,
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  qualified TEXT NOT NULL,
  kind TEXT NOT NULL,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  signature TEXT NOT NULL,
  parent_name TEXT,
  text TEXT NOT NULL,
  module TEXT
);
CREATE INDEX idx_symbols_name ON symbols(name);
CREATE INDEX idx_symbols_qualified ON symbols(qualified);
CREATE INDEX idx_symbols_file ON symbols(file_id);
CREATE TABLE edges (
  id INTEGER PRIMARY KEY,
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  src_qualified TEXT,
  kind TEXT NOT NULL,
  dst_name TEXT NOT NULL,
  dst_module TEXT,
  dst_path TEXT,
  dst_symbol_id INTEGER,
  line INTEGER NOT NULL
);
CREATE INDEX idx_edges_dst ON edges(dst_name);
CREATE INDEX idx_edges_dst_sym ON edges(dst_symbol_id);
CREATE INDEX idx_edges_file ON edges(file_id);
CREATE TABLE chunks (
  id INTEGER PRIMARY KEY,
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  text TEXT NOT NULL,
  embedded INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_chunks_file ON chunks(file_id);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE VIRTUAL TABLE chunks_fts USING fts5(
  name, path, text,
  content='chunks', content_rowid='id',
  tokenize='unicode61'
);
CREATE TRIGGER chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts(rowid, name, path, text) VALUES (new.id, new.name, new.path, new.text);
END;
CREATE TRIGGER chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, name, path, text) VALUES ('delete', old.id, old.name, old.path, old.text);
END;
CREATE TRIGGER chunks_au AFTER UPDATE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, name, path, text) VALUES ('delete', old.id, old.name, old.path, old.text);
  INSERT INTO chunks_fts(rowid, name, path, text) VALUES (new.id, new.name, new.path, new.text);
END;
CREATE VIRTUAL TABLE chunk_vec USING vec0(
  chunk_id INTEGER PRIMARY KEY,
  embedding float[256]
);
`
