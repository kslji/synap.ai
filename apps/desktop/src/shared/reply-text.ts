/**
 * Reply text stays whole: stream pieces join without splitting a character,
 * a length stop ends on a sentence or a word, and titles and previews clip
 * on a word with an ellipsis.
 */

export const MARKDOWN_ASK =
  'Write the answer in Markdown with headings, lists, and fenced code when they help. Close every fence and every bold mark. Finish each sentence, and do not stop in the middle of a word.'

/** Stored chat title. The header can wrap this; it is already on a word. */
export const TITLE_LIMIT = 64
/** Stored sidebar preview, clipped again for the narrow row. */
export const PREVIEW_LIMIT = 80
export const SIDEBAR_TITLE_LIMIT = 36
export const SIDEBAR_PREVIEW_LIMIT = 48
/** Spoken on this computer. The renderer and the main process use the same cap. */
export const SPEAK_LIMIT = 4000
export const NOTIFY_LIMIT = 180
export const NOTES_LIMIT = 500

const ELLIPSIS = '…'

export function createStreamJoiner() {
  const decoder = new TextDecoder('utf-8', { fatal: false })
  let pending = ''
  function take(chunk: string): string {
    pending += chunk
    if (!pending) return ''
    const last = pending.charCodeAt(pending.length - 1)
    if (last >= 0xd800 && last <= 0xdbff) {
      const ready = pending.slice(0, -1)
      pending = pending.slice(-1)
      return ready
    }
    const ready = pending
    pending = ''
    return ready
  }
  return {
    pushText(chunk: string): string {
      return take(chunk)
    },
    pushBytes(bytes: Uint8Array): string {
      return take(decoder.decode(bytes, { stream: true }))
    },
    flush(): string {
      const rest = pending + decoder.decode()
      pending = ''
      return rest
    },
  }
}

/** Join model pieces in order. A word split across tokens stays one word. */
export function joinTokenPieces(pieces: readonly string[]): string {
  const joiner = createStreamJoiner()
  let out = ''
  for (const piece of pieces) out += joiner.pushText(piece)
  return out + joiner.flush()
}

/** Join UTF-8 bytes that may split a character across reads. */
export function joinUtf8Chunks(chunks: readonly Uint8Array[]): string {
  const joiner = createStreamJoiner()
  let out = ''
  for (const chunk of chunks) out += joiner.pushBytes(chunk)
  return out + joiner.flush()
}

function loneSurrogate(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i)
    const high = code >= 0xd800 && code <= 0xdbff
    const low = code >= 0xdc00 && code <= 0xdfff
    if (high) {
      const next = text.charCodeAt(i + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true
      i += 1
      continue
    }
    if (low) return true
  }
  return false
}

function outsideCode(text: string): string {
  return text.split('```').filter((_, index) => index % 2 === 0).join('')
}

export function markdownBalanced(text: string): boolean {
  if ((text.match(/```/g) ?? []).length % 2 !== 0) return false
  const prose = outsideCode(text)
  if ((prose.match(/\*\*/g) ?? []).length % 2 !== 0) return false
  if ((prose.match(/`/g) ?? []).length % 2 !== 0) return false
  return true
}

/** Close an open fence or bold mark so the final bubble is not raw markup. */
export function balanceMarkdown(source: string): string {
  let text = source.replace(/\s+$/g, '')
  if ((text.match(/```/g) ?? []).length % 2 !== 0) text = `${text}\n\`\`\``
  const prose = outsideCode(text)
  if ((prose.match(/\*\*/g) ?? []).length % 2 !== 0) text = `${text}**`
  const afterBold = outsideCode(text)
  if ((afterBold.match(/`/g) ?? []).length % 2 !== 0) text = `${text}\``
  return text
}

/**
 * While tokens are still arriving, hide an open fence or an open bold mark
 * so the bubble does not flash raw markup.
 */
export function streamingMarkdown(source: string): string {
  let text = source
  const last = text.charCodeAt(text.length - 1)
  if (last >= 0xd800 && last <= 0xdbff) text = text.slice(0, -1)
  const fences = text.split('```')
  if ((fences.length - 1) % 2 !== 0) text = fences.slice(0, -1).join('```')
  if ((outsideCode(text).match(/\*\*/g) ?? []).length % 2 !== 0) {
    const at = text.lastIndexOf('**')
    if (at >= 0) text = text.slice(0, at)
  }
  if ((outsideCode(text).match(/`/g) ?? []).length % 2 !== 0) {
    const at = text.lastIndexOf('`')
    if (at >= 0) text = text.slice(0, at)
  }
  return text
}

function sentenceEnd(text: string): boolean {
  const core = text.replace(/["')\]]+$/g, '')
  if (!core) return false
  const last = core[core.length - 1]
  return last === '.' || last === '!' || last === '?' || last === '…'
}

function endsOnBoundary(text: string): boolean {
  if (!text.trim()) return true
  if (/\s$/.test(text)) return true
  return sentenceEnd(text.replace(/\s+$/g, ''))
}

/**
 * A length stop keeps the last full sentence, or else the last full word.
 * The partial last word is removed.
 */
export function closeAtBoundary(text: string): { text: string; clipped: boolean } {
  const trimmed = text.replace(/\s+$/g, '')
  if (!trimmed) return { text: '', clipped: text.length > 0 }
  if (endsOnBoundary(text)) {
    return { text: trimmed, clipped: trimmed !== text }
  }
  const windowStart = Math.max(0, trimmed.length - 500)
  const window = trimmed.slice(windowStart)
  let end = -1
  for (let i = window.length - 1; i >= 0; i -= 1) {
    const ch = window[i]
    if (ch === '.' || ch === '!' || ch === '?' || ch === '…') {
      end = windowStart + i + 1
      break
    }
  }
  if (end > 0) return { text: trimmed.slice(0, end).replace(/\s+$/g, ''), clipped: true }
  const space = trimmed.search(/\s+\S+$/)
  if (space > 0) return { text: trimmed.slice(0, space).replace(/\s+$/g, ''), clipped: true }
  return { text: '', clipped: true }
}

export function finishReply(text: string, lengthLimited: boolean): { text: string; canContinue: boolean } {
  const cut = lengthLimited ? closeAtBoundary(text) : { text: text.replace(/\s+$/g, ''), clipped: false }
  return { text: balanceMarkdown(cut.text), canContinue: lengthLimited }
}

/** Clip on a word and add an ellipsis. A short string is unchanged. */
export function clipWords(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  const room = Math.max(1, max - ELLIPSIS.length)
  let cut = flat.slice(0, room)
  const space = cut.lastIndexOf(' ')
  if (space > 0) cut = cut.slice(0, space)
  return `${cut.trimEnd()}${ELLIPSIS}`
}

export function replyShapeOk(text: string): boolean {
  if (text.includes('\uFFFD')) return false
  if (loneSurrogate(text)) return false
  if (!markdownBalanced(text)) return false
  if (/[A-Za-z0-9]-$/.test(text.trim())) return false
  return true
}
