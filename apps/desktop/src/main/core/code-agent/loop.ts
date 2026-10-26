/**
 * Code agent loop: plan, act, observe, repeat.
 * Ask mode waits on edits and on commands that were not allowed before.
 * Auto writes inside the project and runs the allowlist. Other commands pause.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CodeDiffView, CodeStepView } from '../../../shared/ipc-contract.js'
import type { ChatMessage } from '../llama-client.js'
import { truncateToTokens, type TokenCounter } from '../token-budget.js'
import { fitAgentMessages } from './budget.js'
import { detectCheck, fullTestCommand } from './checks.js'
import { applyPlannedEdit, applyUnifiedDiff, planEdit } from './edit.js'
import { toolCallGbnf, toolCallJsonSchema } from './grammar.js'
import { parseModelTurn, type ModelTurn } from './parse-tool.js'
import { decideApproval, exactCommand, type ApprovalContext, type PermissionMode } from './permission.js'
import type { ProjectSearch } from './project-search.js'
import { normPath, requestedPaths, type PlanFacts } from './plan.js'
import { resolveInside } from './paths.js'
import { codeSystemPrompt } from './system-rules.js'
import { takeOutputUpdate } from '../../../shared/stream-batch.js'
import { thinkingFor } from '../thinking.js'
import { codeToolSchemas } from './tools.js'
import { listProjectDir, readProjectFile, runProjectCommand, splitCommand } from './workspace.js'
import type { CompletionRequest } from '@surf/agent-core'

// The completion request is the shared @surf/agent-core provider contract.
export type { CompletionRequest } from '@surf/agent-core'

export interface CodeAgentLimits {
  maxSteps: number
  maxParseRetries: number
  maxSameCall: number
  /** Extra turns after a failed check: read the diagnostic, edit, look, and try again. */
  maxFixTurns: number
}

export const CODE_AGENT_LIMITS: CodeAgentLimits = {
  maxSteps: 8,
  maxParseRetries: 2,
  maxSameCall: 2,
  maxFixTurns: 3,
}

/** How many of the files a request names are quoted in the first prompt, and the next one. */
const CONTEXT_FILES = 4

/** Words that carry no information about what the edit changed, so a leftover hint skips them. */
const KEYWORDS = new Set([
  'const', 'return', 'export', 'function', 'import', 'from', 'let', 'var', 'if', 'else',
  'async', 'await', 'type', 'interface', 'void', 'new', 'true', 'false', 'null', 'undefined',
  'number', 'string', 'boolean', 'public', 'private', 'class', 'extends', 'implements', 'default',
  'this', 'that', 'with', 'then', 'for', 'while', 'throw', 'try', 'catch',
])

export interface CodeAgentHost {
  complete(req: CompletionRequest): Promise<ModelTurn>
  search: ProjectSearch
  root: string
  rules: string
  counter: TokenCounter
  promptBudget: number
  searchBudget: number
  answerTokens: number
  /** The project's files and symbols, when the caller has them: a finish is checked against them. */
  facts?: PlanFacts
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
  /**
   * The commands that decide whether the work is right, run before a finish is accepted. Defaults
   * to whatever `checks.ts` detects in the folder; pass an empty list to verify nothing.
   */
  verify?: readonly string[]
}

export type CommandRunner = NonNullable<CodeAgentHost['runCommand']>

export interface CodeAgentResult {
  answer: string
  steps: CodeStepView[]
  diffs: CodeDiffView[]
  stopped: 'finish' | 'limit' | 'repeat' | 'parse'
}

const REMINDER = 'The last reply was not a tool call. Reply with one JSON object {"tool":"<name>","arguments":{...}} and nothing else.'

type Constraint = 'native' | 'json_schema' | 'gbnf'

interface CallOptions {
  /** A fix turn thinks once: the failure has to be read before the next edit is guessed. */
  thinking: boolean
  /** A repeated read leaves no choice: the next reply has to be an edit. */
  forceTool: string | null
}

