/**
 * Split reference text on headings. A chunk keeps its heading so a citation
 * can name the section. Long sections split on blank lines.
 */

export interface ChunkDraft {
  heading: string
  text: string
}

const HEADING = /^(#{1,4})\s+(.+?)\s*$/

export function chunkByHeading(markdown: string, maxChars = 1800): ChunkDraft[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const sections: { heading: string; body: string[] }[] = []
  let heading = ''
  let body: string[] = []
  const flush = () => {
    sections.push({ heading, body })
    body = []
  }
  for (const line of lines) {
    const match = HEADING.exec(line)
    if (match) {
      flush()
      heading = match[2].replace(/\s+#+\s*$/, '').trim()
      continue
    }
    body.push(line)
  }
  flush()
  const out: ChunkDraft[] = []
  for (const section of sections) {
    const text = clean(section.body.join('\n'))
    if (text.length < 40) continue
    const title = section.heading || 'Overview'
    if (text.length <= maxChars) {
      out.push({ heading: title, text })
      continue
    }
    for (const part of splitLong(text, maxChars)) {
      out.push({ heading: title, text: part })
    }
  }
  return out
}

function clean(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function splitLong(text: string, maxChars: number): string[] {
  const blocks = text.split(/\n\n+/)
  const parts: string[] = []
  let current = ''
  for (const block of blocks) {
    const piece = block.trim()
    if (!piece) continue
    if (piece.length > maxChars) {
      if (current) parts.push(current)
      current = ''
      for (let i = 0; i < piece.length; i += maxChars) parts.push(piece.slice(i, i + maxChars))
      continue
    }
    const next = current ? `${current}\n\n${piece}` : piece
    if (next.length > maxChars && current) {
      parts.push(current)
      current = piece
    } else {
      current = next
    }
  }
  if (current) parts.push(current)
  return parts.filter((part) => part.length >= 40)
}
