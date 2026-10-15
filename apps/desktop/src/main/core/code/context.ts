/**
 * Token-budgeted context for the Code agent loop (step 3).
 * Given a task, return a few symbol snippets and the file paths they came from.
 */
import { heuristicCounter, truncateToTokens, type TokenCounter } from '../token-budget.js'
import type { CodeEmbedder } from './embed.js'
import { searchCode, type CodeHit } from './search.js'
import { definitions, relatedFiles, type CodeDb, type SymbolHit } from './store.js'

export interface ContextSnippet {
  path: string
  startLine: number
  endLine: number
  symbol: string | null
  kind: string
  text: string
  reason: 'search' | 'definition' | 'related'
  score: number
}

export interface ContextPack {
  snippets: ContextSnippet[]
  files: string[]
  tokens: number
  dropped: number
}

export interface ContextOptions {
  tokenBudget: number
  embedder?: CodeEmbedder | null
  counter?: TokenCounter
  maxSnippets?: number
}

function fromHit(hit: CodeHit, reason: ContextSnippet['reason']): ContextSnippet {
  return {
    path: hit.path,
    startLine: hit.startLine,
    endLine: hit.endLine,
    symbol: hit.name,
    kind: hit.kind,
    text: hit.text,
    reason,
    score: hit.score,
  }
}

function fromSymbol(symbol: SymbolHit, reason: ContextSnippet['reason'], score: number): ContextSnippet {
  return {
    path: symbol.path,
    startLine: symbol.startLine,
    endLine: symbol.endLine,
    symbol: symbol.qualified,
    kind: symbol.kind,
    text: symbol.text,
    reason,
    score,
  }
}

function keyOf(snippet: ContextSnippet): string {
  return `${snippet.path}:${snippet.startLine}:${snippet.endLine}:${snippet.symbol ?? ''}`
}

export async function buildContext(db: CodeDb, task: string, options: ContextOptions): Promise<ContextPack> {
  const counter = options.counter ?? heuristicCounter
  const budget = Math.max(0, options.tokenBudget)
  const maxSnippets = options.maxSnippets ?? 8
  const qvec = options.embedder ? (await options.embedder.embedQueries([task]))[0] ?? null : null
  const hits = searchCode(db, task, qvec, 16)
  const ordered: ContextSnippet[] = []
  const seen = new Set<string>()
  const push = (snippet: ContextSnippet) => {
    const key = keyOf(snippet)
    if (seen.has(key)) return
    seen.add(key)
    ordered.push(snippet)
  }

  const idents = task.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []
  for (const ident of idents) {
    if (ident.length < 3) continue
    for (const symbol of definitions(db, ident).slice(0, 2)) push(fromSymbol(symbol, 'definition', 1))
  }
  for (const hit of hits) push(fromHit(hit, 'search'))
  const top = ordered[0]
  if (top) {
    for (const related of relatedFiles(db, top.path).slice(0, 3)) {
      const defs = definitions(db, related.path.split('/').pop()?.replace(/\.[^.]+$/, '') ?? '')
      const symbol = defs[0]
      if (symbol) push(fromSymbol(symbol, 'related', 0.1))
      else push({ path: related.path, startLine: 1, endLine: 1, symbol: null, kind: 'file', text: related.path, reason: 'related', score: 0.05 })
    }
  }

  const snippets: ContextSnippet[] = []
  let tokens = 0
  let dropped = 0
  for (const snippet of ordered) {
    if (snippets.length >= maxSnippets) { dropped++; continue }
    const cost = await counter.count(snippet.text)
    if (tokens + cost <= budget) {
      snippets.push(snippet)
      tokens += cost
      continue
    }
    if (!snippets.length && budget > 16) {
      const text = await truncateToTokens(counter, snippet.text, budget)
      const trimmed = await counter.count(text)
      snippets.push({ ...snippet, text })
      tokens += trimmed
      dropped += ordered.length - 1
      break
    }
    dropped++
  }
  const files = [...new Set(snippets.map((snippet) => snippet.path))]
  return { snippets, files, tokens, dropped }
}
