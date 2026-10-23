/**
 * Code agent loop: plan, act, observe, repeat.
 * Ask mode waits on edits and on commands that were not allowed before.
 * Auto writes inside the project and runs the allowlist. Other commands pause.
 */
import type { CodeDiffView, CodeStepView } from '../../../shared/ipc-contract.js'
import type { ChatMessage } from '../llama-client.js'
import { truncateToTokens, type TokenCounter } from '../token-budget.js'
import { fitAgentMessages } from './budget.js'
import { applyPlannedEdit, planEdit } from './edit.js'
import { toolCallGbnf, toolCallJsonSchema } from './grammar.js'
import { parseModelTurn, type ModelTurn } from './parse-tool.js'
import { decideApproval, exactCommand, type ApprovalContext, type PermissionMode } from './permission.js'
import type { ProjectSearch } from './project-search.js'
import { codeSystemPrompt } from './system-rules.js'
import { takeOutputUpdate } from '../../../shared/stream-batch.js'
import { codeToolSchemas } from './tools.js'
import { listProjectDir, readProjectFile, runProjectCommand, splitCommand } from './workspace.js'
import type { CompletionRequest } from '@surf/agent-core'

// The completion request is the shared @surf/agent-core provider contract.
export type { CompletionRequest } from '@surf/agent-core'

export interface CodeAgentLimits {
  maxSteps: number
  maxParseRetries: number
  maxSameCall: number
}

export const CODE_AGENT_LIMITS: CodeAgentLimits = {
  maxSteps: 8,
  maxParseRetries: 2,
  maxSameCall: 2,
}

export interface CodeAgentHost {
  complete(req: CompletionRequest): Promise<ModelTurn>
  search: ProjectSearch
  root: string
  rules: string
  counter: TokenCounter
  promptBudget: number
  searchBudget: number
  answerTokens: number
  mode?: PermissionMode
  allowedCommands?: Iterable<string>
  /** Test, lint, typecheck, and build commands Auto may run without asking. */
  commandAllowlist?: Iterable<string>
  limits?: Partial<CodeAgentLimits>
  signal?: AbortSignal
  observationTokens?: number
  onStep?(step: CodeStepView): void
  onDiff?(diff: CodeDiffView): void
  ask(request: { kind: 'command' | 'edit'; id: string; command?: string; path?: string; diff?: string }): Promise<{ allow: boolean; remember?: boolean; all?: boolean }>
  runCommand?(command: string, signal?: AbortSignal, hooks?: { onOutput?: (chunk: string) => void }): Promise<{ ok: boolean; output: string; note?: string }>
  onRememberCommand?(command: string): void
}

export interface CodeAgentResult {
  answer: string
  steps: CodeStepView[]
  diffs: CodeDiffView[]
  stopped: 'finish' | 'limit' | 'repeat' | 'parse'
}

const REMINDER = 'The last reply was not a tool call. Reply with one JSON object {"tool":"<name>","arguments":{...}} and nothing else.'

type Constraint = 'native' | 'json_schema' | 'gbnf'

export async function runCodeAgent(task: string, host: CodeAgentHost, history: { user: string; assistant: string }[] = []): Promise<CodeAgentResult> {
  const limits = { ...CODE_AGENT_LIMITS, ...host.limits }
  const mode = host.mode ?? 'ask'
  const allowed = new Set([...host.allowedCommands ?? []].map(exactCommand))
  const allowlist = new Set([...host.commandAllowlist ?? []].map(exactCommand))
  const session = { acceptAll: false }
  const steps: CodeStepView[] = []
  const diffs: CodeDiffView[] = []
  const seen = new Map<string, number>()
  let lastSig = ''
  let seq = 0
  const messages: ChatMessage[] = [
    { role: 'system', content: codeSystemPrompt(host.rules) },
  ]
  for (const turn of history.slice(-4)) {
    messages.push({ role: 'user', content: turn.user })
    messages.push({ role: 'assistant', content: turn.assistant })
  }
  messages.push({ role: 'user', content: task })

  for (let n = 0; n < limits.maxSteps; n++) {
    throwIfAborted(host.signal)
    const parsed = await obtainCall(host, messages, limits.maxParseRetries)
    if (!parsed) {
      return { answer: 'I could not read a tool call from the model.', steps, diffs, stopped: 'parse' }
    }
    const sig = `${parsed.call.name}\0${stable(parsed.call.arguments)}`
    const times = (seen.get(sig) ?? 0) + 1
    seen.set(sig, times)
    if (sig === lastSig || times > limits.maxSameCall) {
      return { answer: 'Stopped because that step repeated.', steps, diffs, stopped: 'repeat' }
    }
    lastSig = sig
    const id = `step-${++seq}`
    const title = stepTitle(parsed.call.name, parsed.call.arguments)
    if (parsed.call.name === 'finish') {
      const summary = stringArg(parsed.call.arguments, 'summary') || 'Done.'
      pushStep(host, steps, { id, index: steps.length + 1, tool: 'finish', status: 'ok', title, detail: summary })
      return { answer: summary, steps, diffs, stopped: 'finish' }
    }
    const observation = await act(host, mode, allowed, allowlist, session, id, title, parsed.call.name, parsed.call.arguments, steps, diffs, () => `diff-${++seq}`)
    messages.push({ role: 'assistant', content: JSON.stringify({ tool: parsed.call.name, arguments: parsed.call.arguments }) })
    messages.push({ role: 'user', content: `Result:\n${observation}` })
  }
  return { answer: 'Stopped after the step limit.', steps, diffs, stopped: 'limit' }
}

