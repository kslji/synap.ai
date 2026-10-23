import assert from 'node:assert/strict'
import { test } from 'node:test'
import { allocate, BUDGETS, budgetForTier, heuristicCounter } from './token-budget.js'

test('each RAM tier sizes its own context window: 8K, 8K, 16K, 32K', () => {
  assert.equal(budgetForTier(0).serverCtx, 8192)
  assert.equal(budgetForTier(1).serverCtx, 8192)
  assert.equal(budgetForTier(2).serverCtx, 16384)
  assert.equal(budgetForTier(3).serverCtx, 32768)
  // A 32 GB machine gets a 32K window but must still leave room: one request stays at 16K.
  assert.equal(budgetForTier(3).total, 16384)
  assert.ok(budgetForTier(3).total < budgetForTier(3).serverCtx)
})

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
