/** Sibling texts of one assistant reply. The last entry is the text stored on the message. */

export function nextReplyVersions(stored: readonly string[], currentText: string, nextText: string): string[] {
  const prior = stored.filter((text) => text.length > 0)
  const seed = prior.length > 0 ? [...prior] : (currentText ? [currentText] : [])
  if (!nextText) return seed
  if (seed.length > 0 && seed[seed.length - 1] === nextText) return seed
  return [...seed, nextText]
}

export interface ReplyTurn {
  id: string
  role: 'user' | 'assistant'
  text: string
  versions: string[]
}

/** A new answer replaces the same assistant reply. The user turn is unchanged. */
export function regenerateReply(messages: readonly ReplyTurn[], assistantId: string, nextText: string): ReplyTurn[] {
  const index = messages.findIndex((message) => message.id === assistantId && message.role === 'assistant')
  if (index < 0) throw new Error('That reply is not in this chat.')
  const next = messages.map((message) => ({ ...message, versions: [...message.versions] }))
  const current = next[index]
  if (!current) throw new Error('That reply is not in this chat.')
  current.versions = nextReplyVersions(current.versions, current.text, nextText)
  current.text = current.versions[current.versions.length - 1] ?? nextText
  if (next.length !== messages.length) throw new Error('regenerate added a turn')
  if (next.filter((message) => message.role === 'user').length !== messages.filter((message) => message.role === 'user').length) {
    throw new Error('regenerate added a turn')
  }
  return next
}
