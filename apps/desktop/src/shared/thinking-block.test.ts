/**
 * The "Thinking…" block: reasoning streams live, folds away when the answer starts, and a person's
 * own toggle wins. These tests pin that behaviour without a DOM, so the rule is checked here and
 * the component only has to draw it.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { thinkingView } from './thinking-block.js'

test('no reasoning means no block, so a plain reply is unchanged', () => {
  assert.equal(thinkingView(undefined, true, false, null), null)
  assert.equal(thinkingView('', true, false, null), null)
  assert.equal(thinkingView('   \n ', true, false, null), null)
})

test('while only reasoning arrives the block is open and says it is still thinking', () => {
  const view = thinkingView('Check src/a.ts, then run the tests.', true, false, null)
  assert.ok(view)
  assert.equal(view.label, 'Thinking…')
  assert.equal(view.expanded, true, 'open by default: the reply would otherwise look empty')
  assert.equal(view.live, true)
  assert.equal(view.text, 'Check src/a.ts, then run the tests.')
})

test('once the answer starts the block folds away and the ellipsis goes', () => {
  const view = thinkingView('It is in src/a.ts.', true, true, null)
  assert.ok(view)
  assert.equal(view.label, 'Thinking')
  assert.equal(view.expanded, false)
  assert.equal(view.live, false)
  const done = thinkingView('It is in src/a.ts.', false, true, null)
  assert.ok(done)
  assert.equal(done.expanded, false)
})

test('a person who opened the block keeps it open, and can close it while it streams', () => {
  const kept = thinkingView('still going', false, true, true)
  assert.ok(kept)
  assert.equal(kept.expanded, true, 'reading the reasoning after the fact is allowed')
  const closed = thinkingView('still going', true, false, false)
  assert.ok(closed)
  assert.equal(closed.expanded, false, 'a deliberate collapse is not undone by the next token')
  assert.equal(closed.live, true)
})
