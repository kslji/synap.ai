import { ftsQuery, rrfScore } from '../retrieval.js'
import type { CodeDb } from './store.js'
import { vectorBytes } from './embed.js'

export interface CodeHit {
  chunkId: number
  path: string
  name: string
  kind: string
  startLine: number
  endLine: number
  text: string
  bm25Rank: number | null
  vecRank: number | null
  cosine: number
  rrf: number
  score: number
}

interface Ranked {
  bm25Rank: number | null
  vecRank: number | null
  cosine: number
  rrf: number
}

/** Merge keyword and vector ranks. A missing list contributes nothing. */
export function fuseRanks(keywordIds: number[], vectorHits: { id: number; cosine: number }[], k = 60): Map<number, Ranked> {
  const ranks = new Map<number, Ranked>()
  const get = (id: number): Ranked => {
    let row = ranks.get(id)
    if (!row) {
      row = { bm25Rank: null, vecRank: null, cosine: 0, rrf: 0 }
      ranks.set(id, row)
    }
    return row
  }
  keywordIds.forEach((id, index) => { get(id).bm25Rank = index })
  vectorHits.forEach((hit, index) => {
    const row = get(hit.id)
    row.vecRank = index
    row.cosine = hit.cosine
  })
  for (const row of ranks.values()) row.rrf = rrfScore([row.bm25Rank, row.vecRank], k)
  return ranks
}

export function nameBoost(name: string, kind: string, query: string): number {
  const parts = name.toLowerCase().split(/[.\s]+/).filter((part) => part.length > 1)
  const idents: string[] = query.toLowerCase().match(/[a-z_][a-z0-9_]*/g) ?? []
  let boost = 0
  if (parts.some((part) => idents.includes(part))) boost += 0.45
  if (kind === 'function' || kind === 'method' || kind === 'class' || kind === 'type') boost += 0.02
  return boost
}

export function rerankHits(hits: CodeHit[], query: string): CodeHit[] {
  return hits
    .map((hit) => ({ ...hit, score: hit.rrf + nameBoost(hit.name, hit.kind, query) }))
    .sort((a, b) => b.score - a.score || (a.bm25Rank ?? 99) - (b.bm25Rank ?? 99) || b.cosine - a.cosine || a.path.localeCompare(b.path))
}

export function searchCode(db: CodeDb, query: string, qvec: Float32Array | null, k = 20): CodeHit[] {
  const keyword = db.prepare(
    'SELECT rowid AS id FROM chunks_fts WHERE chunks_fts MATCH ? ORDER BY bm25(chunks_fts) LIMIT ?',
  ).all(ftsQuery(query, 2), k) as { id: number }[]
  const vector = qvec
    ? db.prepare('SELECT chunk_id AS id, distance FROM chunk_vec WHERE embedding MATCH ? AND k = ?').all(vectorBytes(qvec), k) as { id: number; distance: number }[]
    : []
  const fused = fuseRanks(keyword.map((row) => row.id), vector.map((row) => ({ id: row.id, cosine: 1 - row.distance })))
  const ids = [...fused.keys()]
  if (!ids.length) return []
  const rows = db.prepare(
    `SELECT id AS chunkId, path, name, kind, start_line AS startLine, end_line AS endLine, text FROM chunks WHERE id IN (${ids.map(() => '?').join(',')})`,
  ).all(...ids) as Omit<CodeHit, 'bm25Rank' | 'vecRank' | 'cosine' | 'rrf' | 'score'>[]
  const hits: CodeHit[] = []
  for (const row of rows) {
    const rank = fused.get(row.chunkId)
    if (!rank) continue
    hits.push({ ...row, ...rank, score: rank.rrf })
  }
  hits.sort((a, b) => b.rrf - a.rrf)
  return rerankHits(hits, query).slice(0, k)
}
