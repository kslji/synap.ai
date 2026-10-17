/**
 * Grounded file answers. Each hit cites the file path. The model is not required:
 * the text is the matching passage, so the answer stays on the device.
 */
import type { Citation } from '../ipc-contract.js'
import { displayPath, type PathStyle } from './paths.js'
import type { RankedChunk } from './store.js'

export interface FileAnswer {
  text: string
  citations: Citation[]
  gate: 'answer' | 'insufficient'
}

export function composeFileAnswer(question: string, hits: readonly RankedChunk[], home: string, style: PathStyle): FileAnswer {
  if (!hits.length) {
    return {
      text: 'I could not find that in the folders you have allowed. Grant a folder from the card, or pick one in Settings, Permissions.',
      citations: [],
      gate: 'insufficient',
    }
  }
  const top = hits.slice(0, 4)
  const citations: Citation[] = top.map((hit) => ({
    kind: 'document',
    title: displayPath(hit.path, home, style),
    url: '',
    pack: 'your files',
    fileName: hit.name,
    filePath: hit.path,
    locator: hit.locator,
    excerpt: hit.text.replace(/\s+/g, ' ').slice(0, 240),
  }))
  const lines = top.map((hit, index) => {
    const where = displayPath(hit.path, home, style)
    const place = hit.locator ? ` (${hit.locator})` : ''
    const excerpt = hit.text.replace(/\s+/g, ' ').trim().slice(0, 320)
    return `[S${index + 1}] ${where}${place}\n${excerpt}`
  })
  const lead = leadIn(question, displayPath(top[0].path, home, style))
  return { text: `${lead}\n\n${lines.join('\n\n')}`, citations, gate: 'answer' }
}

function leadIn(question: string, where: string): string {
  if (/\b(summarise|summarize|summary)\b/i.test(question)) return `Here is what those files say. The closest passage is in ${where}. [S1]`
  if (/\b(find|where|which file|locate)\b/i.test(question)) return `I found this in ${where}. [S1]`
  return `This is from ${where}. [S1]`
}

export function catchingUpNote(done: number, total: number): string {
  if (total <= done) return ''
  return `\n\nStill indexing this folder (${done} of ${total} files).`
}
