/**
 * Step 4: triage, plan, validate, then run each step with a checkpoint and a failure ladder.
 * Counts, ordering, checks, and the model suggestion stay in code.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { CodeDiagnosticView, CodeDiffView, CodePlanView, CodeStepView } from '../../../shared/ipc-contract.js'
import { takeOutputUpdate } from '../../../shared/stream-batch.js'
import type { ChatMessage } from '../llama-client.js'
import { thinkingFor } from '../thinking.js'
import { commandScript, fullTestCommand, resolveCheck } from './checks.js'
import { captureCheckpoint, extendCheckpoint, restoreCheckpoint, type Checkpoint } from './checkpoint.js'
import { parseCommandDiagnostics, type Diagnostic } from './diagnostics.js'
import {
  affectedFiles,
  classifyStep,
  FIX_CONTEXT_TOKENS,
  fixPromptText,
  formatFailureReport,
  hasFailureNews,
  inScopeDiagnostics,
  judgeCheck,
  narrowCommand,
  type Classified,
} from './fix-loop.js'
import { runCodeAgent, type CodeAgentHost, type CompletionRequest } from './loop.js'
import { preparePatchSet, writePrepared, type PreparedFile, type SearchReplace } from './patch.js'
import { repairJson } from './parse-tool.js'
import type { ModelTurn } from './parse-tool.js'
import { decideApproval, exactCommand, type ApprovalContext, type PermissionMode } from './permission.js'
import {
  applyPlanEdit,
  dependentSteps,
  mentionedPaths,
  missingTargets,
  patchResponseFormat,
  planResponseFormat,
  routeTask,
  targetFiles,
  triageTask,
  validatePlan,
  type PlanFacts,
  type PlanGoalEdit,
  type PlanStep,
  type TriageKind,
} from './plan.js'
import { suggestionSentence, suggestBiggerCodeModel, type CodeModelChoice, type ModelSuggestion } from './suggest-model.js'
import { CHECK_TIMEOUT_MS, runProjectCommand, type CommandHooks } from './workspace.js'

export const STEP_RETRIES = 3
export const STEP_CANDIDATES = 3

const PLAN_SYSTEM = 'You split a coding task into small steps. Reply with one JSON object {"steps":[...]} and nothing else.'
const EDIT_SYSTEM = 'You edit code with one small search/replace hunk per change. Reply with one JSON object {"edits":[{"path":"relative/path","old":"exact text","new":"replacement"}]} and nothing else. Do not rewrite a whole file.'

export interface SplitHost extends CodeAgentHost {
  facts: PlanFacts
  totalRamGb?: number
  currentModelId?: string
  catalog?: readonly CodeModelChoice[]
  reviewPlan?(steps: PlanStep[]): Promise<string[] | { order: string[]; edits?: PlanGoalEdit[] }>
  onPlan?(plan: CodePlanView): void
  /** Short Code-pack excerpts. Not part of triage. */
  reference?: string
}

interface GateSession {
  mode: PermissionMode
  remembered: Set<string>
  allowlist: Set<string>
  checkpointPaths: Set<string>
  acceptAll: boolean
  /** Checks approved earlier in this run. A retry does not ask again. */
  approvedCommands: Set<string>
  baselines: Map<string, CheckBaseline>
  /** Files from the previous failed check, so the next attempt reruns those first. */
  focusFiles: string[]
}

interface CheckBaseline {
  recorded: boolean
  diagnostics: Diagnostic[]
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
  stopped: 'finish' | 'cancelled' | 'failed' | 'stopped'
  attempts: StepAttempt[]
}

interface DoneStep {
  step: PlanStep
  ok: boolean
  detail: string
  checkpoint: Checkpoint | null
  report: Classified | null
}

export async function runSplitTask(
  task: string,
  host: SplitHost,
  history: { user: string; assistant: string }[] = [],
): Promise<SplitResult> {
  const session = openSession(host)
  try {
    return await runSplitBody(task, host, history, session)
  } catch (error) {
    if (!isAbort(error)) throw error
    return empty('plan', 'Stopped. Finished steps can be undone one by one, or all at once.', 'stopped')
  }
}

