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

export interface BoostContext {
  /** File the chunk lives in, so a task that names the file ranks that file's chunks first. */
  path?: string
  /** An exported symbol is the one a caller can import, so it beats a private helper. */
  exported?: boolean
  /** True when the file imports (or is imported by) the best hit: the signature is often next door. */
  neighbour?: boolean
}

/** RRF stays the base score; these terms only reorder close neighbours. */
export function nameBoost(name: string, kind: string, query: string, ctx: BoostContext = {}): number {
  const idents: string[] = query.toLowerCase().match(/[a-z_][a-z0-9_]*/g) ?? []
  const parts = name.toLowerCase().split(/[.\s]+/).filter((part) => part.length > 1)
  let boost = 0
  if (parts.some((part) => idents.includes(part))) boost += 0.45
  const fileParts = (ctx.path ?? '').toLowerCase().split(/[./]+/).filter((part) => part.length > 1)
  if (fileParts.some((part) => idents.includes(part))) boost += 0.3
  if (ctx.neighbour) boost += 0.15
  if (ctx.exported) boost += 0.05
  if (kind === 'function' || kind === 'method' || kind === 'class' || kind === 'type') boost += 0.02
  return boost
}

const EXPORTED = /(^|\n)\s*export\b/

/**
 * Zero-memory reranker: RRF plus symbol, filename/path, export and import-neighbour boosts.
 * `neighbours` holds the paths related to the best hit (see relatedFiles).
 */
export function rerankHits(hits: CodeHit[], query: string, neighbours: ReadonlySet<string> = new Set()): CodeHit[] {
  return hits
    .map((hit) => ({
      ...hit,
      score: hit.rrf + nameBoost(hit.name, hit.kind, query, {
        path: hit.path,
        exported: EXPORTED.test(hit.text),
        neighbour: neighbours.has(hit.path),
      }),
    }))
    .sort((a, b) => b.score - a.score || (a.bm25Rank ?? 99) - (b.bm25Rank ?? 99) || b.cosine - a.cosine || a.path.localeCompare(b.path))
}

/** The `--reranking` sidecar, or anything else that scores a query against documents. */
export interface Reranker {
  rerank(query: string, documents: string[]): Promise<number[]>
}

function document(hit: CodeHit): string {
  return `${hit.path}\n${hit.name}\n${hit.text}`.slice(0, 1200)
}

/**
 * Neural rerank on top of the boost order when the cross-encoder answers.
 * A missing sidecar, an HTTP error or a short score list keeps the RRF + boost order:
 * search must never fail because the reranker did.
 */
export async function rerankWithModel(
  hits: CodeHit[],
  query: string,
  ranker?: Reranker | null,
): Promise<{ hits: CodeHit[]; neural: boolean }> {
  if (!ranker || !hits.length) return { hits, neural: false }
  try {
    const scores = await ranker.rerank(query, hits.map(document))
    if (scores.length !== hits.length) return { hits, neural: false }
    const ranked = hits.map((hit, index) => ({ ...hit, score: hit.score + (scores[index] ?? 0) }))
    ranked.sort((a, b) => b.score - a.score || a.chunkId - b.chunkId)
    return { hits: ranked, neural: true }
  } catch {
    return { hits, neural: false }
  }
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
