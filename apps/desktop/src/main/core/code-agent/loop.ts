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
import { applyPlannedEdit, applyUnifiedDiff, planEdits } from './edit.js'
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
  // A call that ended in an error will end in the same error with the same arguments. Reading the
  // file and sending the old text again is how a 2B spends its last steps, so the repeat is
  // answered from the record instead of run.
  const failed = new Map<string, string>()
  // File contents the check has already seen fail, so a fix that only walks back to one of them is
  // not a fix. Two failures that answer each other are how a small model swings between them.
  const rejected = new Map<string, string>()
  // What the last failed check requires of a file. A fix turn that takes the required line away is
  // a way out of the error, not out of the failure, and it costs the turn the fix needed.
  const needs: Need[] = []
  // A compile's answer, held against the file the check spoke about, so a step that moves something
  // else does not pay for the typecheck again.
  const compileNotes = new Map<string, string>()
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
      const advice = await repeatAdvice(host, parsed.call.name, parsed.call.arguments, compileNotes, targets)
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
    const tried = failed.get(sig)
    if (tried) {
      const id = `step-${++seq}`
      const message = `the same ${parsed.call.name} already failed: ${tried}`
      pushStep(host, steps, { id, index: steps.length + 1, tool: parsed.call.name, status: 'error', title: stepTitle(parsed.call.name, parsed.call.arguments), detail: message })
      messages.push({ role: 'assistant', content: JSON.stringify({ tool: parsed.call.name, arguments: parsed.call.arguments }) })
      messages.push({ role: 'user', content: `Result:\nerror: ${message}` })
      continue
    }
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
        // The check that refused the finish is the failure every next step has to answer: kept with
        // the compile notes, a repeated edit is answered with it instead of with silence.
        compileNotes.set(`${PENDING}check`, failureDigest(failure))
        needs.length = 0
        needs.push(...checkNeeds(host, failure, targets))
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
    const observation = await act(host, mode, allowed, allowlist, session, id, title, parsed.call.name, parsed.call.arguments, steps, diffs, () => `diff-${++seq}`, { targets, fixing: fixTurns > 0, rejected, needs, notes: compileNotes })
    if (observation.startsWith('error: ')) failed.set(sig, observation.slice('error: '.length))
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
  scope: { targets: readonly string[]; fixing: boolean; rejected: Map<string, string>; needs: Need[]; notes: Map<string, string> },
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
    const batch = planEdits(host.root, args)
    if ('error' in batch) {
      // When a failed edit is refused but a check failure is still pending, the hint is the answer
      // to the question the model has not asked yet: what the actual fix is.
      const pending = [...scope.notes.entries()].filter(([key]) => key.startsWith(PENDING)).pop()
      const detail = pending ? `${batch.error}\n\n${pending[1]}` : batch.error
      pushStep(host, steps, { id, index, tool: name, status: 'error', title, detail })
      return `error: ${detail}`
    }
    // Every half is judged before a line of any half is written: a batch that would touch a file
    // the request did not name, or walk back into text the check has already rejected, is refused
    // whole, not taken apart mid-apply.
    for (const planned of batch.edits) {
      // Once a check has failed, the check is the judge: a run that edits something else - the test
      // file it is failing, a neighbour it was not asked about - can make the failure go away without
      // doing the task. The fix belongs in the files the request named.
      if (scope.fixing && scope.targets.length && !scope.targets.includes(normPath(planned.path))) {
        const message = `${planned.path} is not what the request asked to change (${scope.targets.join(', ')}). The check decides when the work is done, so change the requested files instead.`
        pushStep(host, steps, { id, index, tool: name, status: 'error', title, detail: message })
        return `error: ${message}`
      }
      // The text this diff would write is knowable before it is written, so a state the check has
      // already rejected, and a fix that leaves out what the check asked for, can be refused here.
      const wanted = scope.needs.filter((need) => need.path === normPath(planned.path))
      if (scope.rejected.size || wanted.length) {
        const current = existsSync(planned.abs) ? readFileSync(planned.abs, 'utf8') : ''
        const next = applyUnifiedDiff(current, planned.diff, planned.path)
        const written = next.ok ? next.text : null
        const before = written === null ? undefined : scope.rejected.get(`${normPath(planned.path)}\n${written}`)
        if (before) {
          const message = `${planned.path} would go back to text that already failed the check there: ${before}. Change something the check has not seen.`
          pushStep(host, steps, { id, index, tool: name, status: 'error', title, detail: message })
          return `error: ${message}`
        }
        if (written !== null) {
          const unmet = wanted.find((need) => !need.holds(written))
          if (unmet) {
            const message = `${planned.path} still does not do what the failed check asked: ${unmet.ask}`
            pushStep(host, steps, { id, index, tool: name, status: 'error', title, detail: message })
            return `error: ${message}`
          }
          // Spliced, not replaced: the array belongs to the run, and the next step reads it.
          for (let at = scope.needs.length - 1; at >= 0; at--) {
            const need = scope.needs[at]!
            if (need.path === normPath(planned.path) && need.holds(written)) scope.needs.splice(at, 1)
          }
        }
      }
    }
    const appliedPaths: string[] = []
    for (const planned of batch.edits) {
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
      appliedPaths.push(planned.path)
    }
    pushStep(host, steps, { id, index, tool: name, status: 'applied', title, detail: appliedPaths.join(', ') })
    // The model sees the whole file it just changed, anything its own diff left behind, and - while
    // the edit is still fresh - whether the project still compiles. For a split diff the compile
    // answers for the whole batch, because it reads the project, not one file.
    const last = batch.edits[batch.edits.length - 1]!
    const observation = await editedObservation(host, last.path, last.diff, diffs, scope.notes, scope.targets)
    const heads = batch.edits.length > 1 ? `Applied the diff to ${batch.edits.slice(0, -1).map((edit) => edit.path).join(', ')} as well.\n\n` : ''
    const skipped = batch.skipped.length ? `\n\nNot applied: ${batch.skipped.map((item) => `${item.path}: ${item.error}`).join('. ')}` : ''
    return `${heads}${observation}${skipped}`
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