async function runSplitBody(
  task: string,
  host: SplitHost,
  history: { user: string; assistant: string }[],
  session: GateSession,
): Promise<SplitResult> {
  const kind = triageTask(task, host.facts.files)
  const grounded = host.reference ? `${task.trim()}\n\n${host.reference}` : task
  // A task that names one file and at most two symbols is cheaper and surer in the loop: one edit
  // and one finish, instead of retries and alternate candidates. A new file, edits that have to
  // land together across two or more files, or a task that names nothing keeps the checklist.
  if (kind === 'chat' || routeTask(task, host.facts) === 'loop') {
    return await runInLoop(grounded, kind, host, history, session)
  }

  const planned = await plannedSteps(task, host)
  if (!planned.ok) {
    // A 2B that cannot write a checklist can still make the change. The run is not thrown away.
    const fallback = await runInLoop(grounded, kind, host, history, session)
    return {
      ...fallback,
      answer: [fallback.answer, `I could not split that task into steps (${oneLine(planned.message)}), so I made the change in one pass.`].join('\n\n'),
    }
  }
  let runnable = planned.steps
  if (session.mode !== 'auto' && host.reviewPlan) {
    host.onPlan?.(toPlanView(runnable, 'review'))
    const revision = revisionOf(await host.reviewPlan(runnable))
    throwIfAborted(host.signal)
    runnable = applyPlanEdit(runnable, revision.order, revision.edits)
    if (!runnable.length) return empty(kind, 'No steps left to run.', 'cancelled')
  }
  host.onPlan?.(toPlanView(runnable, 'running'))
  const executed = await executeSteps(runnable, host, kind === 'plan', session)
  if (executed.halted) {
    const plan = donePlan(executed.done)
    host.onPlan?.(plan)
    return {
      answer: executed.halted === 'stopped'
        ? 'Stopped. Finished steps can be undone one by one, or all at once.'
        : 'Stopped because a change was rejected. Finished steps can still be undone.',
      kind,
      steps: executed.views,
      diffs: executed.diffs,
      plan,
      checkpoints: checkpointsOf(executed.done),
      suggestion: null,
      stopped: executed.halted,
      attempts: executed.attempts,
    }
  }
  let done = executed.done
  let views = executed.views
  let diffs = executed.diffs
  let attempts = executed.attempts
  let ok = executed.ok
  // The skipped second file, or the new file the task asked for, is the failure a small model makes
  // most often. One continuation step names it before the run is called finished.
  const fresh = mentionedPaths(task, host.facts.files).filter((file) => !existsSync(join(host.root, file)))
  const missing = ok ? missingTargets(runnable, diffs, host.facts, fresh) : []
  if (missing.length) {
    const step = continuationStep(missing, host)
    host.onPlan?.(toPlanView([...runnable, step], 'running'))
    const more = await executeSteps([step], host, false, session)
    done = [...done, ...more.done]
    views = [...views, ...more.views]
    diffs = [...diffs, ...more.diffs]
    attempts = [...attempts, ...more.attempts]
    ok = more.ok
  }
  const suite = ok ? await runSuite(host, session, views) : null
  throwIfAborted(host.signal)
  const suggestion = ok ? null : suggest(host)
  const answer = summarize(done, suite, suggestion, attempts.some((item) => item.replanned))
  const plan = donePlan(done)
  host.onPlan?.(plan)
  return {
    answer,
    kind,
    steps: views,
    diffs,
    plan,
    checkpoints: checkpointsOf(done),
    suggestion,
    stopped: ok ? 'finish' : 'failed',
    attempts,
  }
}

