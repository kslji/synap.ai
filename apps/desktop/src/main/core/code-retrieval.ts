/**
 * Code retrieval bake-off fixture. BM25 is the symbol index. Neural scores
 * are cosine over real embeddings. Hybrid is reciprocal rank fusion.
 * CodeRankEmbed has no official GGUF, so it is not a candidate.
 */
import { searchSymbols, type SymbolChunk } from './code-tools.js'

export interface RetrievalQuery {
  text: string
  expect: string
}

export const CODE_FIXTURE: SymbolChunk[] = [
  { path: 'src/harbor.ts', name: 'ferryLeave', kind: 'function', text: 'export function ferryLeave() {\n  // early boat, pier 4\n  return "06:40"\n}' },
  { path: 'src/billing.ts', name: 'invoiceTotal', kind: 'function', text: 'export function invoiceTotal(lines) {\n  return lines.reduce((sum, line) => sum + line.cents, 0)\n}' },
  { path: 'src/dock.ts', name: 'berthAssign', kind: 'function', text: 'export function berthAssign(boat) {\n  return boat.length > 10 ? "slip-b" : "slip-a"\n}' },
  { path: 'src/auth.ts', name: 'hashPassword', kind: 'function', text: 'export function hashPassword(secret) {\n  return slowHash(secret)\n}' },
  { path: 'src/dates.ts', name: 'parseIsoDate', kind: 'function', text: 'export function parseIsoDate(value) {\n  return new Date(value)\n}' },
  { path: 'src/ui.tsx', name: 'renderButton', kind: 'function', text: 'export function renderButton() {\n  return <button className="accent">Reserve</button>\n}' },
  { path: 'src/sql.ts', name: 'openInvoices', kind: 'function', text: 'export function openInvoices() {\n  return "select * from invoices where paid = 0"\n}' },
  { path: 'src/outbox.ts', name: 'retryOutbox', kind: 'function', text: 'export function retryOutbox(item) {\n  if (item.attempts < 5) send(item)\n}' },
]

export const CODE_QUERIES: RetrievalQuery[] = [
  { text: 'when is the first sailing of the day', expect: 'ferryLeave' },
  { text: 'what do we charge the customer', expect: 'invoiceTotal' },
  { text: 'where should the vessel be tied', expect: 'berthAssign' },
  { text: 'how do we protect a passphrase', expect: 'hashPassword' },
  { text: 'interpret a day stamp', expect: 'parseIsoDate' },
  { text: 'the orange control that books a seat', expect: 'renderButton' },
  { text: 'which bills are still outstanding', expect: 'openInvoices' },
  { text: 'deliver the queued note once the link is back', expect: 'retryOutbox' },
]

export function recallAt1(queries: RetrievalQuery[], rank: (query: string) => SymbolChunk[]): number {
  let hit = 0
  for (const query of queries) {
    const top = rank(query.text)[0]
    if (top?.name === query.expect) hit += 1
  }
  return queries.length ? hit / queries.length : 0
}

export function bm25Recall(chunks = CODE_FIXTURE, queries = CODE_QUERIES): number {
  return recallAt1(queries, (query) => searchSymbols(chunks, query))
}

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length)
  let dot = 0
  for (let i = 0; i < n; i++) dot += a[i] * b[i]
  return dot
}

export function vectorRecall(docVectors: ArrayLike<number>[], queryVectors: ArrayLike<number>[], queries = CODE_QUERIES, chunks = CODE_FIXTURE): number {
  return recallAt1(queries, (query) => {
    const index = queries.findIndex((item) => item.text === query)
    const queryVector = queryVectors[index]
    return chunks
      .map((chunk, chunkIndex) => ({ chunk, score: cosine(queryVector, docVectors[chunkIndex]) }))
      .sort((a, b) => b.score - a.score)
      .map((row) => row.chunk)
  })
}

export function hybridRecall(docVectors: ArrayLike<number>[], queryVectors: ArrayLike<number>[], queries = CODE_QUERIES, chunks = CODE_FIXTURE): number {
  return recallAt1(queries, (query) => fuse(chunks, query, docVectors, queryVectors, queries))
}

function fuse(chunks: SymbolChunk[], query: string, docVectors: ArrayLike<number>[], queryVectors: ArrayLike<number>[], queries: RetrievalQuery[]): SymbolChunk[] {
  const bm25 = searchSymbols(chunks, query)
  const index = queries.findIndex((item) => item.text === query)
  const neural = chunks
    .map((chunk, chunkIndex) => ({ chunk, score: cosine(queryVectors[index], docVectors[chunkIndex]) }))
    .sort((a, b) => b.score - a.score)
    .map((row) => row.chunk)
  const score = new Map<string, number>()
  const add = (ranked: SymbolChunk[]) => {
    ranked.forEach((chunk, rank) => {
      score.set(chunk.name, (score.get(chunk.name) ?? 0) + 1 / (60 + rank + 1))
    })
  }
  add(bm25)
  add(neural)
  return [...chunks].sort((a, b) => (score.get(b.name) ?? 0) - (score.get(a.name) ?? 0))
}

export function pickWinner(scores: { bm25: number; gemma: number; qwen: number; hybrid: number }): 'bm25-symbols' | 'embeddinggemma' | 'qwen3-embedding' | 'hybrid' {
  if (scores.hybrid > scores.bm25 && scores.hybrid > scores.gemma && scores.hybrid > scores.qwen) return 'hybrid'
  const singles: ['bm25-symbols' | 'embeddinggemma' | 'qwen3-embedding', number][] = [
    ['bm25-symbols', scores.bm25],
    ['embeddinggemma', scores.gemma],
    ['qwen3-embedding', scores.qwen],
  ]
  singles.sort((a, b) => b[1] - a[1])
  return singles[0][0]
}

export const QWEN_QUERY_TASK = 'Given a code search query, retrieve the function that implements it'

export function qwenQuery(text: string): string {
  return `Instruct: ${QWEN_QUERY_TASK}\nQuery:${text}`
}
