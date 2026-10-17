/**
 * Local index for granted folders. Keyword (FTS5) plus EmbeddingGemma-sized vectors.
 * Revoke deletes rows in this file only. User files are never removed.
 */
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import { migrate, openUserDb, vecExtensionPath, type DB } from '../db.js'
import { vectorBytes } from '../code/embed.js'
import { ftsQuery, rrfScore } from '../retrieval.js'

export const FILE_EMBED_DIM = 256

const FILE_SCHEMA = `
CREATE TABLE grants (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  scope TEXT NOT NULL,
  granted_at INTEGER NOT NULL,
  last_indexed_at INTEGER,
  file_count INTEGER NOT NULL DEFAULT 0,
  indexed_count INTEGER NOT NULL DEFAULT 0,
  byte_size INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  error TEXT
);
CREATE TABLE files (
  id INTEGER PRIMARY KEY,
  grant_id TEXT NOT NULL REFERENCES grants(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  name TEXT NOT NULL,
  mtime_ms INTEGER NOT NULL,
  size INTEGER NOT NULL,
  UNIQUE(grant_id, path)
);
CREATE TABLE chunks (
  id INTEGER PRIMARY KEY,
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  grant_id TEXT NOT NULL,
  path TEXT NOT NULL,
  name TEXT NOT NULL,
  heading TEXT,
  locator TEXT,
  text TEXT NOT NULL
);
CREATE INDEX idx_file_chunks_grant ON chunks(grant_id);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE VIRTUAL TABLE chunks_fts USING fts5(
  heading, path, name, text,
  content='chunks', content_rowid='id',
  tokenize='unicode61'
);
CREATE TRIGGER file_chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts(rowid, heading, path, name, text) VALUES (new.id, new.heading, new.path, new.name, new.text);
END;
CREATE TRIGGER file_chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, heading, path, name, text) VALUES ('delete', old.id, old.heading, old.path, old.name, old.text);
END;
CREATE TRIGGER file_chunks_au AFTER UPDATE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, heading, path, name, text) VALUES ('delete', old.id, old.heading, old.path, old.name, old.text);
  INSERT INTO chunks_fts(rowid, heading, path, name, text) VALUES (new.id, new.heading, new.path, new.name, new.text);
END;
CREATE VIRTUAL TABLE chunk_vec USING vec0(
  chunk_id INTEGER PRIMARY KEY,
  embedding float[${FILE_EMBED_DIM}]
);
`

const FILE_SCHEMA_V2 = `
ALTER TABLE grants ADD COLUMN embedder TEXT NOT NULL DEFAULT 'hash';
CREATE TABLE embed_stage (
  chunk_id INTEGER PRIMARY KEY,
  grant_id TEXT NOT NULL,
  embedding BLOB NOT NULL
);
`

export type FileDb = DB

export interface GrantRow {
  id: string
  path: string
  label: string
  scope: 'once' | 'always'
  grantedAt: number
  lastIndexedAt: number | null
  fileCount: number
  indexedCount: number
  byteSize: number
  status: string
  error: string | null
  embedder: 'gemma' | 'hash'
}

export interface StoredChunk {
  heading: string | null
  locator: string | null
  text: string
  vector: Float32Array
}

export interface RankedChunk {
  id: number
  path: string
  name: string
  heading: string | null
  locator: string | null
  text: string
  cosine: number
  rrf: number
}

export function openFileDb(path: string, keyHex: string | null): FileDb {
  mkdirSync(dirname(path), { recursive: true })
  const db = keyHex ? openUserDb(path, keyHex, [FILE_SCHEMA, FILE_SCHEMA_V2]) : openPlain(path)
  normalizeEmbedderMeta(db)
  return db
}

function openPlain(path: string): FileDb {
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  db.loadExtension(vecExtensionPath())
  migrate(db, [FILE_SCHEMA, FILE_SCHEMA_V2])
  return db
}

function normalizeEmbedderMeta(db: FileDb): void {
  db.prepare(`UPDATE grants SET status = 'ready' WHERE status = 'indexing'`).run()
  const saved = metaGet(db, 'embedder')
  if (saved === 'gemma') db.prepare(`UPDATE grants SET embedder = 'gemma'`).run()
  if (saved === 'hash' || saved === 'gemma') db.prepare(`DELETE FROM meta WHERE key = 'embedder'`).run()
}

const GRANT_COLUMNS = `id, path, label, scope, granted_at AS grantedAt, last_indexed_at AS lastIndexedAt, file_count AS fileCount, indexed_count AS indexedCount, byte_size AS byteSize, status, error, embedder`

