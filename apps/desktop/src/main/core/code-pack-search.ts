/**
 * Hybrid search over the Code pack.
 * Keyword: FTS5. Vector: the on-device Jina code embeddings cache, when it exists.
 * Ranks are fused with the same reciprocal-rank function as other packs, then
 * the heading boost from the project index (there is no cross-encoder reranker
 * in this build).
 */
import { nameBoost } from './code/search.js'
import { vectorBytes } from './code/embed.js'
import type { DB } from './db.js'
import { ftsQuery, rrfScore } from './retrieval.js'

export interface PackChunk {
  id: number
  language: string
  library: string
  version: string
  sourceUrl: string
  licence: string
  title: string
  heading: string
  citation: string
  text: string
}

export interface PackHit extends PackChunk {
  bm25Rank: number | null
  vecRank: number | null
  cosine: number
  rrf: number
  score: number
}

export interface PackSearchFilter {
  languages?: readonly string[]
  libraries?: readonly string[]
}

const ALWAYS = ['git', 'bash']

export function searchLanguages(filter: PackSearchFilter | undefined, query: string): PackSearchFilter | undefined {
  const languages = new Set((filter?.languages ?? []).map((item) => item.toLowerCase()))
  const libraries = new Set((filter?.libraries ?? []).map((item) => item.toLowerCase()))
  for (const hint of queryLanguages(query)) languages.add(hint)
  if (!languages.size && !libraries.size) return undefined
  for (const extra of ALWAYS) languages.add(extra)
  return { languages: [...languages], libraries: [...libraries] }
}

