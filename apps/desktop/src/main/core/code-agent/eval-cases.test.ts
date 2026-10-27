/**
 * The agent eval's own checks: 20 tasks, each with a fixture, a behavioural test, and an expectation
 * that can actually fail. No model is needed - a task whose fixture already contains the expected
 * text is not a task, so these tests pin that every "must contain" is absent at the start, every
 * "must not contain" is present at the start, every checked path is real, and every fixture's own
 * test fails on the fixture and passes on the reference solution.
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { AGENT_EVAL_CASES, EVAL_RULES, scoreFiles, type EvalCase } from './eval-cases.js'
import { evalProjectFiles, evalTestCommand } from './eval-project.js'
import { runProjectCommand } from './workspace.js'

const resolve = createRequire(import.meta.url).resolve
const tsc = resolve('typescript/bin/tsc')
const loader = resolve('tsx')

const NL = String.fromCharCode(10)
/** A whole file from its lines, so a case reads as source rather than as escapes. */
function lines(...parts: string[]): string {
  return parts.join(NL) + NL
}

function write(root: string, files: Record<string, string>): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
}

/** Build the fixture as the eval does, drop these files in, and run its own test. */
async function runFixture(c: EvalCase, files: Record<string, string>, command = 'npm test'): Promise<{ ok: boolean; output: string }> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), `surf-case-${c.id}-`)))
  try {
    write(root, files)
    write(root, c.tests)
    write(root, evalProjectFiles(tsc, { test: evalTestCommand(loader, Object.keys(c.tests)) }))
    return await runProjectCommand(root, command)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

/** The file text after a run: an unchanged fixture unless the test says otherwise. */
function texts(c: EvalCase, patch: Record<string, string | null> = {}): Record<string, string | null> {
  const out: Record<string, string | null> = {}
  for (const rule of c.check) out[rule.path] = rule.path in patch ? patch[rule.path]! : (c.files[rule.path] ?? null)
  return out
}

/** True when a file text already satisfies one rule, so the rule could never fail. */
function ruleHolds(text: string | undefined, rule: { has?: string[]; missing?: string[]; anyOf?: string[][] }): boolean {
  if (text === undefined) return false
  const has = (needle: string): boolean => text.includes(needle)
  const oneGroup = (rule.anyOf ?? []).some((needles) => needles.every(has))
  return (rule.has ?? []).every(has) && !(rule.missing ?? []).some(has) && (!(rule.anyOf?.length) || oneGroup)
}

test('the reference solution satisfies its own expectations', () => {
  // A rule the solution itself does not meet is a rule the loop cannot see: the check says the
  // behaviour is right, the score says it is not, and no fix turn can close that gap.
  const problems: string[] = []
  for (const c of AGENT_EVAL_CASES) {
    const after: Record<string, string | null> = {}
    for (const rule of c.check) after[rule.path] = c.solution[rule.path] ?? c.files[rule.path] ?? null
    const scored = scoreFiles(after, c)
    if (!scored.pass) problems.push(`${c.id}: ${scored.why}`)
  }
  assert.deepEqual(problems, [], problems.join(NL + NL))
})

test('the suite is 20 tasks with unique ids and a sentence each', () => {
  assert.equal(AGENT_EVAL_CASES.length, 20)
  assert.equal(new Set(AGENT_EVAL_CASES.map((c) => c.id)).size, 20, 'ids identify a row in the report')
  for (const c of AGENT_EVAL_CASES) {
    assert.ok(c.task.trim().length > 10, `${c.id} needs a task sentence`)
    assert.ok(c.check.length > 0, `${c.id} needs an expectation`)
    assert.ok(Object.keys(c.files).length > 0, `${c.id} needs a fixture`)
  }
  assert.match(EVAL_RULES, /TypeScript/)
})

test('no task is already done before the model touches it', () => {
  for (const c of AGENT_EVAL_CASES) {
    for (const rule of c.check) {
      assert.equal(ruleHolds(c.files[rule.path], rule), false, `${c.id}: ${rule.path} already satisfies its rule`)
      // A rule that only removes text needs that text in the fixture, or the check is vacuous.
      for (const needle of rule.missing ?? []) {
        const start = c.files[rule.path]
        if (start === undefined) continue
        assert.ok(start.includes(needle), `${c.id}: fixture does not contain "${needle}", so removing it cannot fail`)
      }
    }
  }
})

test('every scored file is a fixture file or a file the task asks to create', () => {
  for (const c of AGENT_EVAL_CASES) {
    for (const rule of c.check) {
      const known = c.files[rule.path] !== undefined || /new file|create/.test(c.task)
      assert.ok(known, `${c.id}: ${rule.path} is neither in the fixture nor named as a new file`)
    }
  }
})

test('a run that leaves the fixture untouched fails, and the reason names the file', () => {
  for (const c of AGENT_EVAL_CASES) {
    const scored = scoreFiles(texts(c), c)
    assert.equal(scored.pass, false, `${c.id} scored PASS with no change`)
    assert.match(scored.why, /\S/)
  }
})

test('a run that does the work passes, and a half-done one still fails', () => {
  const rename = AGENT_EVAL_CASES.find((c) => c.id === 'rename-add')
  assert.ok(rename)
  assert.equal(scoreFiles(texts(rename, { 'src/math.ts': 'export function sum(a: number, b: number): number {\n  return a + b\n}\n' }), rename).pass, true)
  const wrong = scoreFiles(texts(rename, { 'src/math.ts': 'export function add(a: number, b: number): number {\n  return a + b + 0\n}\n' }), rename)
  assert.equal(wrong.pass, false, 'the 2B\'s answer-shaped no-op edit must not score')
  assert.match(wrong.why, /lacks "function sum\("/)

  const twoFiles = AGENT_EVAL_CASES.find((c) => c.id === 'rename-fmt')
  assert.ok(twoFiles)
  const half = scoreFiles(texts(twoFiles, {
    'src/fmt.ts': 'export function formatTitle(value: string): string {\n  return value.trim()\n}\n',
  }), twoFiles)
  assert.equal(half.pass, false, 'renaming the definition without the caller is not done')
  assert.match(half.why, /src\/app\.ts/)
})

test('a deleted file fails instead of counting as changed', () => {
  const c = AGENT_EVAL_CASES.find((item) => item.id === 'strict-eq')
  assert.ok(c)
  const scored = scoreFiles(texts(c, { 'src/eq.ts': null }), c)
  assert.equal(scored.pass, false)
  assert.match(scored.why, /missing/)
})

test('every fixture test fails on the fixture and passes on the reference solution', async () => {
  const failures: string[] = []
  for (const c of AGENT_EVAL_CASES) {
    assert.ok(Object.keys(c.tests).length > 0, `${c.id} has no behavioural test`)
    assert.ok(Object.keys(c.solution).length > 0, `${c.id} has no reference solution`)
    const before = await runFixture(c, c.files)
    if (before.ok) failures.push(`${c.id}: the fixture already passes its own test`)
    const after = await runFixture(c, { ...c.files, ...c.solution })
    if (!after.ok) failures.push(`${c.id}: the solution fails its own test\n${after.output.slice(-900)}`)
  }
  assert.deepEqual(failures, [], failures.join('\n\n'))
})

test('the reference solution also typechecks', async () => {
  const failures: string[] = []
  for (const c of AGENT_EVAL_CASES) {
    const run = await runFixture(c, { ...c.files, ...c.solution }, 'npm run typecheck')
    if (!run.ok) failures.push(`${c.id}: ${run.output.slice(-500)}`)
  }
  assert.deepEqual(failures, [], failures.join('\n\n'))
})

test('a correct answer is not failed for choosing the other quote mark', async () => {
  // A fixture test that pins a quote style fails work that behaves right, and its failure message
  // then sends a small model back to edit code that was already correct.
  const quote = String.fromCharCode(34)
  const failures: string[] = []
  for (const c of AGENT_EVAL_CASES) {
    const doubled = Object.fromEntries(Object.entries(c.solution).map(([path, text]) => [path, text.replace(/from '([^']+)'/g, `from ${quote}$1${quote}`)]))
    const run = await runFixture(c, { ...c.files, ...doubled })
    if (!run.ok) failures.push(`${c.id}: ${run.output.slice(-700)}`)
  }
  assert.deepEqual(failures, [], failures.join(NL + NL))
})

test('a second correct answer is accepted by the test and by the score', async () => {
  // A rule that only the reference solution's phrasing satisfies fails work that behaves right,
  // and the loop has no way to know it: the check it runs says the code is fine.
  const alternates: Record<string, Record<string, string>> = {
    'divide-guard': { 'src/divide.ts': lines('export function divide(a: number, b: number): number {', '  return b === 0 ? 0 : a / b', '}') },
    'export-version': { 'src/version.ts': lines("const VERSION = '1.0.0'", 'export { VERSION }', 'export default VERSION') },
    'async-load': {
      'src/load.ts': lines('export function load(path: string): Promise<string> {', '  return Promise.resolve(path.toUpperCase())', '}'),
      'src/main.ts': lines("import { load } from './load'", '', 'export async function main(): Promise<string> {', "  return await load('a')", '}'),
    },
  }
  const problems: string[] = []
  for (const [id, patch] of Object.entries(alternates)) {
    const c = AGENT_EVAL_CASES.find((item) => item.id === id)
    assert.ok(c, `${id} is not a task`)
    const run = await runFixture(c, { ...c.files, ...patch })
    if (!run.ok) problems.push(`${id}: the alternative fails the fixture's own test${NL}${run.output.slice(-700)}`)
    const after: Record<string, string | null> = {}
    for (const rule of c.check) after[rule.path] = patch[rule.path] ?? c.files[rule.path] ?? null
    const scored = scoreFiles(after, c)
    if (!scored.pass) problems.push(`${id}: the alternative behaves right but is scored "${scored.why}"`)
  }
  assert.deepEqual(problems, [], problems.join(NL + NL))
})

test('an edit that compiles but leaves the job half done fails the fixture test', async () => {
  // The loop is told by the check, so a wrong answer the check accepts is a task the agent cannot
  // lose - and a score the check never asks for is a rule the agent cannot see.
  const halfDone: Record<string, Record<string, string>> = {
    'max-bytes': {
      'src/limits.ts': lines('export const MAX_BYTES = 1024', '', 'export function fits(size: number): boolean {', '  return size <= MAX_BYTES', '}', '', 'export function chunk(size: number): number {', '  return size / 1024', '}'),
    },
    'move-base-url': {
      'src/a.ts': lines('export function url(path: string): string {', "  return 'https://example.test' + path", '}'),
      'src/b.ts': lines("export const BASE_URL = 'https://example.test'", '', "export const name = 'b'")
    },
    'shared-limit': {
      'src/limits.ts': lines('export const LIMIT = 10'),
      'src/x.ts': lines('export const LIMIT = 10', '', 'export const x = LIMIT + 1'),
    },
  }
  const problems: string[] = []
  for (const [id, patch] of Object.entries(halfDone)) {
    const c = AGENT_EVAL_CASES.find((item) => item.id === id)
    assert.ok(c, `${id} is not a task`)
    const run = await runFixture(c, { ...c.files, ...patch })
    if (run.ok) problems.push(`${id}: its own test accepts an edit that does not do the task`)
    else if (!/not |does |still |left|should/.test(run.output)) problems.push(`${id}: the failure says nothing about the task${NL}${run.output.slice(-500)}`)
  }
  assert.deepEqual(problems, [], problems.join(NL + NL))
})
