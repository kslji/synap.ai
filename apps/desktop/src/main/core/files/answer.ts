/**
 * Grounded file answers. The body is the passage, with [S1] only where that
 * source is used. Paths stay on the citation chips, not in a second list.
 */
import type { Citation } from '../ipc-contract.js'
import { citedSourceIndexes } from '../../../shared/cited-sources.js'
import { displayPath, type PathStyle } from './paths.js'
import type { RankedChunk } from './store.js'

export interface FileAnswer {
  text: string
  citations: Citation[]
  gate: 'answer' | 'insufficient'
}

const SUMMARY = /\b(summarise|summarize|summary|compare)\b/i

export function composeFileAnswer(question: string, hits: readonly RankedChunk[], home: string, style: PathStyle): FileAnswer {
  const unique = uniqueFiles(hits)
  if (!unique.length) {
    return {
      text: 'I could not find that in the folders you have allowed. Grant a folder from the card, or pick one in Settings, Permissions.',
      citations: [],
      gate: 'insufficient',
    }
  }
  const chosen = SUMMARY.test(question) ? unique.slice(0, 3) : unique.slice(0, 1)
  return finishAnswer(chosen.map((hit, index) => {
    const body = readablePassage(hit.text)
    return {
      paragraph: `${body} [S${index + 1}]`,
      citation: citationFor(hit, home, style),
    }
  }))
}

export function composeNameAnswer(hits: readonly { name: string; path: string }[], home: string, style: PathStyle): FileAnswer {
  const chosen = hits.slice(0, 4)
  if (!chosen.length) {
    return { text: 'I could not find a matching file name in the folders you have allowed.', citations: [], gate: 'insufficient' }
  }
  const text = chosen.length === 1
    ? `${chosen[0].name} matches that name. [S1]`
    : `These files match by name: ${chosen.map((hit, index) => `${hit.name} [S${index + 1}]`).join(', ')}.`
  return {
    text,
    citations: chosen.map((hit) => ({
      kind: 'document' as const,
      title: displayPath(hit.path, home, style),
      url: '',
      pack: 'your files',
      fileName: hit.name,
      filePath: hit.path,
      excerpt: hit.name,
    })),
    gate: 'answer',
  }
}

export function readablePassage(text: string): string {
  const flat = text.replace(/\[S\d+\]/g, '').replace(/\s+/g, ' ').trim().replace(/^#{1,6}\s+/, '')
  const clipped = flat.slice(0, 480).trim()
  return clipped || 'This file matches.'
}

export function catchingUpNote(done: number, total: number): string {
  if (total <= done) return ''
  return `\n\nStill indexing this folder (${done} of ${total} files).`
}

function uniqueFiles(hits: readonly RankedChunk[]): RankedChunk[] {
  const seen = new Set<string>()
  const out: RankedChunk[] = []
  for (const hit of hits) {
    if (!hit.text.trim() || seen.has(hit.path)) continue
    seen.add(hit.path)
    out.push(hit)
  }
  return out
}

function citationFor(hit: RankedChunk, home: string, style: PathStyle): Citation {
  const where = displayPath(hit.path, home, style)
  return {
    kind: 'document',
    title: where,
    url: '',
    pack: 'your files',
    fileName: hit.name,
    filePath: hit.path,
    locator: hit.locator,
    excerpt: readablePassage(hit.text).slice(0, 240),
  }
}

function finishAnswer(rows: { paragraph: string; citation: Citation }[]): FileAnswer {
  const text = rows.map((row) => row.paragraph).filter(Boolean).join('\n\n')
  const citations = rows.map((row) => row.citation)
  const used = citedSourceIndexes(text)
  return {
    text,
    citations: used.map((n) => citations[n - 1]).filter((row): row is Citation => Boolean(row)),
    gate: 'answer',
  }
}
