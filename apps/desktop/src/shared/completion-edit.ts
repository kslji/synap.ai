/** Applying ghost text is a normal edit in the editor buffer. It does not touch disk. */

export function acceptAll(text: string, cursor: number, suggestion: string): { text: string; cursor: number } {
  const pos = clamp(cursor, text.length)
  return {
    text: text.slice(0, pos) + suggestion + text.slice(pos),
    cursor: pos + suggestion.length,
  }
}

export function nextWord(suggestion: string): { taken: string; rest: string } {
  const match = /^(\s*\S+)/.exec(suggestion)
  if (!match?.[1]) return { taken: suggestion, rest: '' }
  return { taken: match[1], rest: suggestion.slice(match[1].length) }
}

export function acceptWord(text: string, cursor: number, suggestion: string): { text: string; cursor: number; rest: string } {
  const word = nextWord(suggestion)
  const applied = acceptAll(text, cursor, word.taken)
  return { text: applied.text, cursor: applied.cursor, rest: word.rest }
}

function clamp(cursor: number, length: number): number {
  if (!Number.isFinite(cursor) || cursor < 0) return 0
  if (cursor > length) return length
  return Math.floor(cursor)
}
