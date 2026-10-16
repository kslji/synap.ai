/**
 * Step 4: triage, plan, validate, then run each step with a checkpoint and a failure ladder.
 * Counts, ordering, checks, and the model suggestion stay in code.
 */
import type { CodeDiffView, CodePlanView, CodeStepView } from '../../../shared/ipc-contract.js'
import type { ChatMessage } from '../llama-client.js'
import { resolveCheck, fullTestCommand } from './checks.js'
import { captureCheckpoint, extendCheckpoint, restoreCheckpoint, type Checkpoint } from './checkpoint.js'
import { runCodeAgent, type CodeAgentHost, type CompletionRequest } from './loop.js'
import { preparePatchSet, writePrepared, type SearchReplace } from './patch.js'
import { repairJson } from './parse-tool.js'
import type { ModelTurn } from './parse-tool.js'
import {
  applyPlanEdit,
  dependentSteps,
  mentionedPaths,
  patchResponseFormat,
  planResponseFormat,
  targetFiles,
  triageTask,
  validatePlan,
  type PlanFacts,
  type PlanStep,
  type TriageKind,
} from './plan.js'
import { suggestionSentence, suggestBiggerCodeModel, type CodeModelChoice, type ModelSuggestion } from './suggest-model.js'
import { runProjectCommand } from './workspace.js'

export const STEP_RETRIES = 3
export const STEP_CANDIDATES = 3

const PLAN_SYSTEM = 'You split a coding task into small steps. Reply with one JSON object {"steps":[...]} and nothing else.'
const EDIT_SYSTEM = 'You edit code with one small search/replace hunk per change. Reply with one JSON object {"edits":[{"path":"relative/path","old":"exact text","new":"replacement"}]} and nothing else. Do not rewrite a whole file.'

export interface SplitHost extends CodeAgentHost {
  facts: PlanFacts
  totalRamGb?: number
  currentModelId?: string
  catalog?: readonly CodeModelChoice[]
  reviewPlan?(steps: PlanStep[]): Promise<string[]>
  onPlan?(plan: CodePlanView): void
}

export interface StepAttempt {
  stepId: string
  tries: number
  candidates: number
  replanned: boolean
}

export interface SplitResult {
  answer: string
  kind: TriageKind
  steps: CodeStepView[]
  diffs: CodeDiffView[]
  plan: CodePlanView | null
  checkpoints: Checkpoint[]
  suggestion: ModelSuggestion | null
  stopped: 'finish' | 'cancelled' | 'failed'
  attempts: StepAttempt[]
}

interface DoneStep {
  step: PlanStep
  ok: boolean
  detail: string
  checkpoint: Checkpoint | null
}

export async function runSplitTask(
  task: string,
  host: SplitHost,
  history: { user: string; assistant: string }[] = [],
): Promise<SplitResult> {
  const kind = triageTask(task, host.facts.files)
  if (kind === 'chat') {
    const result = await runCodeAgent(task, host, history)
    return {
      answer: result.answer,
      kind,
      steps: result.steps,
      diffs: result.diffs,
      plan: null,
      checkpoints: [],
      suggestion: null,
      stopped: result.stopped === 'finish' ? 'finish' : 'failed',
      attempts: [],
    }
  }

  const planned = kind === 'edit'
    ? { ok: true as const, steps: [singleStep(task, host.facts)] }
    : await plannedSteps(task, host)
  if (!planned.ok) return empty(kind, planned.message, 'failed')
  let runnable = planned.steps
  if (kind === 'plan' && host.mode !== 'auto' && host.reviewPlan) {
    host.onPlan?.(toPlanView(runnable, 'review'))
    const order = await host.reviewPlan(runnable)
    runnable = applyPlanEdit(runnable, order)
    if (!runnable.length) return empty(kind, 'No steps left to run.', 'cancelled')
  }
  host.onPlan?.(toPlanView(runnable, 'running'))
  const executed = await executeSteps(runnable, host, kind === 'plan')
  const suite = executed.ok ? await runSuite(host) : null
  const suggestion = executed.ok ? null : suggest(host)
  const answer = summarize(executed.done, suite, suggestion, executed.attempts.some((item) => item.replanned))
  const plan = toPlanView(executed.done.map((item) => item.step), 'done', executed.done.filter((item) => item.checkpoint).map((item) => ({
    stepId: item.step.id,
    title: item.step.goal,
  })))
  host.onPlan?.(plan)
  return {
    answer,
    kind,
    steps: executed.views,
    diffs: executed.diffs,
    plan,
    checkpoints: executed.done.flatMap((item) => item.checkpoint ? [item.checkpoint] : []),
    suggestion,
    stopped: executed.ok ? 'finish' : 'failed',
    attempts: executed.attempts,
  }
}