async function obtainCall(host: CodeAgentHost, messages: ChatMessage[], maxParseRetries: number): Promise<{ call: NonNullable<ReturnType<typeof parseModelTurn>> } | null> {
  let constraint: Constraint = 'native'
  let reminder = false
  for (let attempt = 0; attempt <= maxParseRetries; attempt++) {
    throwIfAborted(host.signal)
    const fitted = await fitAgentMessages(host.counter, messages, host.promptBudget)
    const requestMessages = reminder
      ? [...fitted, { role: 'user' as const, content: REMINDER }]
      : fitted
    let turn: ModelTurn
    try {
      turn = await host.complete(requestFor(constraint, requestMessages, host))
    } catch (error) {
      if (isAbort(error) || host.signal?.aborted) throw error
      if (constraint === 'gbnf') throw error
      if (constraint === 'native' && !nativeToolsRejected(error)) throw error
      constraint = constraint === 'native' ? 'json_schema' : 'gbnf'
      continue
    }
    const call = parseModelTurn(turn)
    if (call) return { call }
    reminder = true
    if (constraint === 'native') constraint = 'json_schema'
    else if (constraint === 'json_schema') constraint = 'gbnf'
  }
  return null
}

function requestFor(constraint: Constraint, messages: ChatMessage[], host: CodeAgentHost): CompletionRequest {
  const stepKind = 'triage' as const
  if (constraint === 'json_schema') {
    return { messages, responseFormat: toolCallJsonSchema(), maxTokens: host.answerTokens, signal: host.signal, stepKind }
  }
  if (constraint === 'gbnf') {
    return { messages, grammar: toolCallGbnf(), maxTokens: host.answerTokens, signal: host.signal, stepKind }
  }
  return { messages, tools: codeToolSchemas(), maxTokens: host.answerTokens, signal: host.signal, stepKind }
}