/** The tool loop, and the result shape the split runner hands back for it. */
async function runInLoop(
  task: string,
  kind: TriageKind,
  host: SplitHost,
  history: { user: string; assistant: string }[],
  session: GateSession,
): Promise<SplitResult> {
  const result = await runCodeAgent(task, { ...host, mode: session.mode, commandAllowlist: session.allowlist }, history)
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

/** One step that names the files the run never wrote, so the model can finish what it started. */
function continuationStep(missing: readonly string[], host: SplitHost): PlanStep {
  const files = missing.slice(0, 4)
  const fresh = files.filter((file) => !existsSync(join(host.root, file)))
  return {
    id: 'continuation',
    goal: `The task also asked for ${files.join(', ')}, and no step changed ${files.length === 1 ? 'it' : 'them'}. Make that change now.`,
    files: [...files],
    symbols: [],
    depends_on: [],
    check: { kind: 'typecheck', command: '' },
    create: fresh.length > 0,
  }
}

export async function executeSteps(steps: PlanStep[], host: SplitHost, allowReplan: boolean, session: GateSession = openSession(host)): Promise<{
  ok: boolean
  halted: 'stopped' | 'cancelled' | null
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
  try {
  while (index < pending.length) {
    if (host.signal?.aborted) return { ok: false, halted: 'stopped', done, views, diffs, attempts }
    const step = pending[index]!
    const outcome = await runLadder(step, host, views, diffs, session)
    attempts.push({
      stepId: step.id,
      tries: outcome.tries,
      candidates: outcome.candidates,
      replanned: false,
    })
    if (outcome.halted) {
      if (outcome.checkpoint && outcome.wrote) done.push({ step, ok: false, detail: outcome.detail, checkpoint: outcome.checkpoint, report: outcome.report })
      return { ok: false, halted: outcome.halted, done, views, diffs, attempts }
    }
    if (outcome.ok) {
      done.push({ step, ok: true, detail: outcome.detail, checkpoint: outcome.checkpoint, report: outcome.report })
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
    done.push({ step, ok: false, detail: outcome.detail, checkpoint: outcome.checkpoint, report: outcome.report })
    return { ok: false, halted: null, done, views, diffs, attempts }
  }
  return { ok: true, halted: null, done, views, diffs, attempts }
  } catch (error) {
    if (!isAbort(error)) throw error
    return { ok: false, halted: 'stopped', done, views, diffs, attempts }
  }
}

async function plannedSteps(task: string, host: SplitHost): Promise<{ ok: true; steps: PlanStep[] } | { ok: false; message: string }> {
  throwIfAborted(host.signal)
  // One attempt. A rejected checklist costs a whole thinking pass - 40 to 51 s measured on the 2B -
  // and the two retries never turned a rejection into a valid plan. The caller makes the change in
  // the loop instead, which is cheaper and surer than asking a third time.
  const turn = await host.complete({
    messages: [
      { role: 'system', content: PLAN_SYSTEM },
      { role: 'user', content: planPrompt(task, host, '', 1) },
    ],
    responseFormat: planResponseFormat(),
    thinking: thinkingFor('plan'),
    stepKind: 'plan',
    maxTokens: host.answerTokens,
    signal: host.signal,
  })
  const validated = validatePlan(readJson(turn), host.facts)
  return validated.ok ? validated : { ok: false, message: validated.message }
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
      thinking: thinkingFor('plan'),
      stepKind: 'plan',
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
  session: GateSession,
): Promise<{ ok: boolean; detail: string; checkpoint: Checkpoint | null; tries: number; candidates: number; halted: 'stopped' | 'cancelled' | null; wrote: boolean; report: Classified | null }> {
  const state = {
    checkpoint: captureCheckpoint(host.root, step.id, targetFiles(step, host.facts)),
    wrote: false,
  }
  rememberCheckpoint(session, state.checkpoint)
  session.focusFiles = []
  let error = ''
  let lastReport: Classified | null = null
  const finish = (ok: boolean, detail: string, tries: number, candidates: number, halted: 'stopped' | 'cancelled' | null, wrote: boolean) => ({
    ok, detail, checkpoint: state.checkpoint, tries, candidates, halted, wrote, report: lastReport,
  })
  try {
    await ensureBaseline(resolveCheck(host.root, step.check).command, host, session, views)
    for (let attempt = 1; attempt <= STEP_RETRIES; attempt++) {
      const result = await tryOnce(step, host, state, views, diffs, session, { attempt, candidate: 0, error, thinking: attempt > 1 ? thinkingFor('fix') : thinkingFor('edit-step') })
      lastReport = result.report ?? lastReport
      if (result.halted) return finish(false, result.detail, attempt, 0, result.halted, state.wrote)
      if (result.ok) return finish(true, result.detail, attempt, 0, null, state.wrote)
      error = await rolledBackError(step, host, session, state, result)
      rememberFocus(session, result.report)
    }
    for (let candidate = 1; candidate <= STEP_CANDIDATES; candidate++) {
      const result = await tryOnce(step, host, state, views, diffs, session, { attempt: STEP_RETRIES, candidate, error, thinking: thinkingFor('fix') })
      lastReport = result.report ?? lastReport
      if (result.halted) return finish(false, result.detail, STEP_RETRIES, candidate, result.halted, state.wrote)
      if (result.ok) return finish(true, result.detail, STEP_RETRIES, candidate, null, state.wrote)
      error = await rolledBackError(step, host, session, state, result)
      rememberFocus(session, result.report)
    }
    return finish(false, error, STEP_RETRIES, STEP_CANDIDATES, null, false)
  } catch (error) {
    if (!isAbort(error)) throw error
    return finish(false, 'Stopped.', 0, 0, 'stopped', state.wrote)
  }
}

async function rolledBackError(
  step: PlanStep,
  host: SplitHost,
  session: GateSession,
  state: { checkpoint: Checkpoint; wrote: boolean },
  result: { detail: string; report: Classified | null },
): Promise<string> {
  restoreCheckpoint(state.checkpoint)
  state.wrote = false
  const report = result.report
  if (!report || (!report.introduced.length && !report.inScope.length)) return exactError(result.detail)
  const command = resolveCheck(host.root, step.check).command
  const recorded = command ? session.baselines.get(command) : undefined
  const baseline = inScopeDiagnostics(recorded?.diagnostics ?? [], step.files)
  const text = await fixPromptText(host.root, report, baseline, host.counter, FIX_CONTEXT_TOKENS)
  return text || exactError(result.detail)
}

async function tryOnce(
  step: PlanStep,
  host: SplitHost,
  state: { checkpoint: Checkpoint; wrote: boolean },
  views: CodeStepView[],
  diffs: CodeDiffView[],
  session: GateSession,
  pass: { attempt: number; candidate: number; error: string; thinking: boolean },
): Promise<{ ok: boolean; detail: string; halted: 'stopped' | 'cancelled' | null; report: Classified | null }> {
  throwIfAborted(host.signal)
  const editId = `${step.id}:edit`
  const attemptNo = pass.candidate || pass.attempt
  const attemptMax = pass.candidate ? STEP_CANDIDATES : STEP_RETRIES
  pushView(host, views, {
    id: editId,
    index: views.length + 1,
    tool: 'edit',
    status: 'running',
    title: step.goal,
    detail: pass.candidate ? `Candidate ${pass.candidate}` : `Attempt ${pass.attempt}`,
    attempt: attemptNo,
    attempts: attemptMax,
  })
  const pack = await host.search.context(step.goal, { tokenBudget: host.searchBudget })
  const turn = await host.complete({
    messages: [
      { role: 'system', content: EDIT_SYSTEM },
      { role: 'user', content: editPrompt(step, packText(pack), pass, host.reference) },
    ],
    responseFormat: patchResponseFormat(),
    thinking: pass.thinking,
    stepKind: pass.thinking ? 'hard-fix' : 'edit',
    maxTokens: host.answerTokens,
    signal: host.signal,
  })
  throwIfAborted(host.signal)
  const edits = readEdits(turn)
  if ('error' in edits) {
    pushView(host, views, { id: editId, index: viewIndex(views, editId), tool: 'edit', status: 'error', title: step.goal, detail: edits.error })
    return { ok: false, detail: edits.error, halted: null, report: null }
  }
  const targets = targetFiles(step, host.facts)
  const prepared = preparePatchSet(host.root, edits.edits, {
    allowCreate: step.create || targets.length === 0,
    allowedPaths: targets.length ? targets : null,
  })
  if (!prepared.ok) {
    pushView(host, views, { id: editId, index: viewIndex(views, editId), tool: 'edit', status: 'error', title: step.goal, detail: prepared.message })
    return { ok: false, detail: prepared.message, halted: null, report: null }
  }
  const approved: PreparedFile[] = []
  for (const file of prepared.files) {
    const diff: CodeDiffView = { id: `${step.id}:${file.path}`, stepId: step.id, path: file.path, diff: file.diff, status: 'pending' }
    const verdict = await approveEdit(host, session, views, editId, diff)
    throwIfAborted(host.signal)
    if (verdict === 'deny' || verdict === 'reject') {
      diff.status = 'rejected'
      storeDiff(host, diffs, diff)
      continue
    }
    approved.push(file)
  }
  if (!approved.length) {
    pushView(host, views, { id: editId, index: viewIndex(views, editId), tool: 'edit', status: 'rejected', title: step.goal, detail: 'Rejected' })
    return { ok: false, detail: 'The user rejected the edit. The file was not changed.', halted: 'cancelled', report: null }
  }
  state.checkpoint = extendCheckpoint(state.checkpoint, approved.map((file) => file.path))
  rememberCheckpoint(session, state.checkpoint)
  writePrepared(approved)
  state.wrote = true
  for (const file of approved) {
    storeDiff(host, diffs, { id: `${step.id}:${file.path}`, stepId: step.id, path: file.path, diff: file.diff, status: 'applied' })
  }
  pushView(host, views, {
    id: editId,
    index: viewIndex(views, editId),
    tool: 'edit',
    status: 'applied',
    title: step.goal,
    detail: approved.map((file) => file.path).join(', '),
    attempt: attemptNo,
    attempts: attemptMax,
  })
  const check = await runCheck(host, step, session, views, { attempt: attemptNo, attempts: attemptMax })
  if (check.halted) return { ok: false, detail: check.output, halted: check.halted, report: check.report }
  if (!check.ok) return { ok: false, detail: check.output, halted: null, report: check.report }
  return { ok: true, detail: check.output, halted: null, report: check.report }
}

async function runCheck(
  host: SplitHost,
  step: PlanStep,
  session: GateSession,
  views: CodeStepView[],
  attempt: { attempt: number; attempts: number },
): Promise<{ ok: boolean; output: string; halted: 'stopped' | 'cancelled' | null; report: Classified | null }> {
  const resolved = resolveCheck(host.root, step.check)
  if (!resolved.command) return { ok: true, output: `No ${step.check.kind} command in this project.`, halted: null, report: null }
  const recorded = session.baselines.get(resolved.command) ?? { recorded: false, diagnostics: [] }
  const focus = affectedFiles(host.root, [...step.files, ...session.focusFiles])
  const narrow = narrowCommand(resolved.command, focus, commandScript(host.root, resolved.command))
  const commands = narrow && narrow !== resolved.command ? [narrow, resolved.command] : [resolved.command]
  let output = ''
  let report = emptyReport()
  for (let index = 0; index < commands.length; index++) {
    const command = commands[index] ?? resolved.command
    const run = await streamCommand(host, session, views, `${step.id}:check`, `Check ${step.check.kind}`, command, resolved.command, attempt)
    if (run.halted) return { ok: false, output: run.output, halted: run.halted, report }
    output = output ? `${output}\n${run.output}` : run.output
    const parsed = run.ok ? [] : parseCommandDiagnostics(command, run.output, host.root)
    report = classifyStep(recorded.diagnostics, parsed, step.files)
    const decision = judgeCheck(report, run.ok, parsed.length)
    showCheck(host, views, `${step.id}:check`, `Check ${step.check.kind}`, decision.ok, output, report, attempt, run.note)
    const last = index === commands.length - 1
    if (!decision.ok || last) {
      return { ok: decision.ok, output, halted: null, report }
    }
  }
  return { ok: true, output, halted: null, report }
}

async function runSuite(host: SplitHost, session: GateSession, views: CodeStepView[]): Promise<{ command: string; ok: boolean; output: string; report: Classified | null } | null> {
  const command = fullTestCommand(host.root)
  if (!command) return null
  await ensureBaseline(command, host, session, views)
  const run = await streamCommand(host, session, views, 'suite', 'Full test suite', command, command)
  if (run.halted) return { command, ok: false, output: run.output, report: null }
  const recorded = session.baselines.get(command) ?? { recorded: false, diagnostics: [] }
  const parsed = run.ok ? [] : parseCommandDiagnostics(command, run.output, host.root)
  const report = classifyStep(recorded.diagnostics, parsed, ['__suite__'])
  const decision = judgeCheck(report, run.ok, parsed.length)
  showCheck(host, views, 'suite', 'Full test suite', decision.ok, run.output, report, undefined, run.note)
  return { command, ok: decision.ok, output: run.output, report }
}

async function ensureBaseline(command: string | null, host: SplitHost, session: GateSession, views: CodeStepView[]): Promise<void> {
  if (!command || session.baselines.has(command)) return
  const id = `baseline:${session.baselines.size}`
  const run = await streamCommand(host, session, views, id, 'Baseline', command, command)
  if (run.halted) {
    session.baselines.set(command, { recorded: false, diagnostics: [] })
    const existing = views.find((item) => item.id === id)
    if (existing) pushView(host, views, { ...existing, status: 'rejected', detail: run.output })
    return
  }
  const diagnostics = parseCommandDiagnostics(command, run.output, host.root)
  session.baselines.set(command, { recorded: true, diagnostics })
  const report = classifyStep(diagnostics, diagnostics, ['__suite__'])
  showCheck(host, views, id, 'Baseline', true, run.output, { ...report, fixed: [], introduced: [], inScope: [] }, undefined, run.note)
}

async function streamCommand(
  host: SplitHost,
  session: GateSession,
  views: CodeStepView[],
  id: string,
  title: string,
  command: string,
  base: string,
  attempt?: { attempt: number; attempts: number },
): Promise<{ ok: boolean; output: string; note: string; halted: 'stopped' | 'cancelled' | null }> {
  const verdict = await approveCommand(host, session, views, id, title, base)
  throwIfAborted(host.signal)
  if (verdict !== 'allow') return { ok: false, output: 'The user denied the command. It was not run.', note: '', halted: 'cancelled' }
  let output = ''
  let pending = ''
  const hooks: CommandHooks = {
    onOutput(chunk) {
      output += chunk
      const next = takeOutputUpdate(pending, chunk)
      pending = next.pending
      if (next.emit) showRunning(host, views, id, title, command, output, attempt)
    },
  }
  const run = host.runCommand ?? ((cmd, signal, hook) => runProjectCommand(host.root, cmd, signal, hook, { timeoutMs: CHECK_TIMEOUT_MS }))
  try {
    showRunning(host, views, id, title, command, output, attempt)
    const result = await run(command, host.signal, hooks)
    throwIfAborted(host.signal)
    return { ok: result.ok, output: result.output || output, note: result.note ?? '', halted: null }
  } catch (error) {
    if (isAbort(error)) throw error
    return { ok: false, output: error instanceof Error ? error.message : String(error), note: '', halted: null }
  }
}

function showRunning(
  host: SplitHost,
  views: CodeStepView[],
  id: string,
  title: string,
  command: string,
  output: string,
  attempt?: { attempt: number; attempts: number },
): void {
  pushView(host, views, {
    id,
    index: views.some((item) => item.id === id) ? viewIndex(views, id) : views.length + 1,
    tool: 'check',
    status: 'running',
    title,
    detail: command,
    output: tailText(output),
    attempt: attempt?.attempt,
    attempts: attempt?.attempts,
  })
}

function showCheck(
  host: SplitHost,
  views: CodeStepView[],
  id: string,
  title: string,
  ok: boolean,
  output: string,
  report: Classified,
  attempt?: { attempt: number; attempts: number },
  note?: string,
): void {
  const diagnostics: CodeDiagnosticView[] = [...report.introduced, ...report.inScope, ...report.preExisting].slice(0, 20).map((item) => ({
    file: item.file,
    line: item.line,
    column: item.column,
    message: item.message,
    rule: item.rule,
    source: item.source,
  }))
  pushView(host, views, {
    id,
    index: views.some((item) => item.id === id) ? viewIndex(views, id) : views.length + 1,
    tool: 'check',
    status: ok ? 'ok' : 'error',
    title,
    detail: oneLine(output),
    output: tailText(output),
    diagnostics,
    attempt: attempt?.attempt,
    attempts: attempt?.attempts,
    note,
  })
}

function rememberFocus(session: GateSession, report: Classified | null): void {
  if (!report) return
  const files = [...report.introduced, ...report.inScope].map((item) => item.file)
  if (files.length) session.focusFiles = files
}

function emptyReport(): Classified {
  return { fixed: [], introduced: [], preExisting: [], inScope: [] }
}

function tailText(text: string): string {
  const max = 4_000
  if (text.length <= max) return text
  return text.slice(text.length - max)
}

async function approveEdit(
  host: SplitHost,
  session: GateSession,
  views: CodeStepView[],
  editId: string,
  diff: CodeDiffView,
): Promise<'allow' | 'reject' | 'deny'> {
  const decision = decideApproval(session.mode, { kind: 'edit' }, gateContext(session))
  if (decision.action === 'deny') return 'deny'
  if (decision.action === 'allow' || session.acceptAll) return 'allow'
  host.onDiff?.(diff)
  const step = views.find((item) => item.id === editId)
  if (step) pushView(host, views, { ...step, status: 'waiting', detail: diff.path })
  const answer = await host.ask({ kind: 'edit', id: diff.id, path: diff.path, diff: diff.diff })
  if (answer.all) session.acceptAll = true
  if (answer.allow || answer.all) return 'allow'
  return 'reject'
}

async function approveCommand(
  host: SplitHost,
  session: GateSession,
  views: CodeStepView[],
  id: string,
  title: string,
  command: string,
): Promise<'allow' | 'reject' | 'deny'> {
  const exact = exactCommand(command)
  if (session.approvedCommands.has(exact)) return 'allow'
  const decision = decideApproval(session.mode, { kind: 'command', command }, gateContext(session))
  if (decision.action === 'deny') return 'deny'
  if (decision.action === 'allow') {
    session.approvedCommands.add(exact)
    return 'allow'
  }
  const index = views.some((item) => item.id === id) ? viewIndex(views, id) : views.length + 1
  pushView(host, views, { id, index, tool: 'check', status: 'waiting', title, detail: command })
  const answer = await host.ask({ kind: 'command', id, command })
  if (!answer.allow) {
    const index = views.some((item) => item.id === id) ? viewIndex(views, id) : views.length + 1
    pushView(host, views, { id, index, tool: 'check', status: 'rejected', title, detail: 'Denied' })
    return 'reject'
  }
  session.approvedCommands.add(exact)
  if (answer.remember) {
    session.remembered.add(exact)
    host.onRememberCommand?.(exact)
  }
  return 'allow'
}

function suggest(host: SplitHost): ModelSuggestion | null {
  if (!host.catalog || host.currentModelId == null || host.totalRamGb == null) return null
  return suggestBiggerCodeModel(host.currentModelId, host.totalRamGb, host.catalog)
}

export function summarize(
  done: DoneStep[],
  suite: { command: string; ok: boolean; output: string; report?: Classified | null } | null,
  suggestion: ModelSuggestion | null,
  replanned = false,
): string {
  const lines = done.map((item, index) => {
    const files = item.step.files.length ? item.step.files.join(', ') : 'no file list'
    const state = item.ok ? 'passed' : 'failed'
    const report = item.report && hasFailureNews(item.report) ? `\n${formatFailureReport(item.report)}` : ''
    return `${index + 1}. ${item.step.goal} (${files}) — check ${state}. Undo restores the files from before this step.${report}`
  })
  if (suite) {
    const quiet = suite.report && suite.ok && suite.report.preExisting.length > 0 && !suite.report.introduced.length
    if (quiet) lines.push(`Full test suite has no new failures (${suite.command}).`)
    else if (suite.ok) lines.push(`Full test suite passed (${suite.command}).`)
    else lines.push(`Full test suite failed (${suite.command}).\n${exactError(suite.output)}`)
    if (suite.report && hasFailureNews(suite.report)) lines.push(formatFailureReport(suite.report))
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
    host.reference ? `Reference:\n${host.reference}\nDo not copy the reference into step goals.` : '',
    `Task:\n${task}`,
  ].filter(Boolean).join('\n\n')
}

function editPrompt(step: PlanStep, context: string, pass: { attempt: number; candidate: number; error: string }, reference?: string): string {
  const files = step.files.length ? step.files.join(', ') : 'choose the file from the context'
  return [
    'Kind: edit',
    `Attempt: ${pass.attempt}`,
    pass.candidate ? `Candidate: ${pass.candidate} of ${STEP_CANDIDATES}` : 'Candidate: 0',
    `Goal: ${step.goal}`,
    `Target files: ${files}`,
    step.symbols.length ? `Symbols: ${step.symbols.join(', ')}` : '',
    `Context:\n${context}`,
    reference ? `Reference:\n${reference}` : '',
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

function openSession(host: SplitHost): GateSession {
  return {
    mode: host.mode ?? 'ask',
    remembered: new Set([...(host.allowedCommands ?? [])].map(exactCommand)),
    allowlist: new Set([...(host.commandAllowlist ?? [])].map(exactCommand)),
    checkpointPaths: new Set(),
    acceptAll: false,
    approvedCommands: new Set(),
    baselines: new Map(),
    focusFiles: [],
  }
}

function gateContext(session: GateSession): ApprovalContext {
  return {
    remembered: session.remembered,
    allowlist: session.allowlist,
    checkpointPaths: session.checkpointPaths,
  }
}

function rememberCheckpoint(session: GateSession, checkpoint: Checkpoint): void {
  for (const file of checkpoint.files) session.checkpointPaths.add(file.path)
}

function storeDiff(host: SplitHost, diffs: CodeDiffView[], diff: CodeDiffView): void {
  host.onDiff?.(diff)
  const at = diffs.findIndex((item) => item.id === diff.id)
  if (at >= 0) diffs[at] = diff
  else diffs.push(diff)
}

function revisionOf(value: string[] | { order: string[]; edits?: PlanGoalEdit[] }): { order: string[]; edits: PlanGoalEdit[] } {
  if (Array.isArray(value)) return { order: value, edits: [] }
  return { order: value.order, edits: value.edits ?? [] }
}

function donePlan(done: DoneStep[]): CodePlanView {
  return toPlanView(done.map((item) => item.step), 'done', done.filter((item) => item.checkpoint).map((item) => ({
    stepId: item.step.id,
    title: item.step.goal,
  })))
}

function checkpointsOf(done: DoneStep[]): Checkpoint[] {
  return done.flatMap((item) => item.checkpoint ? [item.checkpoint] : [])
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

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

export type { CompletionRequest, ChatMessage }