export async function executeSteps(steps: PlanStep[], host: SplitHost, allowReplan: boolean): Promise<{
  ok: boolean
  done: DoneStep[]
  views: CodeStepView[]
  diffs: CodeDiffView[]
  attempts: StepAttempt[]
}> {
  let pending = [...steps]
  const done: DoneStep[] = []
  const views: CodeStepView[] = []
  const diffs: CodeDiffView[] = []
  const attempts: StepAttempt[] = []
  const fromReplan = new Set<string>()
  let replans = 0
  let index = 0
  while (index < pending.length) {
    throwIfAborted(host.signal)
    const step = pending[index]!
    const outcome = await runLadder(step, host, views, diffs)
    attempts.push({
      stepId: step.id,
      tries: outcome.tries,
      candidates: outcome.candidates,
      replanned: false,
    })
    if (outcome.ok) {
      done.push({ step, ok: true, detail: outcome.detail, checkpoint: outcome.checkpoint })
      index += 1
      continue
    }
    const canReplan = allowReplan && !fromReplan.has(step.id) && replans < 3
    if (canReplan) {
      replans += 1
      const group = dependentSteps(pending, step.id, host.facts)
      const replacement = await replan(taskOf(step, group, outcome.detail), group, host)
      if (replacement) {
        const drop = new Set(group.map((item) => item.id))
        const before = pending.slice(0, index)
        const after = pending.slice(index).filter((item) => !drop.has(item.id))
        for (const item of replacement) fromReplan.add(item.id)
        pending = [...before, ...replacement, ...after]
        const log = attempts[attempts.length - 1]
        if (log) log.replanned = true
        continue
      }
    }
    done.push({ step, ok: false, detail: outcome.detail, checkpoint: outcome.checkpoint })
    return { ok: false, done, views, diffs, attempts }
  }
  return { ok: true, done, views, diffs, attempts }
}

async function plannedSteps(task: string, host: SplitHost): Promise<{ ok: true; steps: PlanStep[] } | { ok: false; message: string }> {
  let feedback = ''
  for (let attempt = 1; attempt <= 3; attempt++) {
    throwIfAborted(host.signal)
    const turn = await host.complete({
      messages: [
        { role: 'system', content: PLAN_SYSTEM },
        { role: 'user', content: planPrompt(task, host, feedback, attempt) },
      ],
      responseFormat: planResponseFormat(),
      thinking: true,
      maxTokens: host.answerTokens,
      signal: host.signal,
    })
    const validated = validatePlan(readJson(turn), host.facts)
    if (validated.ok) return validated
    feedback = validated.message
  }
  return { ok: false, message: feedback || 'I could not make a valid checklist for that task.' }
}

async function replan(note: string, _group: PlanStep[], host: SplitHost): Promise<PlanStep[] | null> {
  let feedback = ''
  for (let attempt = 1; attempt <= 2; attempt++) {
    throwIfAborted(host.signal)
    const turn = await host.complete({
      messages: [
        { role: 'system', content: PLAN_SYSTEM },
        { role: 'user', content: planPrompt(note, host, feedback, attempt).replace('Kind: plan', 'Kind: replan') },
      ],
      responseFormat: planResponseFormat(),
      thinking: true,
      maxTokens: host.answerTokens,
      signal: host.signal,
    })
    const validated = validatePlan(readJson(turn), host.facts)
    if (!validated.ok) {
      feedback = validated.message
      continue
    }
    return validated.steps
  }
  return null
}

