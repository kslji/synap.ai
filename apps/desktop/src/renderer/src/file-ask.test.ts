import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyEvent } from './types.js'

test('a file permission card is attached to the pending reply', () => {
  const next = applyEvent(
    [{ id: 'p1', role: 'assistant', text: '', sources: [], tools: [], pending: true }],
    {
      type: 'file-ask',
      messageId: 'm1',
      prompt: {
        id: 'm1',
        messageId: 'm1',
        label: '~/Documents',
        path: '/Users/me/Documents',
        question: 'Allow Synap.surf to search ~/Documents?',
      },
    },
  )
  assert.equal(next[0]?.fileAsk?.question, 'Allow Synap.surf to search ~/Documents?')
  assert.equal(next[0]?.phase, 'files')
  const done = applyEvent(next, { type: 'done', messageId: 'm1', gate: 'answer', text: 'Found it. [S1]' })
  assert.equal(done[0]?.fileAsk, null)
  assert.equal(done[0]?.pending, false)
})
