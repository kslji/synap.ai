/**
 * The agent eval's own checks: 20 tasks, each with a fixture and an expectation that can actually
 * fail. No model is needed - a task whose fixture already contains the expected text is not a
 * task, so these tests pin that every "must contain" is absent at the start, every "must not
 * contain" is present at the start, and every checked path is real.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AGENT_EVAL_CASES, EVAL_RULES, scoreFiles, type EvalCase } from './eval-cases.js'

/** The file text after a run: an unchanged fixture unless the test says otherwise. */
function texts(c: EvalCase, patch: Record<string, string | null> = {}): Record<string, string | null> {
  const out: Record<string, string | null> = {}
  for (const rule of c.check) out[rule.path] = rule.path in patch ? patch[rule.path]! : (c.files[rule.path] ?? null)
  return out
}

/** True when a file text already satisfies one rule, so the rule could never fail. */
function ruleHolds(text: string | undefined, rule: { has?: string[]; missing?: string[] }): boolean {
  if (text === undefined) return false
  const has = (needle: string): boolean => text.includes(needle)
  return (rule.has ?? []).every(has) && !(rule.missing ?? []).some(has)
}

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
