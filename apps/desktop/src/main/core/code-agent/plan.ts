/**
 * Task triage, plan schema, and graph-aware ordering.
 * Ordering, cycles, and file checks stay in code. The model only proposes the checklist.
 */
import { z } from 'zod'
import { scanProject } from '../code/scan.js'

export type CheckKind = 'test' | 'typecheck' | 'lint'
export type TriageKind = 'edit' | 'plan' | 'chat'
export type FileRole = 'test' | 'config' | 'code'

export interface StepCheck {
  kind: CheckKind
  command: string
}

export interface PlanStep {
  id: string
  goal: string
  files: string[]
  symbols: string[]
  depends_on: string[]
  check: StepCheck
  create: boolean
}

export interface PlanSymbol {
  name: string
  qualified: string
  kind: string
  path: string
}

export interface PlanEdge {
  /** File that imports, calls, or references the definition. */
  from: string
  /** File that defines the symbol, type, or module. */
  to: string
  kind: string
}

export interface PlanFacts {
  indexed: boolean
  files: string[]
  symbols: PlanSymbol[]
  edges: PlanEdge[]
}

const ID_RE = /^[A-Za-z0-9_-]{1,40}$/

const CheckSchema = z.object({
  kind: z.enum(['test', 'typecheck', 'lint']),
  command: z.string().max(200),
})

const StepSchema = z.object({
  id: z.string().regex(ID_RE),
  goal: z.string().min(1).max(400),
  files: z.array(z.string().min(1).max(240)).max(20),
  symbols: z.array(z.string().min(1).max(120)).max(20),
  depends_on: z.array(z.string().regex(ID_RE)).max(20),
  check: CheckSchema,
  create: z.boolean().optional(),
})

const PlanSchema = z.object({
  steps: z.array(StepSchema).min(1).max(12),
})

export type PlanIssue =
  | { ok: false; reason: 'schema' | 'missing' | 'cycle'; message: string }

export type PlanOk = { ok: true; steps: PlanStep[] }

