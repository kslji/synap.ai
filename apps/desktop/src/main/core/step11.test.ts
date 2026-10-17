import assert from 'node:assert/strict'
import { test } from 'node:test'
import { step11Cases } from './step11-cases.js'
import { evalQuestions } from './step11-questions.js'

test('step 11 cases are real and all pass', () => {
  const questions = evalQuestions()
  assert.ok(questions.length >= 100, `expected at least 100 questions, got ${questions.length}`)
  for (const domain of ['coding', 'splitting', 'run-fix', 'screenshots', 'fresh', 'finance', 'legal', 'no-fabrication']) {
    const count = questions.filter((question) => question.domain === domain).length
    assert.ok(count >= 8, `${domain} has ${count} questions`)
  }
  const rows = step11Cases()
  assert.ok(rows.length >= 100, `expected at least 100 cases, got ${rows.length}`)
  const failed = rows.filter((row) => !row.fields.ok).map((row) => `${row.id}: ${row.fields.detail}`)
  assert.deepEqual(failed, [])
  const ids = new Set(rows.map((row) => row.id))
  assert.equal(ids.size, rows.length)
})
