/**
 * Structure-aware chunks for user documents.
 * About 250 words (kept between 200 and 300 when a section is longer), 40-word overlap.
 * A heading, page, slide, or sheet change starts a new chunk so citations stay put.
 */

export const CHUNK_TARGET = 250
export const CHUNK_MAX = 300
export const CHUNK_OVERLAP = 40

export interface Block {
  text: string
  heading?: string | null
  page?: number | null
  slide?: number | null
  sheet?: string | null
}

export interface TextChunk {
  text: string
  heading: string | null
  wordCount: number
  pageStart: number | null
  pageEnd: number | null
  locatorKind: 'page' | 'slide' | 'sheet' | null
  locatorLabel: string | null
}

interface Word {
  word: string
  heading: string | null
  page: number | null
  slide: number | null
  sheet: string | null
}

export function locatorOf(chunk: Pick<TextChunk, 'locatorKind' | 'locatorLabel' | 'pageStart'>): string | null {
  if (chunk.locatorKind === 'slide' && chunk.locatorLabel) return `slide ${chunk.locatorLabel}`
  if (chunk.locatorKind === 'sheet' && chunk.locatorLabel) return `sheet ${chunk.locatorLabel}`
  if (chunk.locatorKind === 'page' && chunk.locatorLabel) return `page ${chunk.locatorLabel}`
  if (chunk.pageStart) return `page ${chunk.pageStart}`
  return null
}

export function chunkBlocks(blocks: Block[]): TextChunk[] {
  const words = flatten(blocks)
  if (!words.length) return []
  const chunks: TextChunk[] = []
  let start = 0
  while (start < words.length) {
    let end = start + 1
    while (end < words.length && samePlace(words[start], words[end])) end++
    const section = words.slice(start, end)
    if (section.length <= CHUNK_MAX) chunks.push(toChunk(section))
    else {
      let i = 0
      while (i < section.length) {
        const room = section.length - i
        if (room <= CHUNK_MAX) {
          chunks.push(toChunk(section.slice(i)))
          break
        }
        chunks.push(toChunk(section.slice(i, i + CHUNK_TARGET)))
        i += CHUNK_TARGET - CHUNK_OVERLAP
      }
    }
    start = end
  }
  return chunks
}

function flatten(blocks: Block[]): Word[] {
  const out: Word[] = []
  for (const block of blocks) {
    const heading = block.heading?.trim() || null
    const page = block.page ?? null
    const slide = block.slide ?? null
    const sheet = block.sheet?.trim() || null
    for (const word of block.text.split(/\s+/)) {
      if (word) out.push({ word, heading, page, slide, sheet })
    }
  }
  return out
}

function samePlace(a: Word, b: Word): boolean {
  return a.heading === b.heading && a.page === b.page && a.slide === b.slide && a.sheet === b.sheet
}

function toChunk(slice: Word[]): TextChunk {
  const pages = slice.map((w) => w.page).filter((n): n is number => n != null)
  const slide = slice.find((w) => w.slide != null)?.slide ?? null
  const sheet = slice.find((w) => w.sheet)?.sheet ?? null
  const heading = slice.find((w) => w.heading)?.heading ?? null
  let locatorKind: TextChunk['locatorKind'] = null
  let locatorLabel: string | null = null
  if (slide != null) {
    locatorKind = 'slide'
    locatorLabel = String(slide)
  } else if (sheet) {
    locatorKind = 'sheet'
    locatorLabel = sheet
  } else if (pages.length) {
    locatorKind = 'page'
    locatorLabel = String(pages[0])
  }
  const body = slice.map((w) => w.word).join(' ')
  const text = heading && !body.startsWith(heading) ? `${heading}\n${body}` : body
  return {
    text,
    heading,
    wordCount: slice.length,
    pageStart: pages[0] ?? null,
    pageEnd: pages.length ? pages[pages.length - 1] : null,
    locatorKind,
    locatorLabel,
  }
}
