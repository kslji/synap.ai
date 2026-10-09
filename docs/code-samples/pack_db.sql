-- =====================================================================
-- pack.sqlite — PUBLIC, signed, read-only knowledge pack (one file per pack version)
-- Opened by the app with: file:pack.sqlite?mode=ro&immutable=1   (never written on the client)
-- =====================================================================
CREATE TABLE pack_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  -- pack_id, niche, version, schema_version, embedding_model, embedding_dim, built_at
CREATE TABLE sources (
  id INTEGER PRIMARY KEY, domain TEXT NOT NULL UNIQUE, title TEXT, license TEXT, trust_level INTEGER);
CREATE TABLE documents (
  id INTEGER PRIMARY KEY, doc_uid TEXT NOT NULL UNIQUE, source_id INTEGER REFERENCES sources(id),
  url TEXT, title TEXT, domain TEXT, niche TEXT NOT NULL, lang TEXT, license TEXT,
  published_at TEXT, fetched_at TEXT, version INTEGER NOT NULL);
CREATE TABLE chunks (
  id INTEGER PRIMARY KEY, chunk_uid TEXT NOT NULL UNIQUE, doc_id INTEGER NOT NULL REFERENCES documents(id),
  ord INTEGER NOT NULL, heading TEXT, text TEXT NOT NULL, token_count INTEGER NOT NULL);
CREATE INDEX idx_chunks_doc ON chunks(doc_id, ord);
CREATE VIRTUAL TABLE chunks_fts USING fts5(heading, text, content='chunks', content_rowid='id',
  tokenize='porter unicode61 remove_diacritics 2');
CREATE VIRTUAL TABLE chunk_vec USING vec0(chunk_id INTEGER PRIMARY KEY,
  embedding float[256] distance_metric=cosine);   -- EmbeddingGemma 2 @256 (manifest.embedding)
-- optional for very large packs: int8 copy for a fast first pass, then rescore with float
-- CREATE VIRTUAL TABLE chunk_vec_i8 USING vec0(chunk_id INTEGER PRIMARY KEY, embedding int8[256]);
