/**
 * The Code agent sees a few chunks, not the pack.
 * Citations use the chunk's own label, for example "Python 3.14 docs, asyncio".
 */
import type { PackHit } from './code-pack-search.js'

export function packReferenceBlock(hits: PackHit[], maxChars = 2400): { text: string; used: PackHit[] } {
  const header = [
    'SOURCES',
    'Use these sources when they answer the question. Cite each one you use on its own line, exactly as `From: <label>` where <label> is the label above that source.',
    'If the sources do not contain the API, say it is not in the Code pack. Do not invent APIs, flags, or error codes.',
    '',
  ].join('\n')
  const used: PackHit[] = []
  const parts: string[] = []
  let size = header.length
  for (const hit of hits) {
    const body = `[S${used.length + 1}] From: ${hit.citation}\n${hit.text.trim()}\n`
    if (used.length >= 4) break
    if (used.length && size + body.length > maxChars) break
    const clipped = !used.length && body.length > maxChars ? body.slice(0, maxChars) : body
    parts.push(clipped)
    used.push(hit)
    size += clipped.length
  }
  if (!used.length) return { text: '', used: [] }
  return { text: header + parts.join('\n'), used }
}

export function ensureCitations(answer: string, hits: PackHit[]): string {
  const lines: string[] = []
  for (const hit of hits.slice(0, 3)) {
    const line = `From: ${hit.citation}`
    if (!answer.includes(line)) lines.push(line)
  }
  if (!lines.length) return answer
  const trimmed = answer.trim()
  return trimmed ? `${trimmed}\n\n${lines.join('\n')}` : lines.join('\n')
}

const API_QUESTION = /\b(?:what|how)\s+(?:does|do|is)\s+([A-Za-z_][\w.]*)\s*\(/i

/** A direct API question whose symbol is absent from the retrieved chunks. */
export function unknownApiRefusal(question: string, hits: PackHit[]): string | null {
  const match = API_QUESTION.exec(question)
  if (!match?.[1]) return null
  const symbol = match[1]
  const tail = symbol.split('.').pop()?.toLowerCase() ?? ''
  if (tail.length < 4) return null
  const blob = hits.map((hit) => `${hit.heading}\n${hit.text}`).join('\n').toLowerCase()
  if (blob.includes(tail)) return null
  return `${symbol} is not in the Code pack. I will not guess its arguments or return value.`
}
