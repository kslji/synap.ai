import assert from 'node:assert/strict'
import { test } from 'node:test'
import { allocate, BUDGETS, heuristicCounter } from './token-budget.js'

test('retrieved chunks stop at the budget and stay inside an untrusted block', async () => {
  const filler = 'lamp coil rack paint grey dock '.repeat(80)
  const chunks = Array.from({ length: 8 }, (_, i) => ({
    id: String(i),
    title: `Lamp ${i}`,
    text: i === 0 ? `The spare lamp code is PL-17. ${filler}` : filler,
    score: 1 - i * 0.01,
  }))
  const out = await allocate(heuristicCounter, BUDGETS.tier0, {
    system: 'You are Surf.',
    chunks,
    history: [],
    question: 'What is the spare lamp code?',
  })
  const user = String(out.messages.at(-1)?.content ?? '')
  assert.ok(out.report.droppedChunks > 0)
  assert.ok(out.report.parts.retrieved <= BUDGETS.tier0.retrieved)
  assert.match(user, /PL-17/)
  assert.match(user, /untrusted/)
})