async function act(
  host: CodeAgentHost,
  mode: PermissionMode,
  allowed: Set<string>,
  allowlist: Set<string>,
  session: { acceptAll: boolean },
  id: string,
  title: string,
  name: string,
  args: Record<string, unknown>,
  steps: CodeStepView[],
  diffs: CodeDiffView[],
  nextDiffId: () => string,
): Promise<string> {
  const index = steps.length + 1
  if (name === 'read_file') {
    const output = readProjectFile(host.root, args)
    pushStep(host, steps, { id, index, tool: name, status: output.startsWith('error:') ? 'error' : 'ok', title, detail: oneLine(output) })
    return clip(host, output)
  }
  if (name === 'list_dir') {
    const output = listProjectDir(host.root, args)
    pushStep(host, steps, { id, index, tool: name, status: output.startsWith('error:') ? 'error' : 'ok', title, detail: oneLine(output) })
    return clip(host, output)
  }
  if (name === 'search_project') {
    pushStep(host, steps, { id, index, tool: name, status: 'running', title, detail: 'Searching' })
    const query = stringArg(args, 'query')
    const pack = await host.search.context(query, { tokenBudget: host.searchBudget })
    const output = pack.snippets.length
      ? pack.snippets.map((snippet) => `--- ${snippet.path}:${snippet.startLine}-${snippet.endLine}${snippet.symbol ? ` ${snippet.symbol}` : ''}\n${snippet.text}`).join('\n\n')
      : 'No matches.'
    const status = pack.snippets.length ? 'ok' : 'error'
    const count = pack.snippets.length
    pushStep(host, steps, { id, index, tool: name, status, title, detail: count ? `${count} snippet${count === 1 ? '' : 's'}` : 'No matches' })
    return clip(host, output)
  }
  if (name === 'propose_edit') {
    const planned = planEdit(host.root, args)
    if ('error' in planned) {
      pushStep(host, steps, { id, index, tool: name, status: 'error', title, detail: planned.error })
      return `error: ${planned.error}`
    }
    const diffId = nextDiffId()
    const diff: CodeDiffView = { id: diffId, stepId: id, path: planned.path, diff: planned.diff, status: 'pending' }
    host.onDiff?.(diff)
    diffs.push(diff)
    const editGate = decideApproval(mode, { kind: 'edit' }, gateContext(allowed, allowlist))
    if (editGate.action === 'deny') {
      diff.status = 'rejected'
      host.onDiff?.(diff)
      pushStep(host, steps, { id, index, tool: name, status: 'rejected', title, detail: editGate.reason })
      return `error: ${editGate.reason}`
    }
    if (editGate.action === 'ask' && !session.acceptAll) {
      pushStep(host, steps, { id, index, tool: name, status: 'waiting', title, detail: planned.path })
      const decision = await host.ask({ kind: 'edit', id: diffId, path: planned.path, diff: planned.diff })
      throwIfAborted(host.signal)
      if (decision.all) session.acceptAll = true
      if (!decision.allow && !decision.all) {
        diff.status = 'rejected'
        host.onDiff?.(diff)
        pushStep(host, steps, { id, index, tool: name, status: 'rejected', title, detail: 'Rejected' })
        return 'The user rejected the edit. The file was not changed.'
      }
    }
    const applied = applyPlannedEdit(host.root, planned.path, planned.diff)
    if (!applied.ok) {
      diff.status = 'error'
      host.onDiff?.(diff)
      pushStep(host, steps, { id, index, tool: name, status: 'error', title, detail: applied.message })
      return `error: ${applied.message}`
    }
    diff.status = 'applied'
    host.onDiff?.(diff)
    pushStep(host, steps, { id, index, tool: name, status: 'applied', title, detail: planned.path })
    return `Applied the diff to ${planned.path}.`
  }
  if (name === 'run_command') {
    const command = stringArg(args, 'command')
    const split = splitCommand(command)
    if (!split.ok) {
      pushStep(host, steps, { id, index, tool: name, status: 'error', title, detail: split.reason })
      return `error: ${split.reason}`
    }
    const commandGate = decideApproval(mode, { kind: 'command', command }, gateContext(allowed, allowlist))
    if (commandGate.action === 'deny') {
      pushStep(host, steps, { id, index, tool: name, status: 'error', title, detail: commandGate.reason })
      return `error: ${commandGate.reason} It was not run.`
    }
    if (commandGate.action === 'ask') {
      pushStep(host, steps, { id, index, tool: name, status: 'waiting', title, detail: command })
      const decision = await host.ask({ kind: 'command', id, command })
      throwIfAborted(host.signal)
      if (!decision.allow) {
        pushStep(host, steps, { id, index, tool: name, status: 'rejected', title, detail: 'Denied' })
        return 'The user denied the command. It was not run.'
      }
      if (decision.remember) {
        const exact = exactCommand(command)
        allowed.add(exact)
        host.onRememberCommand?.(exact)
      }
    }
    let streamed = ''
    let pending = ''
    pushStep(host, steps, { id, index, tool: name, status: 'running', title, detail: command, output: '' })
    const run = host.runCommand ?? ((cmd, signal, hooks) => runProjectCommand(host.root, cmd, signal, hooks))
    const result = await run(command, host.signal, {
      onOutput(chunk) {
        streamed += chunk
        const next = takeOutputUpdate(pending, chunk)
        pending = next.pending
        if (next.emit) pushStep(host, steps, { id, index, tool: name, status: 'running', title, detail: command, output: tail(streamed) })
      },
    })
    throwIfAborted(host.signal)
    const note = result.note ?? ''
    pushStep(host, steps, { id, index, tool: name, status: result.ok ? 'ok' : 'error', title, detail: oneLine(result.output), output: tail(streamed || result.output), note })
    return clip(host, result.output)
  }
  pushStep(host, steps, { id, index, tool: name, status: 'error', title, detail: 'Unknown tool' })
  return `error: unknown tool ${name}`
}

function gateContext(remembered: ReadonlySet<string>, allowlist: ReadonlySet<string>): ApprovalContext {
  return { remembered, allowlist, checkpointPaths: new Set() }
}

function pushStep(host: CodeAgentHost, steps: CodeStepView[], step: CodeStepView): void {
  const at = steps.findIndex((item) => item.id === step.id)
  if (at >= 0) steps[at] = step
  else steps.push(step)
  host.onStep?.(step)
}

async function clip(host: CodeAgentHost, text: string): Promise<string> {
  return truncateToTokens(host.counter, text, host.observationTokens ?? 600)
}

function stringArg(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  return typeof value === 'string' ? value : ''
}

function oneLine(text: string): string {
  const line = text.split('\n').map((item) => item.trim()).find(Boolean) ?? ''
  return line.length > 160 ? `${line.slice(0, 157)}…` : line
}

function tail(text: string): string {
  const max = 4_000
  if (text.length <= max) return text
  return text.slice(text.length - max)
}

function stepTitle(name: string, args: Record<string, unknown>): string {
  const path = stringArg(args, 'path')
  const query = stringArg(args, 'query')
  const command = stringArg(args, 'command')
  if (name === 'read_file') return `Read ${path || 'file'}`
  if (name === 'list_dir') return `List ${path || '.'}`
  if (name === 'search_project') return `Search ${query || 'project'}`
  if (name === 'propose_edit') return `Edit ${path || 'file'}`
  if (name === 'run_command') return `Run ${command || 'command'}`
  if (name === 'finish') return 'Finish'
  return name
}

function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(',')}}`
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const error = new Error('aborted')
    error.name = 'AbortError'
    throw error
  }
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

export function nativeToolsRejected(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error)
  if (/HTTP 400/.test(msg) && /tool/i.test(msg)) return true
  if (/does not support tools/i.test(msg)) return true
  if (/unknown field.*tool/i.test(msg)) return true
  return false
}