const CHANGE = /\b(fix|change|update|add|remove|delete|rename|replace|implement|refactor|migrate|write|create|edit|patch|tweak|bug|broken|typo)\b/i
const PLAN_MARKERS = [
  /\brefactor\b/i,
  /\bmigrat(?:e|ion)\b/i,
  /\bacross\b/i,
  /\ball files\b/i,
  /\bevery file\b/i,
  /\bevery caller\b/i,
  /\brename everywhere\b/i,
  /\bmulti-?step\b/i,
  /\band then\b/i,
  /\bthen\b/i,
  /\bstep by step\b/i,
]
const EDIT_MARKERS = [
  /\bquick fix\b/i,
  /\btypo\b/i,
  /\bone[- ]line\b/i,
  /\bsingle file\b/i,
  /\bjust (?:change|fix|rename|update)\b/i,
  /\bonly (?:change|fix|update)\b/i,
]
const PATH_RE = /(?:^|[\s"'`(])([\w.@~/-]+\.(?:tsx?|jsx?|mjs|cjs|py|go|rs|java|json|toml|md|css|html))(?=$|[\s"'`),.:])/gi

export function workspaceFacts(root: string): PlanFacts {
  const scan = scanProject(root)
  return {
    indexed: false,
    files: scan.files.map((file) => file.rel),
    symbols: [],
    edges: [],
  }
}

export function fileRole(path: string): FileRole {
  const norm = normPath(path)
  const base = norm.split('/').pop() ?? norm
  if (
    /(^|\/)(?:tests?|__tests__|spec)\//i.test(`${norm}/`.replace(/\/+$/, '/'))
    || /(^|\/)(?:tests?|__tests__|spec)\//i.test(norm)
    || /\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(base)
    || /^test_.*\.py$/i.test(base)
    || /_test\.(?:go|py)$/i.test(base)
    || /Test\.java$/.test(base)
  ) return 'test'
  if (
    /^(?:package\.json|tsconfig.*\.json|pyproject\.toml|setup\.cfg|cargo\.toml|go\.mod|ruff\.toml)$/i.test(base)
    || /\.config\.[cm]?[jt]sx?$/i.test(base)
    || /^\.eslintrc/i.test(base)
  ) return 'config'
  return 'code'
}

export function triageTask(task: string, knownFiles: readonly string[] = []): TriageKind {
  const text = task.trim()
  const paths = mentionedPaths(text, knownFiles)
  if (paths.length >= 2) return 'plan'
  const planMarker = PLAN_MARKERS.some((marker) => marker.test(text))
  const editMarker = EDIT_MARKERS.some((marker) => marker.test(text))
  const change = CHANGE.test(text) || editMarker
  if (!change) return 'chat'
  if (planMarker && !editMarker) return 'plan'
  if (editMarker) return 'edit'
  const words = text.split(/\s+/).filter(Boolean).length
  if (paths.length === 1 && words <= 40 && !/\band\b/i.test(text)) return 'edit'
  if (words <= 18 && paths.length <= 1) return 'edit'
  return 'plan'
}

export function mentionedPaths(task: string, knownFiles: readonly string[]): string[] {
  const found: string[] = []
  const seen = new Set<string>()
  const push = (path: string) => {
    const norm = normPath(path)
    if (!norm || seen.has(norm)) return
    seen.add(norm)
    found.push(norm)
  }
  const ordered = [...knownFiles].sort((a, b) => b.length - a.length)
  let rest = task
  for (const file of ordered) {
    const norm = normPath(file)
    if (norm && rest.includes(norm)) {
      push(norm)
      rest = rest.split(norm).join(' ')
    }
  }
  for (const match of task.matchAll(PATH_RE)) {
    const token = match[1]
    if (token) push(token)
  }
  return found
}

/** Words that turn a named file into a file to leave alone. */
const LEAVE_ALONE = /\b(?:leave|don'?t|do not|never|without|except|aside)\b/

/**
 * Paths the task asks to change: `mentionedPaths` minus any path a clause rules out
 * ("leave src/legacy.ts alone", "do not touch src/b.ts"). A finish is refused when one of these was
 * skipped, so a mention that is not a target has to be dropped here.
 */
export function requestedPaths(task: string, knownFiles: readonly string[]): string[] {
  const clauses = task.split(/[.;!?]\s*/).map((clause) => clause.toLowerCase())
  return mentionedPaths(task, knownFiles).filter((path) => {
    const needle = path.toLowerCase()
    const clause = clauses.find((item) => item.includes(needle))
    if (!clause) return true
    return !LEAVE_ALONE.test(clause.slice(0, clause.indexOf(needle)))
  })
}

/** Indexed symbols the task names, deduplicated by name. Short names are ignored as noise. */
export function mentionedSymbols(task: string, symbols: readonly PlanSymbol[]): string[] {
  const idents = new Set(task.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [])
  const found: string[] = []
  for (const symbol of symbols) {
    if (symbol.name.length < 3 || found.includes(symbol.name)) continue
    if (idents.has(symbol.name) || idents.has(symbol.qualified)) found.push(symbol.name)
  }
  return found
}

/** Which executor runs a task: the tool loop, or the checklist with a check after every step. */
export type TaskRoute = 'loop' | 'split'

const CREATE_FILE = /\b(?:new file|create (?:a )?(?:new )?file|add (?:a )?file|new module|create (?:a )?module)\b/i

/**
 * A named, single-file change touching at most two symbols is cheaper and more reliable in the loop:
 * one edit and one finish, instead of retries and alternate candidates on a small model. A new file,
 * edits across two or more files, or a task that names nothing for the model to go on keeps the
 * checklist, because ordering and the second file are what a 2B gets wrong.
 */
export function routeTask(task: string, facts: PlanFacts): TaskRoute {
  const text = task.trim()
  if (CREATE_FILE.test(text)) return 'split'
  if (mentionedPaths(text, facts.files).length >= 2) return 'split'
  const symbols = mentionedSymbols(text, facts.symbols)
  if (symbols.length > 2) return 'split'
  if (!mentionedPaths(text, facts.files).length && !symbols.length) return 'split'
  return 'loop'
}

/**
 * Files the checklist asked for that no applied patch touched, plus new files the task named that
 * nobody created, in the order they were named. A skipped second file is the failure a small model
 * makes most often, so it is checked before a run is called finished. A file the task only mentions
 * ("leave src/legacy.ts alone") is not a target unless a step claims it.
 */
export function missingTargets(
  steps: readonly PlanStep[],
  written: readonly { path: string; status: string }[],
  facts: PlanFacts,
  fresh: readonly string[] = [],
): string[] {
  const expected: string[] = []
  const push = (path: string) => {
    const norm = normPath(path)
    if (norm && !expected.includes(norm)) expected.push(norm)
  }
  for (const step of steps) {
    for (const path of targetFiles(step, facts)) push(path)
  }
  for (const path of fresh) push(path)
  const applied = new Set(written.filter((diff) => diff.status === 'applied').map((diff) => normPath(diff.path)))
  return expected.filter((path) => !applied.has(path))
}

export function parsePlan(raw: unknown): PlanOk | PlanIssue {
  const normalized = normalizePlan(raw)
  const parsed = PlanSchema.safeParse(normalized)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const where = issue?.path?.length ? issue.path.join('.') : 'plan'
    return { ok: false, reason: 'schema', message: `Invalid plan at ${where}: ${issue?.message ?? 'schema rejected the checklist'}` }
  }
  const steps: PlanStep[] = parsed.data.steps.map((step) => ({
    id: step.id,
    goal: step.goal.trim(),
    files: step.files.map(normPath),
    symbols: step.symbols.map((name) => name.trim()),
    depends_on: [...step.depends_on],
    check: { kind: step.check.kind, command: step.check.command.trim() },
    create: step.create === true,
  }))
  const ids = new Set<string>()
  for (const step of steps) {
    if (ids.has(step.id)) return { ok: false, reason: 'schema', message: `Duplicate step id ${step.id}` }
    ids.add(step.id)
    if (!step.files.length && !step.symbols.length) {
      return { ok: false, reason: 'schema', message: `Step ${step.id} needs a target file or symbol` }
    }
    if (step.depends_on.includes(step.id)) {
      return { ok: false, reason: 'schema', message: `Step ${step.id} depends on itself` }
    }
    for (const dep of step.depends_on) {
      if (!ids.has(dep) && !steps.some((item) => item.id === dep)) {
        return { ok: false, reason: 'schema', message: `Step ${step.id} depends on unknown step ${dep}` }
      }
    }
  }
  return { ok: true, steps }
}

export function validatePlan(raw: unknown, facts: PlanFacts): PlanOk | PlanIssue {
  const parsed = parsePlan(raw)
  if (!parsed.ok) return parsed
  const missing: string[] = []
  const fileSet = new Set(facts.files.map(normPath))
  const symbolSet = new Set<string>()
  for (const symbol of facts.symbols) {
    symbolSet.add(symbol.name)
    symbolSet.add(symbol.qualified)
  }
  for (const step of parsed.steps) {
    if (!step.create) {
      for (const file of step.files) {
        if (!fileSet.has(file)) missing.push(`file ${file}`)
      }
      if (facts.indexed) {
        for (const name of step.symbols) {
          if (!symbolSet.has(name)) missing.push(`symbol ${name}`)
        }
      }
    }
    const targets = targetFiles(step, facts)
    if (!targets.length && !step.create) {
      missing.push(`step ${step.id} has no indexed target`)
    }
  }
  if (missing.length) {
    return { ok: false, reason: 'missing', message: `Unknown in the project index: ${[...new Set(missing)].join(', ')}. Mark new files with create: true.` }
  }
  const ordered = orderPlan(parsed.steps, facts)
  if (!ordered.ok) {
    return { ok: false, reason: 'cycle', message: `Cycle in the plan: ${ordered.cycle.join(' -> ')}. Replan without that cycle.` }
  }
  return { ok: true, steps: ordered.steps }
}

export function targetFiles(step: PlanStep, facts: PlanFacts): string[] {
  const files = [...step.files]
  for (const name of step.symbols) {
    for (const symbol of facts.symbols) {
      if (symbol.name !== name && symbol.qualified !== name) continue
      const path = normPath(symbol.path)
      if (!files.includes(path)) files.push(path)
    }
  }
  return files
}

export function orderPlan(steps: PlanStep[], facts: PlanFacts): { ok: true; steps: PlanStep[] } | { ok: false; cycle: string[] } {
  const byId = new Map(steps.map((step) => [step.id, step]))
  const targets = new Map(steps.map((step) => [step.id, targetFiles(step, facts)]))
  const protectedPairs = new Set<string>()
  const edges: { before: string; after: string }[] = []
  const add = (before: string, after: string, protect: boolean) => {
    if (!byId.has(before) || !byId.has(after) || before === after) return
    const forward = pair(before, after)
    const back = pair(after, before)
    if (protectedPairs.has(back)) return
    if (edges.some((edge) => edge.before === before && edge.after === after)) {
      if (protect) protectedPairs.add(forward)
      return
    }
    edges.push({ before, after })
    if (protect) protectedPairs.add(forward)
  }

  for (const edge of facts.edges) {
    const defs = steps.filter((step) => targets.get(step.id)?.includes(normPath(edge.to)))
    const callers = steps.filter((step) => targets.get(step.id)?.includes(normPath(edge.from)))
    for (const def of defs) {
      for (const caller of callers) add(def.id, caller.id, true)
    }
  }

  const roleOf = (step: PlanStep): FileRole => {
    const files = targets.get(step.id) ?? []
    if (files.some((file) => fileRole(file) === 'test')) return 'test'
    if (files.some((file) => fileRole(file) === 'config')) return 'config'
    return 'code'
  }
  for (const left of steps) {
    for (const right of steps) {
      if (left.id === right.id) continue
      const leftRole = roleOf(left)
      const rightRole = roleOf(right)
      if (leftRole === 'config' && rightRole === 'code') add(left.id, right.id, true)
      if (leftRole !== 'test' && rightRole === 'test') add(left.id, right.id, true)
    }
  }
  for (const step of steps) {
    for (const dep of step.depends_on) add(dep, step.id, false)
  }

  const cycle = findCycle(steps.map((step) => step.id), edges)
  if (cycle) return { ok: false, cycle }

  const pending = new Map<string, number>()
  const after = new Map<string, string[]>()
  for (const step of steps) pending.set(step.id, 0)
  for (const edge of edges) {
    pending.set(edge.after, (pending.get(edge.after) ?? 0) + 1)
    const list = after.get(edge.before) ?? []
    list.push(edge.after)
    after.set(edge.before, list)
  }
  const ready = steps.filter((step) => (pending.get(step.id) ?? 0) === 0)
  const sorted: PlanStep[] = []
  while (ready.length) {
    ready.sort((a, b) => compareTie(a, b, targets))
    const next = ready.shift()
    if (!next) break
    sorted.push(next)
    for (const id of after.get(next.id) ?? []) {
      const left = (pending.get(id) ?? 0) - 1
      pending.set(id, left)
      if (left === 0) {
        const step = byId.get(id)
        if (step) ready.push(step)
      }
    }
  }
  if (sorted.length !== steps.length) {
    const stuck = steps.filter((step) => !sorted.includes(step)).map((step) => step.id)
    return { ok: false, cycle: stuck.length ? [...stuck, stuck[0]!] : ['cycle'] }
  }
  return { ok: true, steps: sorted }
}

export interface PlanGoalEdit {
  id: string
  goal: string
}

/** Ask-mode reorder, remove, and goal edit. Ids omitted from `order` are dropped. Unknown ids are ignored. */
export function applyPlanEdit(steps: PlanStep[], order: readonly string[], edits: readonly PlanGoalEdit[] = []): PlanStep[] {
  const goals = new Map<string, string>()
  for (const edit of edits) {
    const goal = edit.goal.trim().slice(0, 400)
    if (goal) goals.set(edit.id, goal)
  }
  const byId = new Map(steps.map((step) => [step.id, step]))
  const next: PlanStep[] = []
  const seen = new Set<string>()
  for (const id of order) {
    const step = byId.get(id)
    if (!step || seen.has(id)) continue
    seen.add(id)
    const goal = goals.get(step.id)
    next.push(goal ? { ...step, goal } : step)
  }
  return next
}

export function dependentSteps(steps: PlanStep[], failedId: string, facts: PlanFacts): PlanStep[] {
  const byId = new Map(steps.map((step) => [step.id, step]))
  const failed = byId.get(failedId)
  if (!failed) return []
  const children = new Map<string, string[]>()
  for (const step of steps) {
    for (const dep of step.depends_on) {
      const list = children.get(dep) ?? []
      list.push(step.id)
      children.set(dep, list)
    }
  }
  const ids = new Set<string>([failedId])
  const walk = (id: string) => {
    for (const next of children.get(id) ?? []) {
      if (ids.has(next)) continue
      ids.add(next)
      walk(next)
    }
  }
  walk(failedId)
  const failedFiles = new Set(targetFiles(failed, facts))
  const callerFiles = new Set(facts.edges.filter((edge) => failedFiles.has(normPath(edge.to))).map((edge) => normPath(edge.from)))
  let after = false
  for (const step of steps) {
    if (step.id === failedId) {
      after = true
      continue
    }
    if (!after) continue
    if (targetFiles(step, facts).some((file) => callerFiles.has(file))) ids.add(step.id)
  }
  return steps.filter((step) => ids.has(step.id))
}

export function planResponseFormat(): { type: 'json_schema'; json_schema: { name: string; strict: boolean; schema: Record<string, unknown> } } {
  return {
    type: 'json_schema',
    json_schema: {
      name: 'code_plan',
      strict: true,
      schema: {
        type: 'object',
        properties: {
          steps: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                goal: { type: 'string' },
                files: { type: 'array', items: { type: 'string' } },
                symbols: { type: 'array', items: { type: 'string' } },
                depends_on: { type: 'array', items: { type: 'string' } },
                check: {
                  type: 'object',
                  properties: {
                    kind: { type: 'string', enum: ['test', 'typecheck', 'lint'] },
                    command: { type: 'string' },
                  },
                  required: ['kind', 'command'],
                },
                create: { type: 'boolean' },
              },
              required: ['id', 'goal', 'files', 'symbols', 'depends_on', 'check', 'create'],
            },
          },
        },
        required: ['steps'],
      },
    },
  }
}