export async function runCodeAgent(task: string, host: CodeAgentHost, history: { user: string; assistant: string }[] = []): Promise<CodeAgentResult> {
  const limits = { ...CODE_AGENT_LIMITS, ...host.limits }
  const mode = host.mode ?? 'ask'
  const allowed = new Set([...host.allowedCommands ?? []].map(exactCommand))
  const allowlist = new Set([...host.commandAllowlist ?? []].map(exactCommand))
  const session = { acceptAll: false }
  const steps: CodeStepView[] = []
  const diffs: CodeDiffView[] = []
  const seen = new Map<string, number>()
  // File contents the check has already seen fail, so a fix that only walks back to one of them is
  // not a fix. Two failures that answer each other are how a small model swings between them.
  const rejected = new Map<string, string>()
  const targets = requestedPaths(task, host.facts?.files ?? [])
  let finishRefusals = 0
  let fixTurns = 0
  let thinking = false
  let forceTool: string | null = null
  let lastSig = ''
  let seq = 0
  const messages: ChatMessage[] = [
    { role: 'system', content: codeSystemPrompt(host.rules) },
  ]
  for (const turn of history.slice(-4)) {
    messages.push({ role: 'user', content: turn.user })
    messages.push({ role: 'assistant', content: turn.assistant })
  }
  // The files the request names, exactly as they are. A 2B that has to read first spends a step on
  // it and often guesses a neighbouring line when it edits from memory; quoting the file is cheaper
  // than either, and a file that is not there yet is marked so it gets created.
  messages.push({ role: 'user', content: await taskWithContext(task, host, targets) })

  // A fix turn is the only turn that extends the budget: nothing else earns extra steps.
  let allowedTurns = limits.maxSteps
  for (let n = 0; n < allowedTurns; n++) {
    throwIfAborted(host.signal)
    const parsed = await obtainCall(host, messages, limits.maxParseRetries, { thinking, forceTool })
    thinking = false
    forceTool = null
    if (!parsed) {
      return { answer: 'I could not read a tool call from the model.', steps, diffs, stopped: 'parse' }
    }
    const sig = `${parsed.call.name}\0${stable(parsed.call.arguments)}`
    const times = (seen.get(sig) ?? 0) + 1
    seen.set(sig, times)
    if (sig === lastSig || times > limits.maxSameCall) {
      const advice = repeatAdvice(parsed.call.name, parsed.call.arguments)
      if (!advice) {
        return { answer: 'Stopped because that step repeated.', steps, diffs, stopped: 'repeat' }
      }
      // Reading a file that is already in the prompt is the 2B's way of stalling. Answering with
      // the edit request keeps the run alive; a second identical read is not a step, it is a pause.
      const id = `step-${++seq}`
      pushStep(host, steps, { id, index: steps.length + 1, tool: parsed.call.name, status: 'ok', title: stepTitle(parsed.call.name, parsed.call.arguments), detail: advice.detail })
      messages.push({ role: 'assistant', content: JSON.stringify({ tool: parsed.call.name, arguments: parsed.call.arguments }) })
      messages.push({ role: 'user', content: advice.message })
      lastSig = ''
      forceTool = 'propose_edit'
      continue
    }
    lastSig = sig
    const id = `step-${++seq}`
    const title = stepTitle(parsed.call.name, parsed.call.arguments)
    if (parsed.call.name === 'finish') {
      const summary = stringArg(parsed.call.arguments, 'summary') || 'Done.'
      // Two refusals are enough: a model that will not move on is better reported than looped.
      const problem = finishRefusals < 2 ? finishProblem(host, diffs, targets) : null
      if (problem) {
        finishRefusals += 1
        seen.delete(sig)
        pushStep(host, steps, { id, index: steps.length + 1, tool: 'finish', status: 'error', title, detail: problem })
        messages.push({ role: 'assistant', content: JSON.stringify({ tool: 'finish', arguments: parsed.call.arguments }) })
        messages.push({ role: 'user', content: `Not finished: ${problem}` })
        // The same finish again is the answer the check asked for, not a repeated step.
        lastSig = ''
        continue
      }
      // A compile is not a fix. The check runs here, before the finish is accepted, and its own
      // output is the next prompt - a 2B reads a failing assertion far better than a description.
      const failure = await verifyWork(host, steps, diffs, () => `check-${++seq}`)
      if (failure && fixTurns < limits.maxFixTurns) {
        fixTurns += 1
        rememberFailures(host, targets, failure, rejected)
        allowedTurns = Math.min(limits.maxSteps + limits.maxFixTurns, allowedTurns + 1)
        thinking = fixTurns === 1
        // The check has spoken: the next move is an edit in the files the request named. A free
        // choice spends the turn reading the test it is failing or re-reading a file in the prompt.
        forceTool = targets.length ? 'propose_edit' : null
        seen.delete(sig)
        messages.push({ role: 'assistant', content: JSON.stringify({ tool: 'finish', arguments: parsed.call.arguments }) })
        messages.push({ role: 'user', content: await fixPrompt(host, failure, targets) })
        lastSig = ''
        continue
      }
      pushStep(host, steps, { id, index: steps.length + 1, tool: 'finish', status: 'ok', title, detail: summary })
      return { answer: summary, steps, diffs, stopped: 'finish' }
    }
    const observation = await act(host, mode, allowed, allowlist, session, id, title, parsed.call.name, parsed.call.arguments, steps, diffs, () => `diff-${++seq}`, { targets, fixing: fixTurns > 0, rejected })
    messages.push({ role: 'assistant', content: JSON.stringify({ tool: parsed.call.name, arguments: parsed.call.arguments }) })
    messages.push({ role: 'user', content: `Result:\n${observation}` })
  }
  return { answer: 'Stopped after the step limit.', steps, diffs, stopped: 'limit' }
}

