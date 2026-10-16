/** A small token budget of imported symbols and definitions above the cursor. */

export interface IndexedSnippet {
  path: string
  symbol: string
  text: string
  reason: 'import' | 'nearby'
}

export const SNIPPET_TOKEN_BUDGET = 256
const MAX_SNIPPETS = 4
const MAX_SNIPPET_CHARS = 800

export async function selectSnippets(
  imported: readonly IndexedSnippet[],
  nearby: readonly IndexedSnippet[],
  budget: number,
  count: (text: string) => Promise<number>,
): Promise<IndexedSnippet[]> {
  const seen = new Set<string>()
  const ordered: IndexedSnippet[] = []
  for (const snippet of [...imported, ...nearby]) {
    const key = `${snippet.path}:${snippet.symbol}`
    if (seen.has(key)) continue
    seen.add(key)
    const text = snippet.text.trim().slice(0, MAX_SNIPPET_CHARS)
    if (!text) continue
    ordered.push({ ...snippet, text })
  }
  const out: IndexedSnippet[] = []
  let used = 0
  for (const snippet of ordered) {
    if (out.length >= MAX_SNIPPETS) break
    const cost = await count(snippet.text)
    if (used + cost <= budget) {
      out.push(snippet)
      used += cost
      continue
    }
    if (out.length === 0 && budget > 16) {
      const chars = Math.max(16, Math.floor(budget * 3.2))
      out.push({ ...snippet, text: snippet.text.slice(0, chars) })
      break
    }
  }
  return out
}