async function runLadder(
  step: PlanStep,
  host: SplitHost,
  views: CodeStepView[],
  diffs: CodeDiffView[],
): Promise<{ ok: boolean; detail: string; checkpoint: Checkpoint | null; tries: number; candidates: number }> {
  let checkpoint = captureCheckpoint(host.root, step.id, targetFiles(step, host.facts))
  let error = ''
  for (let attempt = 1; attempt <= STEP_RETRIES; attempt++) {
    const result = await tryOnce(step, host, checkpoint, views, diffs, { attempt, candidate: 0, error, thinking: attempt > 1 })
    checkpoint = result.checkpoint
    if (result.ok) return { ok: true, detail: result.detail, checkpoint, tries: attempt, candidates: 0 }
    error = result.detail
    restoreCheckpoint(checkpoint)
  }
  for (let candidate = 1; candidate <= STEP_CANDIDATES; candidate++) {
    const result = await tryOnce(step, host, checkpoint, views, diffs, { attempt: STEP_RETRIES, candidate, error, thinking: true })
    checkpoint = result.checkpoint
    if (result.ok) return { ok: true, detail: result.detail, checkpoint, tries: STEP_RETRIES, candidates: candidate }
    error = result.detail
    restoreCheckpoint(checkpoint)
  }
  return { ok: false, detail: error, checkpoint, tries: STEP_RETRIES, candidates: STEP_CANDIDATES }
}

async function tryOnce(
  step: PlanStep,
  host: SplitHost,
  checkpoint: Checkpoint,
  views: CodeStepView[],
  diffs: CodeDiffView[],
  pass: { attempt: number; candidate: number; error: string; thinking: boolean },
): Promise<{ ok: boolean; detail: string; checkpoint: Checkpoint }> {
  throwIfAborted(host.signal)
  const editId = `${step.id}:edit`
  pushView(host, views, { id: editId, index: views.length + 1, tool: 'edit', status: 'running', title: step.goal, detail: pass.candidate ? `Candidate ${pass.candidate}` : `Attempt ${pass.attempt}` })
  const pack = await host.search.context(step.goal, { tokenBudget: host.searchBudget })
  const turn = await host.complete({
    messages: [
      { role: 'system', content: EDIT_SYSTEM },
      { role: 'user', content: editPrompt(step, packText(pack), pass) },
    ],
    responseFormat: patchResponseFormat(),
    thinking: pass.thinking,
    maxTokens: host.answerTokens,
    signal: host.signal,
  })
  const edits = readEdits(turn)
  if ('error' in edits) {
    pushView(host, views, { id: editId, index: viewIndex(views, editId), tool: 'edit', status: 'error', title: step.goal, detail: edits.error })
    return { ok: false, detail: edits.error, checkpoint }
  }
  const targets = targetFiles(step, host.facts)
  const prepared = preparePatchSet(host.root, edits.edits, {
    allowCreate: step.create || targets.length === 0,
    allowedPaths: targets.length ? targets : null,
  })
  if (!prepared.ok) {
    pushView(host, views, { id: editId, index: viewIndex(views, editId), tool: 'edit', status: 'error', title: step.goal, detail: prepared.message })
    return { ok: false, detail: prepared.message, checkpoint }
  }
  const next = extendCheckpoint(checkpoint, prepared.files.map((file) => file.path))
  writePrepared(prepared.files)
  for (const file of prepared.files) {
    const diff: CodeDiffView = { id: `${step.id}:${file.path}`, stepId: step.id, path: file.path, diff: file.diff, status: 'applied' }
    host.onDiff?.(diff)
    const at = diffs.findIndex((item) => item.id === diff.id)
    if (at >= 0) diffs[at] = diff
    else diffs.push(diff)
  }
  pushView(host, views, { id: editId, index: viewIndex(views, editId), tool: 'edit', status: 'applied', title: step.goal, detail: prepared.files.map((file) => file.path).join(', ') })
  const check = await runCheck(host, step)
  const checkId = `${step.id}:check`
  pushView(host, views, {
    id: checkId,
    index: views.some((item) => item.id === checkId) ? viewIndex(views, checkId) : views.length + 1,
    tool: 'check',
    status: check.ok ? 'ok' : 'error',
    title: `Check ${step.check.kind}`,
    detail: oneLine(check.output),
  })
  if (!check.ok) return { ok: false, detail: check.output, checkpoint: next }
  return { ok: true, detail: check.output, checkpoint: next }
}