async function obtainCall(host: CodeAgentHost, messages: ChatMessage[], maxParseRetries: number, options: CallOptions): Promise<{ call: NonNullable<ReturnType<typeof parseModelTurn>> } | null> {
  let constraint: Constraint = options.forceTool ? 'json_schema' : 'native'
  let reminder = false
  for (let attempt = 0; attempt <= maxParseRetries; attempt++) {
    throwIfAborted(host.signal)
    const fitted = await fitAgentMessages(host.counter, messages, host.promptBudget)
    const requestMessages = reminder
      ? [...fitted, { role: 'user' as const, content: REMINDER }]
      : fitted
    let turn: ModelTurn
    try {
      turn = await host.complete(requestFor(constraint, requestMessages, host, options))
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

function requestFor(constraint: Constraint, messages: ChatMessage[], host: CodeAgentHost, options: CallOptions): CompletionRequest {
  const stepKind = 'triage' as const
  // A fix turn reads a compiler or test failure, which is the one step worth thinking about.
  const thinking = options.thinking ? thinkingFor('fix') : thinkingFor('edit-step')
  const only = options.forceTool ? [options.forceTool] : undefined
  if (constraint === 'json_schema') {
    return { messages, responseFormat: toolCallJsonSchema(only), maxTokens: host.answerTokens, signal: host.signal, stepKind, thinking }
  }
  if (constraint === 'gbnf') {
    return { messages, grammar: toolCallGbnf(only), maxTokens: host.answerTokens, signal: host.signal, stepKind, thinking }
  }
  return { messages, tools: codeToolSchemas(), maxTokens: host.answerTokens, signal: host.signal, stepKind, thinking }
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
  /** The files the request named, whether a check has already failed, and what it saw fail. */
  scope: { targets: readonly string[]; fixing: boolean; rejected: Map<string, string> },
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
    // Once a check has failed, the check is the judge: a run that edits something else - the test
    // file it is failing, a neighbour it was not asked about - can make the failure go away without
    // doing the task. The fix belongs in the files the request named.
    if (scope.fixing && scope.targets.length && !scope.targets.includes(normPath(planned.path))) {
      const message = `${planned.path} is not what the request asked to change (${scope.targets.join(', ')}). The check decides when the work is done, so change the requested files instead.`
      pushStep(host, steps, { id, index, tool: name, status: 'error', title, detail: message })
      return `error: ${message}`
    }
    // The text this diff would write is knowable before it is written, so a state the check has
    // already rejected can be refused instead of spent.
    if (scope.rejected.size) {
      const current = existsSync(planned.abs) ? readFileSync(planned.abs, 'utf8') : ''
      const next = applyUnifiedDiff(current, planned.diff, planned.path)
      const before = next.ok ? scope.rejected.get(`${normPath(planned.path)}\n${next.text}`) : undefined
      if (before) {
        const message = `${planned.path} would go back to text that already failed the check there: ${before}. Change something the check has not seen.`
        pushStep(host, steps, { id, index, tool: name, status: 'error', title, detail: message })
        return `error: ${message}`
      }
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
    // The model sees the whole file it just changed, and anything its own diff left behind.
    return editedObservation(host, planned.path, planned.diff)
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

/**
 * Files the request asked for that no applied patch touched, plus any it asked for that is not on
 * disk yet. A run that changed nothing at all is a read or an answer, not a skipped edit, and a file
 * the task says to leave alone is never a target.
 */
function finishProblem(host: CodeAgentHost, diffs: CodeDiffView[], targets: readonly string[]): string | null {
  const absent = targets.filter((path) => !existsSync(join(host.root, path)))
  if (absent.length) {
    return `${absent.join(', ')} does not exist yet. Create ${absent.length === 1 ? 'it' : 'them'} with propose_edit - an empty old and the whole file as new - then call finish.`
  }
  const applied = new Set(diffs.filter((diff) => diff.status === 'applied').map((diff) => normPath(diff.path)))
  if (!applied.size) return null
  const untouched = targets.filter((path) => !applied.has(path))
  if (untouched.length) {
    return `the request names ${untouched.join(', ')} and nothing was changed there. Continue with that file, then call finish.`
  }
  return null
}

/**
 * The task, then the files it names as they are on disk. The 2B edits what it can see: a prompt
 * without the text spends a step on read_file and, when it types the file from memory, often
 * rewrites the line above the one it meant to change.
 */
function taskWithContext(task: string, host: CodeAgentHost, targets: readonly string[]): Promise<string> {
  const files = targets.slice(0, CONTEXT_FILES)
  if (!files.length) return Promise.resolve(task)
  return describeFiles(host, files, 'Those files as they are now. Edit them from this text; do not read them again:').then((block) => `${task}\n\n${block}`)
}

/** One numbered block per file, in the order the request named them. */
async function describeFiles(host: CodeAgentHost, files: readonly string[], heading: string): Promise<string> {
  const budget = Math.max(120, Math.min(600, Math.floor(host.promptBudget / Math.max(1, files.length * 2))))
  const parts: string[] = [heading]
  for (const path of files) parts.push(await describeFile(host, path, budget))
  return parts.join('\n')
}

/** One file for the prompt: its numbered contents, or the marker that says it has to be created. */
async function describeFile(host: CodeAgentHost, path: string, budget: number): Promise<string> {
  const text = readProjectFile(host.root, { path })
  if (text.startsWith('error:')) {
    return `--- ${path}\n[MISSING FILE — must be created with propose_edit: pass an empty old and the whole file as new]`
  }
  return `--- ${await truncateToTokens(host.counter, text, budget)}`
}

/** The current state of every target, for the turn after a failed check. */
async function fixPrompt(host: CodeAgentHost, failure: string, targets: readonly string[]): Promise<string> {
  const files = await describeFiles(host, targets.slice(0, CONTEXT_FILES), 'Those files as they are now:')
  // The frames are read for the line they name before they are dropped for the room they take.
  const faults = faultLines(host, failure)
  const hints = importHints(host, failure, targets)
  return [
    'Not finished: the check failed.',
    '',
    await truncateToTokens(host.counter, failureDigest(failure), 500),
    ...(faults ? ['', 'The lines it names:', faults] : []),
    ...(hints ? ['', 'What to change:', hints] : []),
    '',
    files,
    '',
    'Fix the cause with one propose_edit, then call finish.',
  ].join('\n')
}

/**
 * The import a compiler error is asking for, spelled out against the project's own files. A 2B
 * reads `import count from` past "has no default export" three times in a row; `import { count }`
 * written as the line to use is what it follows.
 */
function importHints(host: CodeAgentHost, failure: string, targets: readonly string[]): string {
  const hints: string[] = []
  const seen = new Set<string>()
  for (const match of failure.matchAll(/^(.+?)\((\d+),\d+\): error TS2613: .*Did you mean to use 'import \{ (\w+) \} from ["']([^"']+)["']'/gm)) {
    const file = normPath(match[1]!.trim())
    const row = Number(match[2])
    const name = match[3]!
    const specifier = importSpecifier(host.root, file, match[4]!)
    if (!specifier || seen.has(`${file}:${name}`)) continue
    seen.add(`${file}:${name}`)
    hints.push(`${file} line ${row} uses a default import. ${name} is a named export, so write: import { ${name} } from '${specifier}'`)
  }
  for (const match of failure.matchAll(/^(.+?)\((\d+),\d+\): error TS(?:2304|2552): Cannot find name '([A-Za-z_$][\w$]*)'/gm)) {
    const file = normPath(match[1]!.trim())
    const name = match[3]!
    if (seen.has(`${file}:${name}`)) continue
    const from = exporterOf(host, name, file, targets)
    seen.add(`${file}:${name}`)
    if (!from) {
      // Nobody exports it, so importing is not the answer and the 2B goes back to the text that
      // compiled. The one move left is to declare it where it is used.
      hints.push(`${name} is not defined anywhere here, so ${file} has to declare it itself - a line like: export const ${name} = <the value the task asks for>`)
      continue
    }
    hints.push(`${name} is exported by ${from}. Add this with the imports at the top of ${file}: import { ${name} } from '${importSpecifier(host.root, file, from)!.trim()}'`)
  }
  return hints.join('\n')
}

/** The first file that exports `name`, the request's own files first, then the rest of the project. */
function exporterOf(host: CodeAgentHost, name: string, file: string, targets: readonly string[]): string | null {
  const pool = [...new Set([...targets, ...host.facts?.files ?? []])].filter((path) => normPath(path) !== file)
  const pattern = new RegExp(`export\\s+(?:const|let|var|function|class|type|interface)\\s+${name.replace(/\$/g, '\\$')}\\b`)
  for (const path of pool.slice(0, 40)) {
    const abs = resolveInside(host.root, path)
    if (!abs || !existsSync(abs) || !/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(abs)) continue
    if (pattern.test(readFileSync(abs, 'utf8'))) return normPath(path)
  }
  return null
}

/** `./counter` for a specifier the compiler wrote as an absolute path, so a 2B can paste it. */
function importSpecifier(root: string, from: string, to: string): string | null {
  const prefix = `${root}/`
  const rel = to.startsWith(prefix) ? to.slice(prefix.length) : to.startsWith('/') ? null : to
  if (!rel) return null
  const target = rel.replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, '').split('\\').join('/')
  const both = target.split('/')
  const base = posixDirname(from).split('/').filter(Boolean)
  while (both.length && base.length && both[0] === base[0]) {
    both.shift()
    base.shift()
  }
  const parts = [...base.map(() => '..'), ...both].join('/')
  return parts.startsWith('.') ? parts : `./${parts}`
}

function posixDirname(path: string): string {
  const cut = path.lastIndexOf('/')
  return cut <= 0 ? '' : path.slice(0, cut)
}

/**
 * The lines a check points at, quoted. `src/ui.ts(8,3): error` and the numbered file next to it
 * still leave a 2B guessing which of the eight lines is the one, and a failing assertion says the
 * requirement it missed in the test's own words - so the frame inside the project is followed to its
 * line and read back. Two of the file's own characters, quoted, do not need guessing.
 */
function faultLines(host: CodeAgentHost, failure: string): string {
  const quoted: string[] = []
  const seen = new Set<string>()
  for (const match of failure.matchAll(/([^\s()"']+\.(?:ts|tsx|js|jsx|mjs|cjs))[(,:](\d+)[,:]\d+/g)) {
    const path = projectPath(host.root, match[1]!)
    const row = Number(match[2])
    if (!path || !row || seen.has(`${path}:${row}`)) continue
    seen.add(`${path}:${row}`)
    const abs = resolveInside(host.root, path)
    if (!abs || !existsSync(abs)) continue
    const text = readFileSync(abs, 'utf8').split('\n')[row - 1]
    if (text == null) continue
    quoted.push(`${path} line ${row}: ${JSON.stringify(text)}`)
  }
  return quoted.join('\n')
}

/** `/tmp/p/check.test.ts` and `./check.test.ts` are the same file to this project. */
function projectPath(root: string, raw: string): string | null {
  const path = normPath(raw.trim())
  if (!path) return null
  const prefix = `${normPath(root)}/`
  const rel = path.startsWith('/') ? (path.startsWith(prefix) ? path.slice(prefix.length) : null) : path
  return rel || null
}

/**
 * A check's output without the noise: stack frames and TAP bookkeeping crowd out the one line that
 * says what is wrong when the whole failure has to fit in a few hundred tokens.
 */
function failureDigest(output: string): string {
  const noise = (line: string): boolean => {
    const text = line.trim()
    if (!text) return false
    if (/^(at\s|TestContext|Test\.|async Test|process\.|startSubtest|node:)/.test(text)) return true
    return /^#\s*(tests|suites|pass|fail|cancelled|skipped|todo|duration_ms)\b/.test(text) || /^(stack:|code:|type:|failureType:|location:|duration_ms:|operator:|TAP version|\.\.\.|---|\d+\.\.$|ok \d+ -)/.test(text)
  }
  const kept = output.split('\n').filter((line) => !noise(line))
  return kept.length ? kept.join('\n') : output
}

/**
 * The commands that decide whether the work is right. `checks.ts` detects them so the loop agrees
 * with the checklist runner; an explicit list wins, and an empty one verifies nothing.
 */
function verifyCommands(host: CodeAgentHost): string[] {
  if (host.verify) return [...host.verify]
  const found = [detectCheck(host.root, 'typecheck'), fullTestCommand(host.root)]
  return [...new Set(found.filter((command): command is string => Boolean(command)))]
}

/**
 * Run the checks before a finish is accepted. Returns every failure's own output, which is what the
 * fix turn is given: a 2B reads `AssertionError: 1024 !== undefined` better than a description, and
 * a compile error that stops the first check must not stop the second from being reported too.
 */
async function verifyWork(host: CodeAgentHost, steps: CodeStepView[], diffs: CodeDiffView[], nextId: () => string): Promise<string | null> {
  if (!diffs.some((diff) => diff.status === 'applied')) return null
  const run: CommandRunner = host.runCommand ?? ((command, signal, hooks) => runProjectCommand(host.root, command, signal, hooks))
  const failures: string[] = []
  for (const command of verifyCommands(host)) {
    throwIfAborted(host.signal)
    const id = nextId()
    const title = `Check ${command}`
    pushStep(host, steps, { id, index: steps.length + 1, tool: 'run_command', status: 'running', title, detail: command, output: '' })
    let result: Awaited<ReturnType<CommandRunner>>
    try {
      result = await run(command, host.signal)
    } catch (error) {
      if (isAbort(error) || host.signal?.aborted) throw error
      result = { ok: false, output: error instanceof Error ? error.message : 'the check could not run' }
    }
    pushStep(host, steps, { id, index: steps.length + 1, tool: 'run_command', status: result.ok ? 'ok' : 'error', title, detail: oneLine(result.output) || (result.ok ? 'passed' : 'failed'), output: tail(result.output) })
    if (!result.ok) failures.push(`$ ${command}\n${result.output || 'the check failed with no output'}`)
  }
  return failures.length ? failures.join('\n\n') : null
}

/** The one line of a failure worth repeating when the state that produced it is named again. */
function failureLine(failure: string): string {
  const lines = failure.split('\n').filter((line) => line.trim() && !line.startsWith('$ '))
  const named = lines.find((line) => /error|Error|not ok|assert/i.test(line)) ?? lines[0] ?? ''
  return named.trim().slice(0, 160)
}

/** Every file the request named, exactly as it read when the check failed, kept against that failure. */
function rememberFailures(host: CodeAgentHost, targets: readonly string[], failure: string, rejected: Map<string, string>): void {
  const line = failureLine(failure)
  for (const path of targets) {
    const abs = resolveInside(host.root, path)
    if (!abs || !existsSync(abs)) continue
    rejected.set(`${normPath(path)}\n${readFileSync(abs, 'utf8')}`, line)
  }
}

/** A repeated read is a pause, not a step: hand back the file it already has and ask for the edit. */
function repeatAdvice(name: string, args: Record<string, unknown>): { detail: string; message: string } | null {
  if (name !== 'read_file') return null
  const path = stringArg(args, 'path')
  return {
    detail: `${path || 'the file'} is already in the prompt`,
    message: `File already read above: ${path || 'the file'}. Call propose_edit now with the required change.`,
  }
}

/**
 * What an applied edit left behind. The text this diff removed may still be further down the file -
 * the second of two 1024s, the old name at another call site - and the model finishes without
 * looking. Naming the token and its line is what makes it look.
 */
function editedObservation(host: CodeAgentHost, path: string, diff: string): Promise<string> {
  const text = readProjectFile(host.root, { path })
  if (text.startsWith('error:')) return Promise.resolve(`Applied the diff to ${path}.`)
  const body = text.split('\n').slice(1).join('\n')
  const lines = [`Applied the diff to ${path}.`, '', `${path} now reads:`, body]
  const left = leftover(diff, body)
  if (left.length) {
    const named = left.map((item) => `"${item.token}" on ${item.lines.length > 1 ? `lines ${item.lines.join(', ')}` : `line ${item.lines[0]}`}`)
    lines.push('', `Still in ${path}: ${named.join(', ')}. Change ${left.length === 1 ? 'it' : 'them'} too, or the task is not done.`)
  }
  return truncateToTokens(host.counter, lines.join('\n'), host.observationTokens ?? 900)
}

/** Text the diff removed that the file still has somewhere else, with the lines it is on. */
function leftover(diff: string, body: string): { token: string; lines: number[] }[] {
  const lines = diff.split('\n')
  const removed = lines.filter((line) => line.startsWith('-') && !line.startsWith('---')).map((line) => line.slice(1))
  const added = lines.filter((line) => line.startsWith('+') && !line.startsWith('+++')).join('\n')
  const out: { token: string; lines: number[] }[] = []
  for (const line of removed) {
    for (const token of new Set(line.match(/[A-Za-z_][A-Za-z0-9_]{2,}|\d+/g) ?? [])) {
      if (KEYWORDS.has(token) || out.some((item) => item.token === token)) continue
      if (new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(added)) continue
      const found = body.split('\n').map((text, index) => (text.includes(token) ? index + 1 : 0)).filter(Boolean)
      if (found.length) out.push({ token, lines: found })
    }
  }
  return out.slice(0, 3)
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