/** One file's obligation from the last failed check, testable against the text an edit would write. */
interface Need {
  path: string
  holds: (text: string) => boolean
  ask: string
}

/**
 * What "Cannot find name X" asks of the file it names: the import when someone else has X, the
 * declaration when nobody has it. The same reading the fix prompt gives the model, kept as a test
 * the next edit can be held to.
 */
function checkNeeds(host: CodeAgentHost, failure: string, targets: readonly string[]): Need[] {
  const out: Need[] = []
  for (const match of failure.matchAll(/^(.+?)\((\d+),\d+\): error TS(?:2304|2552): Cannot find name '([A-Za-z_$][\w$]*)'/gm)) {
    const file = projectPath(host.root, match[1]!.trim()) ?? normPath(match[1]!.trim())
    const name = match[3]!
    if (!targets.includes(file) || out.some((need) => need.path === file && need.ask.includes(name))) continue
    const from = exporterOf(host, name, file, targets)
    out.push(from
      ? { path: file, holds: (text) => importsName(text, name), ask: `${file} has to import ${name} from ${from}` }
      : { path: file, holds: (text) => declaresName(text, name), ask: `${file} has to define ${name} itself` })
  }
  return out
}

const DECLARERS = new Set(['const', 'let', 'var', 'function', 'class', 'interface', 'type', 'enum'])

/** The words of a line, so a name is matched as a name and not as part of a longer one. */
function wordsOf(line: string): string[] {
  return line.split(/[^A-Za-z0-9_$]+/)
}

function importsName(text: string, name: string): boolean {
  return text.split('\n').some((line) => {
    const at = line.indexOf('import')
    if (at < 0) return false
    const from = line.indexOf(' from ', at)
    return wordsOf(line.slice(at, from > at ? from : line.length)).includes(name)
  })
}

