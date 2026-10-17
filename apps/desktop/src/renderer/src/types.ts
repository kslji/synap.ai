import type { ChatEvent, CodeDiffView, CodePlanView, CodeStepView, FilePermissionPrompt, GateName, StoredMessage } from '../../shared/ipc-contract'

function copyPlan(plan: CodePlanView): CodePlanView {
  const steps = plan.steps.map((step) => ({
    id: step.id,
    index: step.index,
    goal: step.goal,
    files: [...step.files],
    symbols: [...step.symbols],
    dependsOn: [...step.dependsOn],
    check: step.check,
    create: step.create,
  }))
  if (plan.undos === undefined) return { status: plan.status, steps }
  return { status: plan.status, steps, undos: plan.undos.map((undo) => ({ stepId: undo.stepId, title: undo.title })) }
}

export type View = 'onboarding' | 'home' | 'agents' | 'chats' | 'chat' | 'models' | 'settings' | 'library' | 'signin' | 'packs' | 'usage'

export interface UiMsg {
  id: string
  role: 'user' | 'assistant'
  text: string
  sources: StoredMessage['sources']
  pending?: boolean
  error?: boolean
  smallerModelId?: string
  gate?: GateName
  phase?: 'searching' | 'reading' | 'files'
  fileAsk?: FilePermissionPrompt | null
  tools: { name: string; input: string; output: string }[]
  steps?: CodeStepView[]
  diffs?: CodeDiffView[]
  plan?: CodePlanView
  startedAt?: number
  elapsedMs?: number | null
  modelId?: string
  /** Earlier sibling answers for this reply. The latest text is `text`. */
  versions?: string[]
  /** A token event arrived, so the reply was streamed. */
  streamed?: boolean
}

export function applyEvent(prev: UiMsg[], e: ChatEvent): UiMsg[] {
  const next = prev.map((m) => ({
    ...m,
    sources: [...m.sources],
    tools: [...m.tools],
    steps: [...(m.steps ?? [])],
    diffs: [...(m.diffs ?? [])],
    plan: m.plan ? copyPlan(m.plan) : undefined,
    startedAt: m.startedAt,
    elapsedMs: m.elapsedMs,
    modelId: m.modelId,
    versions: m.versions ? [...m.versions] : undefined,
    fileAsk: m.fileAsk ?? null,
  }))
  let i = next.findIndex((m) => m.id === e.messageId)
  if (i < 0) i = next.findIndex((m) => m.pending && m.role === 'assistant')
  if (i < 0) return prev
  const m = next[i]
  m.id = e.messageId
  if (e.type === 'token') {
    m.text += e.text
    m.streamed = true
  }
  if (e.type === 'status') m.phase = e.phase
  if (e.type === 'file-ask') {
    m.fileAsk = e.prompt
    m.phase = 'files'
    m.pending = true
  }
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
  if (e.type === 'code-plan') m.plan = e.plan
  if (e.type === 'error') {
    m.error = true
    m.pending = false
    m.smallerModelId = e.smallerModelId
    if (!m.text) m.text = e.message
  }
  if (e.type === 'done') {
    m.pending = false
    m.fileAsk = null
    m.gate = e.gate
    if (e.text) m.text = e.text
    if (m.startedAt) m.elapsedMs = Date.now() - m.startedAt
  }
  return next
}
