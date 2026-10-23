/**
 * Provider-agnostic types for the Surf agent core.
 *
 * These are the shapes that BOTH the offline (local llama.cpp) and online
 * (gateway) paths share: the chat message envelope, the completion request the
 * loop emits, the normalized model turn it gets back, and the view types the UI
 * renders. Nothing here imports a transport, node builtins, or React - the same
 * loop produces the identical output format for either provider.
 *
 * Desktop re-exports these from its historical module paths (llama-client,
 * parse-tool, loop, ipc-contract) so existing importers stay unchanged.
 */

// ---- Chat envelope (was apps/desktop/src/main/core/llama-client.ts) ----

export type Role = 'system' | 'user' | 'assistant' | 'tool'
export type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }
export interface ToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }

export interface ChatMessage {
  role: Role
  content: string | ContentPart[] | null
  tool_calls?: ToolCall[]
  tool_call_id?: string
}

// ---- Structured-output constraint (was apps/desktop/src/main/core/code-agent/grammar.ts) ----

export interface ToolCallResponseFormat {
  type: 'json_schema'
  json_schema: {
    name: string
    strict: boolean
    schema: Record<string, unknown>
  }
}

// ---- Completion request the loop emits (was code-agent/loop.ts) ----

export interface CompletionRequest {
  messages: ChatMessage[]
  tools?: readonly unknown[]
  responseFormat?: ToolCallResponseFormat
  grammar?: string
  /** Thinking is on for planning and hard fixes only. */
  thinking?: boolean
  maxTokens: number
  signal?: AbortSignal
  /** triage and edit stay on the small model. plan and hard-fix use the larger one when both fit. */
  stepKind?: 'triage' | 'edit' | 'plan' | 'hard-fix'
  /** True when this request's stable prefix matches the previous one. */
  cachePrompt?: boolean
  onDelta?: (text: string) => void
}

// ---- Normalized model turn (was code-agent/parse-tool.ts) ----

export interface ModelTurn {
  content: string | null
  toolCalls?: { id?: string; name: string; arguments: string }[]
  usage?: { promptTokens: number; completionTokens: number }
  /**
   * Why the model stopped, straight from the transport. 'length' means the reply
   * was cut at the token cap, so both sub-chats can offer the same Continue.
   * Absent when the stream never said - the field stays additive for the loop.
   */
  finishReason?: string
}

// ---- Code-agent view types (were shared/ipc-contract.ts) ----

export type CodeStepStatus = 'running' | 'ok' | 'error' | 'waiting' | 'rejected' | 'applied'

export interface CodeDiagnosticView {
  file: string
  line: number
  column: number
  message: string
  rule: string
  source: string
}

export interface CodeStepView {
  id: string
  index: number
  tool: string
  status: CodeStepStatus
  title: string
  detail: string
  /** Live check log. The tail is kept so the row stays small. */
  output?: string
  diagnostics?: CodeDiagnosticView[]
  /** 1-based attempt or candidate counter. */
  attempt?: number
  attempts?: number
  /** Best-effort sandbox note. Present when a command actually ran. */
  note?: string
}

export type CodeDiffStatus = 'pending' | 'applied' | 'rejected' | 'error'

export interface CodeDiffView {
  id: string
  stepId: string
  path: string
  diff: string
  status: CodeDiffStatus
}

export interface CodePlanStepView {
  id: string
  index: number
  goal: string
  files: string[]
  symbols: string[]
  dependsOn: string[]
  check: string
  create: boolean
}

export interface CodeUndoView {
  stepId: string
  title: string
}

export interface CodePlanView {
  status: 'review' | 'running' | 'done'
  steps: CodePlanStepView[]
  undos?: CodeUndoView[]
}