function declaresName(text: string, name: string): boolean {
  return text.split('\n').some((line) => {
    const parts = wordsOf(line.replace(/^\s*export\s+/, ''))
    const at = parts.findIndex((part) => DECLARERS.has(part))
    return at >= 0 && parts[at + 1] === name
  })
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
  // "Cannot redeclare" is the sound of a model that exported a name by writing a second line with
  // the same name on it. The move is one line that declares and exports, not a third declaration.
  for (const match of failure.matchAll(/^(.+?)\((\d+),\d+\): error TS2451: Cannot redeclare (?:block-scoped variable|a variable of name) '([A-Za-z_$][\w$]*)'/gm)) {
    const file = normPath(match[1]!.trim())
    const name = match[3]!
    if (seen.has(`${file}:${name}:redeclare`)) continue
    seen.add(`${file}:${name}:redeclare`)
    hints.push(`${name} is declared twice in ${file}. Delete one of the two lines and make the other do both jobs, like: export const ${name} = <the value>`)
  }
  // TS2322 with a nullable source: widening the receiving type makes the compiler quiet but moves
  // the null to whoever reads the value next, and the failing check that follows says nothing about
  // where it came from. The default belongs on the line the compiler named.
  for (const match of failure.matchAll(/^(.+?)\((\d+),\d+\): error TS2322: Type '([^']*)' is not assignable to type '([^']*)'/gm)) {
    const file = normPath(match[1]!.trim())
    const line = Number(match[2])
    const source = match[3]!
    const nullish = /\b(null|undefined)\b/.exec(source)
    if (!nullish || new RegExp(`\\b${nullish[1]}\\b`).test(match[4]!)) continue
    if (seen.has(`${file}:nullable:${line}`)) continue
    seen.add(`${file}:nullable:${line}`)
    hints.push(`${file} line ${line}: the value there can be ${nullish[1]}, but ${match[4]} does not allow it. Answer it on this line with a default, written like: ?? <the value the task asks for>. Making the type allow ${nullish[1]} only hands the problem to whoever reads it next`)
  }
  // TS1308: the model put await in a body whose function is not async. TS1064: async is there but
  // the return type never became a Promise. Both are answered with the one line to rewrite, because
  // a 2B reads an exact line far better than it reads a grammar rule and works out the header.
  for (const match of failure.matchAll(/^(.+?)\((\d+),\d+\): error TS(1308|1064)[^\n]*/gm)) {
    const file = normPath(match[1]!.trim())
    const line = Number(match[2])
    if (seen.has(`${file}:async:${line}`)) continue
    seen.add(`${file}:async:${line}`)
    const abs = resolveInside(host.root, file)
    if (!abs || !existsSync(abs)) continue
    const lines = readFileSync(abs, 'utf8').split('\n')
    let decl = -1
    for (let i = line - 1; i >= 0; i--) {
      if (/^\s*(export\s+)?(async\s+)?function\s+/.test(lines[i] ?? '')) { decl = i; break }
    }
    if (decl < 0) continue
    const current = (lines[decl] ?? '').trim()
    const fixed = asyncForm(current)
    if (fixed === current) continue
    const why = /\basync\b/.test(current) ? 'has to return a Promise' : 'needs async'
    // Spelled as the edit itself: a 2B copies a ready diff exactly, where an old/new pair in prose
    // is one more thing it can put the wrong way round.
    hints.push(`${file} line ${decl + 1} ${why}. Send exactly this edit:\n--- a/${file}\n+++ b/${file}\n@@ -${decl + 1},1 +${decl + 1},1 @@\n-${current}\n+${fixed}`)
  }
  // An import pasted inside a function is a model that followed the import hint from memory and
  // placed it under the function line instead of above it. The file usually has it already.
  for (const match of failure.matchAll(/^(.+?)\((\d+),\d+\): error TS1232[^\n]*/gm)) {
    const file = normPath(match[1]!.trim())
    const line = Number(match[2])
    if (seen.has(`${file}:import-row:${line}`)) continue
    seen.add(`${file}:import-row:${line}`)
    const abs = resolveInside(host.root, file)
    if (!abs || !existsSync(abs)) continue
    const rows = readFileSync(abs, 'utf8').split('\n')
    const text = (rows[line - 1] ?? '').trim()
    if (!text.startsWith('import')) continue
    const twin = rows.findIndex((row, at) => at !== line - 1 && row.trim() === text)
    hints.push(twin >= 0
      ? `${file} line ${line}: an import cannot live inside a function, and the file already has it on line ${twin + 1} - delete line ${line} and change nothing else`
      : `${file} line ${line}: an import cannot live inside a function - move it above the first function in the file`)
  }
  // A void helper interpolated into a string writes the word "undefined" into the text, and a 2B
  // reads that as a string problem instead of a call placed in the wrong seat.
  if (/\bactual\b/.test(failure) && /'[^']*undefined[^']*'/.test(failure)) {
    for (const file of targets) {
      const abs = resolveInside(host.root, file)
      if (!abs || !existsSync(abs)) continue
      const lines = readFileSync(abs, 'utf8').split('\n')
      for (let i = 0; i < lines.length && hints.length < 6; i++) {
        for (const call of (lines[i] ?? '').matchAll(/\$\{\s*([A-Za-z_$][\w$]*)\s*\(/g)) {
          const name = call[1]!
          if (seen.has(`${file}:void:${name}`)) continue
          if (!returnsVoid(host, name, targets)) continue
          seen.add(`${file}:void:${name}`)
          hints.push(`${file} line ${i + 1}: ${name}() returns nothing, so inside a string it writes "undefined". Call ${name}() as its own statement on the line before the return, and leave the returned string exactly as it is`)
        }
      }
    }
  }
  return hints.join('\n')
}

/** The same declaration line with async added and a bare return type wrapped in Promise<...>. */
function asyncForm(line: string): string {
  let out = /\basync\b/.test(line) ? line : line.replace(/function\s+/, 'async function ')
  const typed = /\)\s*:\s*([^{]+?)\s*\{\s*$/.exec(out)
  if (typed && !/^Promise\b/.test(typed[1]!.trim())) {
    out = `${out.slice(0, typed.index + 1)}: Promise<${typed[1]!.trim()}> {`
  }
  return out
}

/** Whether some file in the project declares `name` as returning void. */
function returnsVoid(host: CodeAgentHost, name: string, targets: readonly string[]): boolean {
  const pool = [...new Set([...targets, ...host.facts?.files ?? []])]
  const pattern = new RegExp(`function\\s+${name.replace(/\$/g, '\\$')}\\s*\\([^)]*\\)\\s*:\\s*void\\b`)
  for (const path of pool.slice(0, 40)) {
    const abs = resolveInside(host.root, normPath(path))
    if (!abs || !existsSync(abs) || !/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(abs)) continue
    if (pattern.test(readFileSync(abs, 'utf8'))) return true
  }
  return false
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
async function repeatAdvice(host: CodeAgentHost, name: string, args: Record<string, unknown>, cache: Map<string, string>, targets: readonly string[]): Promise<{ detail: string; message: string } | null> {
  if (name === 'read_file') {
    const path = stringArg(args, 'path')
    return {
      detail: `${path || 'the file'} is already in the prompt`,
      message: `File already read above: ${path || 'the file'}. Call propose_edit now with the required change.`,
    }
  }
  // The same hunk again is a 2B answering a compile from memory. Stopping throws the run away: the
  // file as it stands now, under the failure it has to answer, is what the second send needs.
  if (name !== 'propose_edit') return null
  const path = stringArg(args, 'path') || 'the file'
  const text = readProjectFile(host.root, { path })
  if (text.startsWith('error:')) return { detail: `${path} is already in the prompt`, message: `That edit was already sent. ${path} has not changed since: write the change the failure names.` }
  const failed = [...cache.entries()].filter(([key]) => key.startsWith(PENDING)).pop()
  const lines = [`That ${path} edit was already sent and the file has not changed since.`, `${path} as it is now:`, text.trimEnd()]
  if (failed) {
    lines.push('', 'The failure it still has to answer:', failed[1])
    // The error is raw; a 2B reads the line to write better than it reads the code to deduce. A
    // stored compile note already carries its hints, so they are only added when they are missing.
    if (!failed[1].includes('What to change:')) {
      const hints = importHints(host, failed[1], targets)
      if (hints) lines.push('', 'What to change:', hints)
    }
  }
  lines.push('', 'Edit the text above, not the text you remember.')
  return { detail: `${path} was already sent; it was answered with the file`, message: await truncateToTokens(host.counter, lines.join('\n'), (host.observationTokens ?? 900) + 200) }
}

/**
 * What an applied edit left behind. The text this diff removed may still be further down the file -
 * the second of two 1024s, the old name at another call site - and the model finishes without
 * looking. Naming the token and its line is what makes it look.
 */
async function editedObservation(host: CodeAgentHost, path: string, diff: string, diffs: readonly CodeDiffView[], cache: Map<string, string>, targets: readonly string[]): Promise<string> {
  const text = readProjectFile(host.root, { path })
  if (text.startsWith('error:')) return Promise.resolve(`Applied the diff to ${path}.`)
  const body = text.split('\n').slice(1).join('\n')
  const lines = [`Applied the diff to ${path}.`, '', `${path} now reads:`, body]
  const bare = body.split('\n').map((line) => line.replace(/^\s*\d+\|/, ''))
  const left = leftover(diff, bare)
  if (left.length) {
    const named = left.map((item) => `"${item.token}" on ${item.lines.length > 1 ? `lines ${item.lines.join(', ')}` : `line ${item.lines[0]}`}`)
    lines.push('', `Still in ${path}: ${named.join(', ')}. Change ${left.length === 1 ? 'it' : 'them'} too, or the task is not done.`)
  }
  const compile = await compileNote(host, diffs, cache, targets)
  if (compile) lines.push('', compile)
  return truncateToTokens(host.counter, lines.join('\n'), host.observationTokens ?? 900)
}

/** Where a compile says the code is wrong, in the order the compiler named them. */
function errorFiles(output: string): string[] {
  return [...new Set([...output.matchAll(/^([^\s()]+\.[A-Za-z]+)\(\d+,\d+\): error TS/g)].map((match) => normPath(match[1]!)))]
}

/** The compile the run has not answered yet, under the same record as the answers. */
const PENDING = '\0pending'

/**
 * The compile check, run while the edit that may have broken it is still the freshest thing in the
 * prompt. Waiting for the finish to speak costs a 2B the link between the error and the line it
 * typed, so the same broken hunk comes back. Only a command that reads like a compile is used - a
 * full test suite does not belong on the back of every edit - and the answer is kept against the
 * files this run has touched, so it is paid for once per state, not once per step.
 */
async function compileNote(host: CodeAgentHost, diffs: readonly CodeDiffView[], cache: Map<string, string>, targets: readonly string[]): Promise<string | null> {
  const run = host.runCommand ?? ((command: string, signal?: AbortSignal) => runProjectCommand(host.root, command, signal))
  const command = verifyCommands(host).find((candidate) => /typecheck|check-types|\btsc\b|compile/.test(candidate))
  if (!command) return null
  const active = [...diffs].reverse().find((diff) => diff.status === 'applied')
  if (!active) return null
  const text = touchedText(host.root, diffs)
  if (text === null) return null
  const key = `${command}\n${text}`
  const known = cache.get(key)
  if (known !== undefined) return known || null
  let answer = ''
  try {
    const result = await run(command, host.signal)
    if (result.ok) {
      // A passing compile answers the compile's own pending note; a check failure the run is still
      // fixing stays, because a compile that passes does not mean the task is done.
      cache.delete(`${PENDING}${command}`)
      cache.set(key, '')
      return null
    }
    const digest = compileDigest(result.output)
    // The edit may be right with the file beside it still wrong. Blamed on the edit, that error sends
    // a small model to take the correct change back; named where it is, the other file is the work.
    const elsewhere = errorFiles(digest).filter((name) => name !== active.path)
    const base = elsewhere.length
      ? `The failure is in another file, not in the one you just changed (${elsewhere.join(', ')}). It stays until that file is edited too (${command}):\n${digest}`
      : `The project does not compile after this edit (${command}):\n${digest}`
    const hints = importHints(host, digest, targets)
    answer = hints ? `${base}\nWhat to change:\n${hints}` : base
    cache.delete(`${PENDING}${command}`)
    cache.set(`${PENDING}${command}`, answer)
  } catch (error) {
    if (isAbort(error) || host.signal?.aborted) throw error
    return null
  }
  cache.set(key, answer)
  return answer
}

/** Every file this run has written, as it stands. A compile reads the project, not one file. */
function touchedText(root: string, diffs: readonly CodeDiffView[]): string | null {
  const paths = [...new Set(diffs.filter((diff) => diff.status === 'applied').map((diff) => normPath(diff.path)))].sort()
  const parts: string[] = []
  for (const path of paths) {
    const abs = resolveInside(root, path)
    if (!abs || !existsSync(abs)) return null
    parts.push(`${path}\n${readFileSync(abs, 'utf8')}`)
  }
  return parts.join('\n')
}

/** The error lines of a compile - the noise around them is what crowds the one that matters out. */
function compileDigest(output: string): string {
  const lines = output.split('\n').filter((line) => /error TS\d+/.test(line))
  return (lines.length ? lines : output.split('\n').filter((line) => line.trim())).slice(0, 6).join('\n').trim()
}

/** Text the diff removed that the file still has somewhere else, with the lines it is on. */
function leftover(diff: string, body: readonly string[]): { token: string; lines: number[] }[] {
  const lines = diff.split('\n')
  const removed = lines.filter((line) => line.startsWith('-') && !line.startsWith('---')).map((line) => line.slice(1))
  const added = lines.filter((line) => line.startsWith('+') && !line.startsWith('+++')).join('\n')
  // A deletion has no other half. The words a removed line shared with the rest of the file are the
  // file's own business, and nudging about them sends the model to change lines the task left alone.
  if (!added.trim()) return []
  const out: { token: string; lines: number[] }[] = []
  for (const line of removed) {
    for (const token of new Set(line.match(/[A-Za-z_][A-Za-z0-9_]{2,}|\d+/g) ?? [])) {
      if (KEYWORDS.has(token) || out.some((item) => item.token === token)) continue
      if (new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(added)) continue
      const found = body.map((text, index) => (text.includes(token) ? index + 1 : 0)).filter(Boolean)
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
