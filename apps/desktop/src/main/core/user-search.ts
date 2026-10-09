/**
 * Hybrid search over the user's documents: FTS5 + sqlite-vec, merged with RRF.
 * Scope is one chat's files, or every ready document.
 */
import type { DB } from './db.js'
import { locatorOf, type TextChunk } from './chunker.js'
import { documentGate, ftsQuery, isDevanagariQuery, rrfScore, type GateDecision, type Hit } from './retrieval.js'

export interface UserHit extends Hit {
  fileName: string
  locator: string | null
  heading: string | null
  attachmentId: string
  excerpt: string
}

const K = 30

export function searchUser(db: DB, query: string, qvec: Float32Array, conversationId: string | null, topN = 5): { top: UserHit[]; decision: GateDecision } {
  const allowed = allowSet(db, conversationId)
  if (allowed && allowed.size === 0) return { top: [], decision: 'insufficient' }
  const hits = new Map<number, UserHit>()
  const get = (id: number): UserHit => {
    let hit = hits.get(id)
    if (!hit) {
      hit = {
        pack: 'library', chunkId: id, text: '', title: '', url: '', cosine: 0, bm25Rank: null, vecRank: null, rrf: 0,
        fileName: '', locator: null, heading: null, attachmentId: '', excerpt: '',
      }
      hits.set(id, hit)
    }
    return hit
  }
  const minLen = isDevanagariQuery(query) ? 2 : 3
  try {
    const fts = db.prepare('SELECT rowid AS id FROM chunks_fts WHERE chunks_fts MATCH ? ORDER BY bm25(chunks_fts) LIMIT ?')
      .all(ftsQuery(query, minLen), K) as { id: number }[]
    let rank = 0
    for (const row of fts) {
      if (allowed && !allowed.has(row.id)) continue
      get(row.id).bm25Rank = rank++
    }
  } catch { /* odd punctuation: vector search still runs */ }
  const vec = db.prepare(`SELECT chunk_id AS id, distance FROM chunk_vectors WHERE embedding MATCH ? AND k = ${K}`)
    .all(Buffer.from(qvec.buffer, qvec.byteOffset, qvec.byteLength)) as { id: number; distance: number }[]
  let vecRank = 0
  for (const row of vec) {
    if (allowed && !allowed.has(row.id)) continue
    const hit = get(row.id)
    hit.vecRank = vecRank++
    hit.cosine = 1 - row.distance
  }
  const meta = db.prepare(
    `SELECT c.text, c.heading, c.locator_kind AS locatorKind, c.locator_label AS locatorLabel, c.page_start AS pageStart,
            a.original_name AS fileName, a.id AS attachmentId, d.title
     FROM chunks c
     JOIN documents d ON d.id = c.document_id
     JOIN attachments a ON a.id = d.attachment_id
     WHERE c.id = ? AND d.status = 'ready'`,
  )
  for (const hit of hits.values()) {
    const row = meta.get(hit.chunkId) as {
      text: string; heading: string | null; locatorKind: TextChunk['locatorKind']; locatorLabel: string | null
      pageStart: number | null; fileName: string; attachmentId: string; title: string
    } | undefined
    if (!row) {
      hits.delete(hit.chunkId)
      continue
    }
    hit.text = row.text
    hit.heading = row.heading
    hit.fileName = row.fileName
    hit.attachmentId = row.attachmentId
    hit.locator = locatorOf({ locatorKind: row.locatorKind, locatorLabel: row.locatorLabel, pageStart: row.pageStart })
    hit.title = hit.locator ? `${row.fileName} · ${hit.locator}` : row.fileName
    hit.excerpt = row.text.slice(0, 280)
    hit.url = ''
    hit.rrf = rrfScore([hit.bm25Rank, hit.vecRank])
  }
  const top = [...hits.values()].sort((a, b) => b.rrf - a.rrf).slice(0, topN)
  return { top, decision: documentGate(query, top) }
}

function allowSet(db: DB, conversationId: string | null): Set<number> | null {
  if (!conversationId) return null
  const rows = db.prepare(
    `SELECT c.id FROM chunks c
     JOIN documents d ON d.id = c.document_id
     JOIN conversation_files f ON f.attachment_id = d.attachment_id
     WHERE f.conversation_id = ? AND d.status = 'ready'`,
  ).all(conversationId) as { id: number }[]
  return new Set(rows.map((row) => row.id))
}
