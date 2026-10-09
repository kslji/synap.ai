/**
 * Cited web passages kept in the encrypted user database.
 * Only the passages that were actually cited are stored, with their EmbeddingGemma 2
 * vectors. Nothing here is uploaded. Search requests stay { query, k }.
 */
import { createHash } from 'node:crypto'
import type { DB } from './db.js'
import type { Citation } from './ipc-contract.js'
import { documentGate, ftsQuery, isDevanagariQuery, rrfScore, type GateDecision, type Hit } from './retrieval.js'
import { domainOf, prettyDate, wantsFresh } from './web-decision.js'

export const WEB_CACHE_MAX_BYTES = 8 * 1024 * 1024
export const WEB_STALE_MS = 24 * 60 * 60 * 1000
export const STALE_NOTE = 'Saved more than 24 hours ago. Prices and news may have changed.'

export const WEB_CACHE_MIGRATION = `
CREATE TABLE web_passages (
  id            INTEGER PRIMARY KEY,
  url           TEXT NOT NULL,
  content_hash  TEXT NOT NULL,
  title         TEXT NOT NULL,
  domain        TEXT NOT NULL,
  text          TEXT NOT NULL,
  byte_size     INTEGER NOT NULL,
  fetched_at    INTEGER NOT NULL,
  published     TEXT,
  last_used_at  INTEGER NOT NULL,
  UNIQUE (url, content_hash)
);

CREATE TABLE web_passage_links (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  passage_id      INTEGER NOT NULL REFERENCES web_passages(id) ON DELETE CASCADE,
  message_id      TEXT NOT NULL,
  saved_at        INTEGER NOT NULL,
  PRIMARY KEY (conversation_id, passage_id)
);

CREATE VIRTUAL TABLE web_fts USING fts5(
  title, text,
  content = 'web_passages', content_rowid = 'id',
  tokenize = 'porter unicode61 remove_diacritics 2'
);
CREATE TRIGGER web_passages_ai AFTER INSERT ON web_passages BEGIN
  INSERT INTO web_fts(rowid, title, text) VALUES (new.id, new.title, new.text);
END;
CREATE TRIGGER web_passages_ad AFTER DELETE ON web_passages BEGIN
  INSERT INTO web_fts(web_fts, rowid, title, text) VALUES ('delete', old.id, old.title, old.text);
END;
CREATE TRIGGER web_passages_au AFTER UPDATE ON web_passages BEGIN
  INSERT INTO web_fts(web_fts, rowid, title, text) VALUES ('delete', old.id, old.title, old.text);
  INSERT INTO web_fts(rowid, title, text) VALUES (new.id, new.title, new.text);
END;

CREATE VIRTUAL TABLE web_vec USING vec0(
  passage_id INTEGER PRIMARY KEY,
  embedding float[256] distance_metric=cosine
);
`

export interface CitedPassage {
  url: string
  title: string
  domain?: string
  text: string
  published?: string | null
  fetchedAt?: number
  vec: ArrayLike<number>
}

export interface SavedWebHit extends Hit {
  saved: true
  domain: string
  fetchedAt: number
  published: string | null
}

export function isSavedWebHit(hit: Hit): hit is SavedWebHit {
  return (hit as SavedWebHit).saved === true
}

export function contentHash(url: string, text: string): string {
  return createHash('sha256').update(url).update('\n').update(text).digest('hex')
}

export function savedWebPack(fetchedAt: number): string {
  return `Web, saved ${prettyDate(new Date(fetchedAt).toISOString())}`
}

export function staleNote(fetchedAt: number, now: number, fresh: boolean): string | null {
  if (!fresh || now - fetchedAt <= WEB_STALE_MS) return null
  return STALE_NOTE
}

export function savedWebCitation(hit: SavedWebHit, question: string, now = Date.now()): Citation {
  const note = staleNote(hit.fetchedAt, now, wantsFresh(question))
  return {
    kind: 'web',
    title: hit.title || hit.domain || hit.url,
    url: hit.url,
    domain: hit.domain,
    published: hit.published,
    pack: savedWebPack(hit.fetchedAt),
    savedAt: hit.fetchedAt,
    staleNote: note ?? undefined,
    excerpt: hit.text.slice(0, 280),
  }
}

export function savedWebStats(db: DB): { bytes: number; count: number; capBytes: number } {
  const row = db.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(byte_size), 0) AS bytes FROM web_passages').get() as { count: number; bytes: number }
  return { bytes: row.bytes, count: row.count, capBytes: WEB_CACHE_MAX_BYTES }
}

export function clearSavedWeb(db: DB): void {
  db.exec('DELETE FROM web_vec; DELETE FROM web_passages;')
}

/** Drop the chat and any saved passages that no other chat still cites. */
export function forgetConversation(db: DB, conversationId: string): void {
  const ids = db.prepare('SELECT passage_id AS id FROM web_passage_links WHERE conversation_id = ?').all(conversationId) as { id: number }[]
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(conversationId)
    db.prepare('DELETE FROM conversations WHERE id = ?').run(conversationId)
    for (const row of ids) {
      const left = db.prepare('SELECT 1 AS ok FROM web_passage_links WHERE passage_id = ?').get(row.id)
      if (!left) deletePassage(db, row.id)
    }
  })
  tx()
}

