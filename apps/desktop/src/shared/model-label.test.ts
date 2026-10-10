import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chatModelLabel, quantFromFile } from './model-label.js'

test('chat models use a short Qwen3.5 name', () => {
  assert.equal(chatModelLabel(9), 'Qwen3.5 9B')
  assert.equal(chatModelLabel(4), 'Qwen3.5 4B')
  assert.equal(chatModelLabel(2), 'Qwen3.5 2B')
  assert.equal(chatModelLabel(null), 'Qwen3.5')
  assert.equal(quantFromFile('Qwen3.5-9B-Q4_K_M.gguf'), 'Q4_K_M')
  assert.doesNotMatch(chatModelLabel(9), /Q4_K_M|gguf/)
})