async function runCheck(host: SplitHost, step: PlanStep): Promise<{ ok: boolean; output: string }> {
  const resolved = resolveCheck(host.root, step.check)
  if (!resolved.command) return { ok: true, output: `No ${step.check.kind} command in this project.` }
  const run = host.runCommand ?? ((command, signal) => runProjectCommand(host.root, command, signal))
  try {
    return await run(resolved.command, host.signal)
  } catch (error) {
    return { ok: false, output: error instanceof Error ? error.message : String(error) }
  }
}

async function runSuite(host: SplitHost): Promise<{ command: string; ok: boolean; output: string } | null> {
  const command = fullTestCommand(host.root)
  if (!command) return null
  const run = host.runCommand ?? ((cmd, signal) => runProjectCommand(host.root, cmd, signal))
  try {
    const result = await run(command, host.signal)
    return { command, ok: result.ok, output: result.output }
  } catch (error) {
    return { command, ok: false, output: error instanceof Error ? error.message : String(error) }
  }
}

function suggest(host: SplitHost): ModelSuggestion | null {
  if (!host.catalog || host.currentModelId == null || host.totalRamGb == null) return null
  return suggestBiggerCodeModel(host.currentModelId, host.totalRamGb, host.catalog)
}

export function summarize(
  done: DoneStep[],
  suite: { command: string; ok: boolean; output: string } | null,
  suggestion: ModelSuggestion | null,
  replanned = false,
): string {
  const lines = done.map((item, index) => {
    const files = item.step.files.length ? item.step.files.join(', ') : 'no file list'
    const state = item.ok ? 'passed' : 'failed'
    return `${index + 1}. ${item.step.goal} (${files}) — check ${state}. Undo restores the files from before this step.`
  })
  if (suite) {
    lines.push(suite.ok ? `Full test suite passed (${suite.command}).` : `Full test suite failed (${suite.command}).\n${exactError(suite.output)}`)
  } else if (done.every((item) => item.ok)) {
    lines.push('No full test command was found.')
  }
  const failed = done.filter((item) => !item.ok)
  if (failed.length) {
    lines.push(replanned
      ? 'The step still failed after 3 retries, alternate patches, and a replan of that step and its dependents.'
      : 'The step still failed after 3 retries and alternate patches.')
    lines.push(exactError(failed[failed.length - 1]?.detail ?? ''))
  }
  if (suggestion) lines.push(suggestionSentence(suggestion))
  if (!lines.length) return 'Nothing was changed.'
  return lines.join('\n')
}

function singleStep(task: string, facts: PlanFacts): PlanStep {
  const files = mentionedPaths(task, facts.files).slice(0, 1)
  const kind = /\blint\b/i.test(task) ? 'lint' : /\btest\b/i.test(task) ? 'test' : 'typecheck'
  return {
    id: 'edit',
    goal: task.trim(),
    files,
    symbols: [],
    depends_on: [],
    check: { kind, command: '' },
    create: /\b(new file|create file|add a file|add file)\b/i.test(task),
  }
}

function planPrompt(task: string, host: SplitHost, feedback: string, attempt: number): string {
  const files = host.facts.files.slice(0, 40)
  const more = host.facts.files.length - files.length
  const symbols = host.facts.symbols.slice(0, 30).map((symbol) => `${symbol.name} ${symbol.path}`)
  return [
    'Kind: plan',
    `Attempt: ${attempt}`,
    'Each step needs id, goal, files, symbols, depends_on, check, and create.',
    'check.kind is test, typecheck, or lint. check.command is the project command for that kind.',
    'Set create to true only when the step adds a file that is not in the index.',
    files.length ? `Indexed files:\n${files.join('\n')}${more > 0 ? `\n… ${more} more files` : ''}` : 'No indexed files.',
    symbols.length ? `Indexed symbols:\n${symbols.join('\n')}` : '',
    feedback ? `The previous checklist was rejected:\n${feedback}` : '',
    `Task:\n${task}`,
  ].filter(Boolean).join('\n\n')
}