const QUERY_LANG: Array<[RegExp, string]> = [
  [/\bpython\b|\bpytest\b|\basyncio\b|\bpip\b|\bdjango\b|\bflask\b|\bfastapi\b/i, 'python'],
  [/\btypescript\b|\bts\d{3,4}\b/i, 'typescript'],
  [/\bjavascript\b|\bnode\.?js\b|\bnpm\b|\breact\b|\bexpress\b/i, 'javascript'],
  [/\brust\b|\bcargo\b/i, 'rust'],
  [/\bgolang\b|\bgo\.mod\b|\bgo\s+test\b/i, 'go'],
  [/\bjava\b|\bjdk\b/i, 'java'],
  [/\bc\+\+|cpp\b|\bstd::/i, 'cpp'],
  [/\bc#\b|\bcsharp\b|\bdotnet\b/i, 'csharp'],
  [/\bbash\b|\bshell\b/i, 'bash'],
  [/\bgit\b/i, 'git'],
  [/\bsqlite\b|\bpostgres\b|\bsql\b/i, 'sql'],
  [/\bhtml\b|\bcss\b/i, 'html'],
  [/\bdocker\b|\bdockerfile\b/i, 'docker'],
]

export function queryLanguages(query: string): string[] {
  const found: string[] = []
  for (const [pattern, language] of QUERY_LANG) {
    if (pattern.test(query)) found.push(language)
  }
  return found
}

export function searchCodePack(
  db: DB,
  query: string,
  opts: { filter?: PackSearchFilter; qvec?: Float32Array | null; vectorDb?: DB | null; k?: number } = {},
): PackHit[] {
  const k = opts.k ?? 20
  const filter = searchLanguages(opts.filter, query)
  const allowed = filter ? allowedIds(db, filter) : null
  if (allowed && allowed.size === 0) return []
  // Rank inside the language filter, then let the heading boost reorder a small pool.
  const pool = Math.max(k * 5, 24)
  const keyword = keywordIds(db, query, pool, filter)
  const vector = opts.qvec && opts.vectorDb
    ? vectorHits(opts.vectorDb, opts.qvec, k * 2).filter((hit) => !allowed || allowed.has(hit.id)).slice(0, k)
    : []
  const ranks = new Map<number, { bm25Rank: number | null; vecRank: number | null; cosine: number; rrf: number }>()
  const slot = (id: number) => {
    let row = ranks.get(id)
    if (!row) {
      row = { bm25Rank: null, vecRank: null, cosine: 0, rrf: 0 }
      ranks.set(id, row)
    }
    return row
  }
  keyword.forEach((id, index) => { slot(id).bm25Rank = index })
  for (const id of headingMatchIds(db, query, filter, 12)) slot(id)
  vector.forEach((hit, index) => {
    const row = slot(hit.id)
    row.vecRank = index
    row.cosine = hit.cosine
  })
  for (const row of ranks.values()) row.rrf = rrfScore([row.bm25Rank, row.vecRank])
  const ids = [...ranks.keys()]
  if (!ids.length) return []
  const rows = db.prepare(
    `SELECT id, language, library, version, source_url AS sourceUrl, licence, title, heading, citation, text
     FROM chunks WHERE id IN (${ids.map(() => '?').join(',')})`,
  ).all(...ids) as PackChunk[]
  const hits: PackHit[] = []
  for (const row of rows) {
    const rank = ranks.get(row.id)
    if (!rank) continue
    hits.push({ ...row, ...rank, score: rank.rrf })
  }
  return rerankPackHits(hits, query).slice(0, k)
}

export function rerankPackHits(hits: PackHit[], query: string): PackHit[] {
  return hits
    .map((hit) => {
      const heading = nameBoost(hit.heading, 'function', query)
      const card = hit.licence === 'CC0-1.0' && heading >= 0.45 ? 0.25 : 0
      return {
        ...hit,
        score: hit.rrf + heading + nameBoost(hit.library, 'class', query) + card,
      }
    })
    .sort((a, b) => b.score - a.score || (a.bm25Rank ?? 99) - (b.bm25Rank ?? 99) || b.cosine - a.cosine || a.id - b.id)
}

function headingMatchIds(db: DB, query: string, filter: PackSearchFilter | undefined, limit: number): number[] {
  const words = [...new Set((query.toLowerCase().match(/[a-z][a-z0-9]*/g) ?? []).filter((word) => word.length >= 4))].slice(0, 6)
  if (!words.length) return []
  const languages = filter?.languages ?? []
  const libraries = filter?.libraries ?? []
  const scope: string[] = []
  const args: string[] = words.map((word) => `%${word}%`)
  if (languages.length) {
    scope.push(`language IN (${languages.map(() => '?').join(',')})`)
    args.push(...languages)
  }
  if (libraries.length) {
    scope.push(`library IN (${libraries.map(() => '?').join(',')})`)
    args.push(...libraries)
  }
  const where = scope.length ? ` AND (${scope.join(' OR ')})` : ''
  try {
    const ids: number[] = []
    const seen = new Set<number>()
    const perWord = Math.max(2, Math.ceil(limit / words.length))
    for (const word of words) {
      const rows = db.prepare(
        `SELECT id FROM chunks WHERE lower(heading) LIKE ?${where} ORDER BY length(heading) LIMIT ?`,
      ).all(`%${word}%`, ...args.slice(words.length), perWord) as { id: number }[]
      for (const row of rows) {
        if (seen.has(row.id)) continue
        seen.add(row.id)
        ids.push(row.id)
      }
    }
    return ids.slice(0, limit)
  } catch {
    return []
  }
}

function keywordIds(db: DB, query: string, limit: number, filter: PackSearchFilter | undefined): number[] {
  const match = ftsQuery(query, 2)
  if (match === '""') return []
  const languages = filter?.languages ?? []
  const libraries = filter?.libraries ?? []
  try {
    if (!languages.length && !libraries.length) {
      const rows = db.prepare(
        'SELECT rowid AS id FROM chunks_fts WHERE chunks_fts MATCH ? ORDER BY bm25(chunks_fts) LIMIT ?',
      ).all(match, limit) as { id: number }[]
      return rows.map((row) => row.id)
    }
    const clauses: string[] = []
    const args: Array<string | number> = [match]
    if (languages.length) {
      clauses.push(`c.language IN (${languages.map(() => '?').join(',')})`)
      args.push(...languages)
    }
    if (libraries.length) {
      clauses.push(`c.library IN (${libraries.map(() => '?').join(',')})`)
      args.push(...libraries)
    }
    args.push(limit)
    const rows = db.prepare(
      `SELECT chunks_fts.rowid AS id FROM chunks_fts JOIN chunks c ON c.id = chunks_fts.rowid
       WHERE chunks_fts MATCH ? AND (${clauses.join(' OR ')})
       ORDER BY bm25(chunks_fts) LIMIT ?`,
    ).all(...args) as { id: number }[]
    return rows.map((row) => row.id)
  } catch {
    return []
  }
}

function vectorHits(db: DB, qvec: Float32Array, limit: number): { id: number; cosine: number }[] {
  try {
    const rows = db.prepare(
      'SELECT chunk_id AS id, distance FROM chunk_vec WHERE embedding MATCH ? AND k = ?',
    ).all(vectorBytes(qvec), limit) as { id: number; distance: number }[]
    return rows.map((row) => ({ id: row.id, cosine: 1 - row.distance }))
  } catch {
    return []
  }
}

function allowedIds(db: DB, filter: PackSearchFilter): Set<number> {
  const languages = filter.languages ?? []
  const libraries = filter.libraries ?? []
  const clauses: string[] = []
  const args: string[] = []
  if (languages.length) {
    clauses.push(`language IN (${languages.map(() => '?').join(',')})`)
    args.push(...languages)
  }
  if (libraries.length) {
    clauses.push(`library IN (${libraries.map(() => '?').join(',')})`)
    args.push(...libraries)
  }
  if (!clauses.length) return new Set()
  const rows = db.prepare(`SELECT id FROM chunks WHERE ${clauses.join(' OR ')}`).all(...args) as { id: number }[]
  return new Set(rows.map((row) => row.id))
}