export function metaGet(db: FileDb, key: string): string | null {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function metaSet(db: FileDb, key: string, value: string): void {
  db.prepare('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
}

export function listGrants(db: FileDb): GrantRow[] {
  const rows = db.prepare(`SELECT ${GRANT_COLUMNS} FROM grants ORDER BY granted_at`).all() as GrantRow[]
  return rows.map(withEmbedder)
}

export function getGrant(db: FileDb, id: string): GrantRow | null {
  const row = db.prepare(`SELECT ${GRANT_COLUMNS} FROM grants WHERE id = ?`).get(id) as GrantRow | undefined
  return row ? withEmbedder(row) : null
}

function withEmbedder(row: GrantRow): GrantRow {
  return { ...row, embedder: row.embedder === 'gemma' ? 'gemma' : 'hash' }
}

export function upsertGrant(db: FileDb, row: { id: string; path: string; label: string; scope: 'once' | 'always'; grantedAt: number }): void {
  db.prepare(`INSERT INTO grants(id, path, label, scope, granted_at, status)
    VALUES (?, ?, ?, ?, ?, 'idle')
    ON CONFLICT(path) DO UPDATE SET label = excluded.label, scope = excluded.scope, status = 'idle', error = NULL`).run(row.id, row.path, row.label, row.scope, row.grantedAt)
}

export function updateGrantProgress(db: FileDb, id: string, patch: { fileCount?: number; indexedCount?: number; byteSize?: number; status?: string; error?: string | null; lastIndexedAt?: number | null; embedder?: 'gemma' | 'hash' }): void {
  const current = getGrant(db, id)
  if (!current) return
  db.prepare(`UPDATE grants SET file_count = ?, indexed_count = ?, byte_size = ?, status = ?, error = ?, last_indexed_at = ?, embedder = ? WHERE id = ?`).run(
    patch.fileCount ?? current.fileCount,
    patch.indexedCount ?? current.indexedCount,
    patch.byteSize ?? current.byteSize,
    patch.status ?? current.status,
    patch.error === undefined ? current.error : patch.error,
    patch.lastIndexedAt === undefined ? current.lastIndexedAt : patch.lastIndexedAt,
    patch.embedder ?? current.embedder,
    id,
  )
}

export function dropSessionGrants(db: FileDb): void {
  const rows = db.prepare(`SELECT id FROM grants WHERE scope = 'once'`).all() as { id: string }[]
  for (const row of rows) revokeGrant(db, row.id)
}

export function revokeGrant(db: FileDb, id: string): void {
  const ids = db.prepare('SELECT id FROM chunks WHERE grant_id = ?').all(id) as { id: number }[]
  for (const row of ids) deleteVector(db, row.id)
  db.prepare('DELETE FROM grants WHERE id = ?').run(id)
}

export function chunkCount(db: FileDb, grantId?: string): number {
  if (!grantId) return (db.prepare('SELECT COUNT(*) AS n FROM chunks').get() as { n: number }).n
  return (db.prepare('SELECT COUNT(*) AS n FROM chunks WHERE grant_id = ?').get(grantId) as { n: number }).n
}

export function fileRow(db: FileDb, grantId: string, path: string): { id: number; mtimeMs: number; size: number } | null {
  const row = db.prepare('SELECT id, mtime_ms AS mtimeMs, size FROM files WHERE grant_id = ? AND path = ?').get(grantId, path) as { id: number; mtimeMs: number; size: number } | undefined
  return row ?? null
}

export function forgetFile(db: FileDb, fileId: number): void {
  const ids = db.prepare('SELECT id FROM chunks WHERE file_id = ?').all(fileId) as { id: number }[]
  for (const row of ids) deleteVector(db, row.id)
  db.prepare('DELETE FROM files WHERE id = ?').run(fileId)
}

export function listFilePaths(db: FileDb, grantId: string): { id: number; path: string }[] {
  return db.prepare('SELECT id, path FROM files WHERE grant_id = ?').all(grantId) as { id: number; path: string }[]
}

export function saveFileChunks(db: FileDb, grantId: string, file: { path: string; name: string; mtimeMs: number; size: number }, chunks: StoredChunk[]): void {
  const existing = fileRow(db, grantId, file.path)
  if (existing) forgetFile(db, existing.id)
  const info = db.prepare('INSERT INTO files(grant_id, path, name, mtime_ms, size) VALUES (?, ?, ?, ?, ?)').run(grantId, file.path, file.name, file.mtimeMs, file.size)
  const fileId = Number(info.lastInsertRowid)
  const insert = db.prepare('INSERT INTO chunks(file_id, grant_id, path, name, heading, locator, text) VALUES (?, ?, ?, ?, ?, ?, ?)')
  for (const chunk of chunks) {
    const saved = insert.run(fileId, grantId, file.path, file.name, chunk.heading, chunk.locator, chunk.text)
    insertVector(db, Number(saved.lastInsertRowid), chunk.vector)
  }
}

export interface StoredPiece {
  id: number
  fileId: number
  name: string
  text: string
}

export function chunksForGrant(db: FileDb, grantId: string): StoredPiece[] {
  return db.prepare('SELECT id, file_id AS fileId, name, text FROM chunks WHERE grant_id = ? ORDER BY id').all(grantId) as StoredPiece[]
}

export function clearStage(db: FileDb, grantId: string): void {
  db.prepare('DELETE FROM embed_stage WHERE grant_id = ?').run(grantId)
}

export function stageEmbedding(db: FileDb, grantId: string, chunkId: number, vector: Float32Array): void {
  const sized = vector.length === FILE_EMBED_DIM ? vector : fitDim(vector)
  db.prepare('INSERT INTO embed_stage(chunk_id, grant_id, embedding) VALUES (?, ?, ?) ON CONFLICT(chunk_id) DO UPDATE SET embedding = excluded.embedding, grant_id = excluded.grant_id').run(chunkId, grantId, vectorBytes(sized))
}

/** Replace one folder's vectors and its embedder in a single transaction. */
export function commitStagedEmbeddings(db: FileDb, grantId: string): void {
  const rows = db.prepare('SELECT chunk_id AS id, embedding FROM embed_stage WHERE grant_id = ?').all(grantId) as { id: number; embedding: Buffer }[]
  const expected = chunksForGrant(db, grantId).length
  if (rows.length !== expected) throw new Error('staged embeddings do not cover this folder')
  const tx = db.transaction(() => {
    for (const row of rows) {
      deleteVector(db, row.id)
      db.prepare(`INSERT INTO chunk_vec(chunk_id, embedding) VALUES (${sqlId(row.id)}, ?)`).run(row.embedding)
    }
    db.prepare('DELETE FROM embed_stage WHERE grant_id = ?').run(grantId)
    db.prepare(`UPDATE grants SET embedder = 'gemma', status = 'ready', error = NULL WHERE id = ?`).run(grantId)
  })
  tx()
}

export function embeddingSample(db: FileDb, grantId: string): number | null {
  const row = db.prepare('SELECT id FROM chunks WHERE grant_id = ? ORDER BY id LIMIT 1').get(grantId) as { id: number } | undefined
  if (!row) return null
  const vec = db.prepare(`SELECT embedding FROM chunk_vec WHERE chunk_id = ${sqlId(row.id)}`).get() as { embedding: Buffer } | undefined
  if (!vec?.embedding?.length) return null
  return vec.embedding.readFloatLE(0)
}

export function searchChunks(db: FileDb, query: string, qvec: Float32Array | null, grantIds: readonly string[], topN = 5): RankedChunk[] {
  if (!grantIds.length) return []
  const marks = grantIds.map(() => '?').join(', ')
  const hits = new Map<number, { bm25: number | null; vec: number | null; cosine: number }>()
  const touch = (id: number) => {
    let row = hits.get(id)
    if (!row) {
      row = { bm25: null, vec: null, cosine: 0 }
      hits.set(id, row)
    }
    return row
  }
  try {
    const fts = db.prepare(`SELECT c.id AS id FROM chunks_fts JOIN chunks c ON c.id = chunks_fts.rowid WHERE chunks_fts MATCH ? AND c.grant_id IN (${marks}) ORDER BY bm25(chunks_fts) LIMIT 30`)
      .all(ftsQuery(query), ...grantIds) as { id: number }[]
    fts.forEach((row, index) => { touch(row.id).bm25 = index })
  } catch {
    /* punctuation: vector side still runs */
  }
  const vec = qvec
    ? db.prepare(`SELECT chunk_id AS id, distance FROM chunk_vec WHERE embedding MATCH ? AND k = 40`).all(vectorBytes(qvec)) as { id: number; distance: number }[]
    : []
  const allowed = new Set(grantIds)
  let rank = 0
  const grantOf = db.prepare('SELECT grant_id AS grantId FROM chunks WHERE id = ?')
  for (const row of vec) {
    const grant = grantOf.get(row.id) as { grantId: string } | undefined
    if (!grant || !allowed.has(grant.grantId)) continue
    const hit = touch(row.id)
    hit.vec = rank++
    hit.cosine = 1 - row.distance
  }
  const meta = db.prepare('SELECT path, name, heading, locator, text FROM chunks WHERE id = ?')
  const ranked: RankedChunk[] = []
  for (const [id, hit] of hits) {
    const row = meta.get(id) as { path: string; name: string; heading: string | null; locator: string | null; text: string } | undefined
    if (!row) continue
    ranked.push({ id, ...row, cosine: hit.cosine, rrf: rrfScore([hit.bm25, hit.vec]) })
  }
  ranked.sort((a, b) => b.rrf - a.rrf || b.cosine - a.cosine)
  return ranked.slice(0, topN)
}

function sqlId(id: number): number {
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('bad row id')
  return id
}

function deleteVector(db: FileDb, id: number): void {
  db.prepare(`DELETE FROM chunk_vec WHERE chunk_id = ${sqlId(id)}`).run()
}

function insertVector(db: FileDb, id: number, vector: Float32Array): void {
  const sized = vector.length === FILE_EMBED_DIM ? vector : fitDim(vector)
  db.prepare(`INSERT INTO chunk_vec(chunk_id, embedding) VALUES (${sqlId(id)}, ?)`).run(vectorBytes(sized))
}

function fitDim(vector: Float32Array): Float32Array {
  const out = new Float32Array(FILE_EMBED_DIM)
  out.set(vector.subarray(0, FILE_EMBED_DIM))
  return out
}
