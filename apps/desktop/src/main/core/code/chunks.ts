/** Symbol-sized search chunks. A long function is sliced by lines, not by a fixed window that ignores it. */
import { CODE_LIMITS } from './limits.js'
import type { ExtractedSymbol } from './parse.js'

export interface ChunkDraft {
  symbolKey: string | null
  name: string
  kind: string
  startLine: number
  endLine: number
  text: string
}

export function splitIdent(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-./]+/g, ' ')
    .trim()
}

function wordCount(line: string): number {
  return line.split(/\s+/).filter(Boolean).length
}

function sliceSymbol(symbol: ExtractedSymbol): ChunkDraft[] {
  const lines = symbol.text.split('\n')
  const total = lines.reduce((sum, line) => sum + wordCount(line), 0)
  const label = splitIdent(symbol.qualified)
  if (total <= CODE_LIMITS.chunkWords + 30) {
    return [{
      symbolKey: symbol.qualified + ':' + String(symbol.startLine),
      name: symbol.qualified,
      kind: symbol.kind,
      startLine: symbol.startLine,
      endLine: symbol.endLine,
      text: `${label}\n${symbol.text}`,
    }]
  }
  const out: ChunkDraft[] = []
  const step = CODE_LIMITS.chunkWords
  const overlap = CODE_LIMITS.chunkOverlapWords
  let wordStart = 0
  let lineStart = 0
  while (lineStart < lines.length) {
    let words = 0
    let lineEnd = lineStart
    while (lineEnd < lines.length && words < step) {
      words += wordCount(lines[lineEnd] ?? '')
      lineEnd++
    }
    const text = lines.slice(lineStart, lineEnd).join('\n')
    out.push({
      symbolKey: symbol.qualified + ':' + String(symbol.startLine),
      name: symbol.qualified,
      kind: symbol.kind,
      startLine: symbol.startLine + lineStart,
      endLine: symbol.startLine + lineEnd - 1,
      text: `${label}\n${text}`,
    })
    if (lineEnd >= lines.length) break
    let back = 0
    let next = lineEnd
    while (next > lineStart && back < overlap) {
      next--
      back += wordCount(lines[next] ?? '')
    }
    if (next <= lineStart) next = lineStart + 1
    lineStart = next
    wordStart += step
    if (wordStart > total + step) break
  }
  return out
}

export function chunksFor(symbols: ExtractedSymbol[]): ChunkDraft[] {
  const chunks: ChunkDraft[] = []
  const imports = symbols.filter((symbol) => symbol.kind === 'import')
  if (imports.length) {
    chunks.push({
      symbolKey: null,
      name: 'imports',
      kind: 'import',
      startLine: imports[0]!.startLine,
      endLine: imports[imports.length - 1]!.endLine,
      text: imports.map((symbol) => symbol.text).join('\n').slice(0, 4000),
    })
  }
  for (const symbol of symbols) {
    if (symbol.kind === 'import') continue
    chunks.push(...sliceSymbol(symbol))
  }
  return chunks
}
