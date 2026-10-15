import type { ChatEvent, CodeDiffView, CodeStepView, GateName, StoredMessage } from '../../shared/ipc-contract'

export type View = 'onboarding' | 'home' | 'agents' | 'chats' | 'chat' | 'models' | 'settings' | 'library' | 'signin' | 'packs'

export interface UiMsg {
  id: string
  role: 'user' | 'assistant'
  text: string
  sources: StoredMessage['sources']
  pending?: boolean
  error?: boolean
  smallerModelId?: string
  gate?: GateName
  phase?: 'searching' | 'reading'
  tools: { name: string; input: string; output: string }[]
  steps?: CodeStepView[]
  diffs?: CodeDiffView[]
}

export function applyEvent(prev: UiMsg[], e: ChatEvent): UiMsg[] {
  const next = prev.map((m) => ({ ...m, sources: [...m.sources], tools: [...m.tools], steps: [...(m.steps ?? [])], diffs: [...(m.diffs ?? [])] }))
  let i = next.findIndex((m) => m.id === e.messageId)
  if (i < 0) i = next.findIndex((m) => m.pending && m.role === 'assistant')
  if (i < 0) return prev
  const m = next[i]
  m.id = e.messageId
  if (e.type === 'token') m.text += e.text
  if (e.type === 'status') m.phase = e.phase
  if (e.type === 'sources') m.sources = e.sources
  if (e.type === 'tool') m.tools.push({ name: e.name, input: e.input, output: e.output })
  if (e.type === 'code-step') {
    const at = m.steps.findIndex((step) => step.id === e.step.id)
    if (at >= 0) m.steps[at] = e.step
    else m.steps.push(e.step)
  }
  if (e.type === 'code-diff') {
    const at = m.diffs.findIndex((diff) => diff.id === e.diff.id)
    if (at >= 0) m.diffs[at] = e.diff
    else m.diffs.push(e.diff)
  }
  if (e.type === 'error') {
    m.error = true
    m.pending = false
    m.smallerModelId = e.smallerModelId
    if (!m.text) m.text = e.message
  }
  if (e.type === 'done') {
    m.pending = false
    m.gate = e.gate
    if (e.text) m.text = e.text
  }
  return next
}
