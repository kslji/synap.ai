import type { ChatEvent, GateName, StoredMessage } from '../../shared/ipc-contract'

export type View = 'onboarding' | 'chat' | 'models' | 'settings' | 'library'

export interface UiMsg {
  id: string
  role: 'user' | 'assistant'
  text: string
  sources: StoredMessage['sources']
  pending?: boolean
  error?: boolean
  gate?: GateName
  tools: { name: string; input: string; output: string }[]
}

export function applyEvent(prev: UiMsg[], e: ChatEvent): UiMsg[] {
  const next = prev.map((m) => ({ ...m, sources: [...m.sources], tools: [...m.tools] }))
  let i = next.findIndex((m) => m.id === e.messageId)
  if (i < 0) i = next.findIndex((m) => m.pending && m.role === 'assistant')
  if (i < 0) return prev
  const m = next[i]
  m.id = e.messageId
  if (e.type === 'token') m.text += e.text
  if (e.type === 'sources') m.sources = e.sources
  if (e.type === 'tool') m.tools.push({ name: e.name, input: e.input, output: e.output })
  if (e.type === 'error') {
    m.error = true
    m.pending = false
    if (!m.text) m.text = e.message
  }
  if (e.type === 'done') {
    m.pending = false
    m.gate = e.gate
  }
  return next
}