function editPrompt(step: PlanStep, context: string, pass: { attempt: number; candidate: number; error: string }): string {
  const files = step.files.length ? step.files.join(', ') : 'choose the file from the context'
  return [
    'Kind: edit',
    `Attempt: ${pass.attempt}`,
    pass.candidate ? `Candidate: ${pass.candidate} of ${STEP_CANDIDATES}` : 'Candidate: 0',
    `Goal: ${step.goal}`,
    `Target files: ${files}`,
    step.symbols.length ? `Symbols: ${step.symbols.join(', ')}` : '',
    `Context:\n${context}`,
    pass.error ? `The previous edit failed. Exact output:\n${exactError(pass.error)}` : '',
    'Return search/replace edits only.',
  ].filter(Boolean).join('\n\n')
}

function packText(pack: { snippets: { path: string; startLine: number; endLine: number; symbol: string | null; text: string }[] }): string {
  if (!pack.snippets.length) return 'No snippets.'
  return pack.snippets.map((snippet) => `--- ${snippet.path}:${snippet.startLine}-${snippet.endLine} ${snippet.symbol ?? ''}\n${snippet.text}`).join('\n\n')
}

function taskOf(step: PlanStep, group: PlanStep[], error: string): string {
  const ids = group.map((item) => item.id).join(', ')
  return [
    `Step ${step.id} failed. Replan only that step and its dependents (${ids}).`,
    `Goal: ${step.goal}`,
    `Exact output:\n${exactError(error)}`,
  ].join('\n')
}

function readJson(turn: ModelTurn): unknown {
  try {
    return repairJson(turn.content ?? '')
  } catch {
    return null
  }
}

function readEdits(turn: ModelTurn): { edits: SearchReplace[] } | { error: string } {
  const raw = readJson(turn)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'the model reply was not a patch' }
  const edits = (raw as { edits?: unknown }).edits
  if (!Array.isArray(edits) || !edits.length) return { error: 'the model did not propose an edit' }
  const out: SearchReplace[] = []
  for (const item of edits) {
    if (!item || typeof item !== 'object') return { error: 'an edit was not an object' }
    const row = item as Record<string, unknown>
    if (typeof row.path !== 'string' || typeof row.old !== 'string' || typeof row.new !== 'string') {
      return { error: 'an edit needs path, old, and new strings' }
    }
    out.push({ path: row.path, old: row.old, new: row.new })
  }
  return { edits: out }
}

function exactError(output: string): string {
  const cap = 12_000
  if (output.length <= cap) return output
  return output.slice(output.length - cap)
}

function toPlanView(steps: PlanStep[], status: CodePlanView['status'], undos?: { stepId: string; title: string }[]): CodePlanView {
  return {
    status,
    undos,
    steps: steps.map((step, index) => ({
      id: step.id,
      index: index + 1,
      goal: step.goal,
      files: [...step.files],
      symbols: [...step.symbols],
      dependsOn: [...step.depends_on],
      check: `${step.check.kind}: ${step.check.command}`.trim(),
      create: step.create,
    })),
  }
}

function pushView(host: SplitHost, views: CodeStepView[], step: CodeStepView): void {
  const at = views.findIndex((item) => item.id === step.id)
  if (at >= 0) views[at] = step
  else views.push(step)
  host.onStep?.(step)
}

function viewIndex(views: CodeStepView[], id: string): number {
  return views.find((item) => item.id === id)?.index ?? views.length
}

function oneLine(text: string): string {
  const line = text.split('\n').map((item) => item.trim()).find(Boolean) ?? ''
  return line.length > 160 ? `${line.slice(0, 157)}…` : line
}

function empty(kind: TriageKind, answer: string, stopped: SplitResult['stopped']): SplitResult {
  return { answer, kind, steps: [], diffs: [], plan: null, checkpoints: [], suggestion: null, stopped, attempts: [] }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const error = new Error('aborted')
    error.name = 'AbortError'
    throw error
  }
}

export type { CompletionRequest, ChatMessage }