export function patchResponseFormat(): { type: 'json_schema'; json_schema: { name: string; strict: boolean; schema: Record<string, unknown> } } {
  return {
    type: 'json_schema',
    json_schema: {
      name: 'code_patch',
      strict: true,
      schema: {
        type: 'object',
        properties: {
          edits: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                path: { type: 'string' },
                old: { type: 'string' },
                new: { type: 'string' },
              },
              required: ['path', 'old', 'new'],
            },
          },
        },
        required: ['edits'],
      },
    },
  }
}

function normalizePlan(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const body = raw as Record<string, unknown>
  if (!Array.isArray(body.steps)) return raw
  return {
    steps: body.steps.map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return item
      const step = item as Record<string, unknown>
      let check = step.check
      if (typeof check === 'string' && (check === 'test' || check === 'typecheck' || check === 'lint')) {
        check = { kind: check, command: '' }
      }
      return {
        ...step,
        files: step.files ?? step.target_files ?? step.targets ?? [],
        symbols: step.symbols ?? step.target_symbols ?? [],
        depends_on: step.depends_on ?? step.dependsOn ?? [],
        check,
      }
    }),
  }
}

function compareTie(a: PlanStep, b: PlanStep, targets: Map<string, string[]>): number {
  const key = (step: PlanStep): [number, number, string, string] => {
    const files = targets.get(step.id) ?? step.files
    const role = files.some((file) => fileRole(file) === 'test') ? 2 : files.some((file) => fileRole(file) === 'config') ? 0 : 1
    const first = [...files].sort((left, right) => left.localeCompare(right))[0] ?? ''
    return [files.length, role, first, step.id]
  }
  const [af, ar, ap, ai] = key(a)
  const [bf, br, bp, bi] = key(b)
  if (af !== bf) return af - bf
  if (ar !== br) return ar - br
  if (ap !== bp) return ap.localeCompare(bp)
  return ai.localeCompare(bi)
}

function findCycle(nodes: string[], edges: { before: string; after: string }[]): string[] | null {
  const adj = new Map<string, string[]>()
  for (const id of nodes) adj.set(id, [])
  for (const edge of edges) adj.get(edge.before)?.push(edge.after)
  const color = new Map<string, number>()
  const stack: string[] = []
  const dfs = (id: string): string[] | null => {
    color.set(id, 1)
    stack.push(id)
    for (const next of adj.get(id) ?? []) {
      const state = color.get(next) ?? 0
      if (state === 1) {
        const at = stack.indexOf(next)
        return [...stack.slice(at), next]
      }
      if (state === 0) {
        const found = dfs(next)
        if (found) return found
      }
    }
    stack.pop()
    color.set(id, 2)
    return null
  }
  for (const id of nodes) {
    if ((color.get(id) ?? 0) === 0) {
      const found = dfs(id)
      if (found) return found
    }
  }
  return null
}

function pair(before: string, after: string): string {
  return `${before}\0${after}`
}

export function normPath(path: string): string {
  return path.trim().replace(/\\/g, '/').replace(/^\.\//, '')
}