export function saveCitedPassages(
  db: DB,
  conversationId: string,
  messageId: string,
  passages: CitedPassage[],
  opts: { now?: number; maxBytes?: number } = {},
): number {
  const now = opts.now ?? Date.now()
  const maxBytes = opts.maxBytes ?? WEB_CACHE_MAX_BYTES
  const touched: number[] = []
  const tx = db.transaction(() => {
    for (const passage of passages) {
      const text = passage.text.trim()
      const url = passage.url.trim()
      if (!text || !url.startsWith('http') || passage.vec.length < 256) continue
      const hash = contentHash(url, text)
      const existing = db.prepare('SELECT id FROM web_passages WHERE url = ? AND content_hash = ?').get(url, hash) as { id: number } | undefined
      let id = existing?.id
      if (!id) {
        const domain = passage.domain || domainOf(url)
        const title = passage.title.trim() || domain || url
        const size = Buffer.byteLength(text, 'utf8')
        const inserted = db.prepare(
          `INSERT INTO web_passages (url, content_hash, title, domain, text, byte_size, fetched_at, published, last_used_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(url, hash, title, domain, text, size, passage.fetchedAt ?? now, passage.published ?? null, now)
        id = Number(inserted.lastInsertRowid)
        const vec = Float32Array.from(passage.vec).subarray(0, 256)
        // sqlite-vec rejects bound parameters for integer primary keys.
        db.prepare(`INSERT INTO web_vec (passage_id, embedding) VALUES (${Number(id)}, ?)`).run(Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength))
      } else {
        db.prepare('UPDATE web_passages SET last_used_at = ?, fetched_at = ? WHERE id = ?').run(now, passage.fetchedAt ?? now, id)
      }
      db.prepare(
        `INSERT INTO web_passage_links (conversation_id, passage_id, message_id, saved_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (conversation_id, passage_id) DO UPDATE SET message_id = excluded.message_id, saved_at = excluded.saved_at`,
      ).run(conversationId, id, messageId, now)
      touched.push(id)
    }
    evict(db, maxBytes, touched)
  })
  tx()
  return touched.length
}

const SEARCH_K = 30

export function searchSavedWeb(db: DB, query: string, qvec: Float32Array, conversationId: string | null, topN = 5): { top: SavedWebHit[]; decision: GateDecision } {
  const allowed = allowSet(db, conversationId)
  if (allowed && allowed.size === 0) return { top: [], decision: 'insufficient' }
  const hits = new Map<number, SavedWebHit>()
  const get = (id: number): SavedWebHit => {
    let hit = hits.get(id)
    if (!hit) {
      hit = {
        saved: true, pack: 'web-saved', chunkId: id, text: '', title: '', url: '', cosine: 0, bm25Rank: null, vecRank: null, rrf: 0,
        domain: '', fetchedAt: 0, published: null,
      }
      hits.set(id, hit)
    }
    return hit
  }
  const minLen = isDevanagariQuery(query) ? 2 : 3
  try {
    const fts = db.prepare('SELECT rowid AS id FROM web_fts WHERE web_fts MATCH ? ORDER BY bm25(web_fts) LIMIT ?')
      .all(ftsQuery(query, minLen), SEARCH_K) as { id: number }[]
    let rank = 0
    for (const row of fts) {
      if (allowed && !allowed.has(row.id)) continue
      get(row.id).bm25Rank = rank++
    }
  } catch { /* vector search still runs */ }
  const vec = db.prepare(`SELECT passage_id AS id, distance FROM web_vec WHERE embedding MATCH ? AND k = ${SEARCH_K}`)
    .all(Buffer.from(qvec.buffer, qvec.byteOffset, qvec.byteLength)) as { id: number; distance: number }[]
  let vecRank = 0
  for (const row of vec) {
    if (allowed && !allowed.has(row.id)) continue
    const hit = get(row.id)
    hit.vecRank = vecRank++
    hit.cosine = 1 - row.distance
  }
  const meta = db.prepare('SELECT title, domain, text, url, fetched_at AS fetchedAt, published FROM web_passages WHERE id = ?')
  for (const hit of hits.values()) {
    const row = meta.get(hit.chunkId) as { title: string; domain: string; text: string; url: string; fetchedAt: number; published: string | null } | undefined
    if (!row) {
      hits.delete(hit.chunkId)
      continue
    }
    hit.title = row.title
    hit.domain = row.domain
    hit.text = row.text
    hit.url = row.url
    hit.fetchedAt = row.fetchedAt
    hit.published = row.published
    hit.rrf = rrfScore([hit.bm25Rank, hit.vecRank])
  }
  const top = [...hits.values()].sort((a, b) => b.rrf - a.rrf).slice(0, topN)
  if (top.length) {
    const mark = db.prepare('UPDATE web_passages SET last_used_at = ? WHERE id = ?')
    const now = Date.now()
    for (const hit of top) mark.run(now, hit.chunkId)
  }
  return { top, decision: documentGate(query, top) }
}

function allowSet(db: DB, conversationId: string | null): Set<number> | null {
  if (!conversationId) return null
  const rows = db.prepare('SELECT passage_id AS id FROM web_passage_links WHERE conversation_id = ?').all(conversationId) as { id: number }[]
  return new Set(rows.map((row) => row.id))
}

function evict(db: DB, maxBytes: number, protect: number[]): void {
  const keep = new Set(protect)
  let total = (db.prepare('SELECT COALESCE(SUM(byte_size), 0) AS n FROM web_passages').get() as { n: number }).n
  if (total <= maxBytes) return
  const rows = db.prepare('SELECT id, byte_size AS size FROM web_passages ORDER BY last_used_at ASC, id ASC').all() as { id: number; size: number }[]
  for (const row of rows) {
    if (total <= maxBytes) break
    if (keep.has(row.id)) continue
    deletePassage(db, row.id)
    total -= row.size
  }
}

function deletePassage(db: DB, id: number): void {
  db.prepare(`DELETE FROM web_vec WHERE passage_id = ${Number(id)}`).run()
  db.prepare('DELETE FROM web_passages WHERE id = ?').run(id)
}
