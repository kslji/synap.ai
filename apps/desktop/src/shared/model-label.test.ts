import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chatModelLabel, formatModelSize, modelChoiceLabel, quantFromFile } from './model-label.js'

test('chat model names come from the registry family', () => {
  assert.equal(chatModelLabel({ family: 'qwen3.5', params_b: 9 }), 'Qwen3.5 9B')
  assert.equal(chatModelLabel({ family: 'qwen3.5', params_b: 4 }), 'Qwen3.5 4B')
  assert.equal(chatModelLabel({ family: 'qwen3.5', params_b: 2 }), 'Qwen3.5 2B')
  assert.equal(chatModelLabel({ family: 'qwen3.5', params_b: null }), 'Qwen3.5')
  assert.equal(chatModelLabel({ family: 'granite-4.2', params_b: 3 }), 'Granite 4.2 3B')
  assert.equal(chatModelLabel({ family: 'gemma4', params_b: 2, label: 'Gemma 4 E2B' }), 'Gemma 4 E2B')
  assert.equal(quantFromFile('Qwen3.5-9B-Q4_K_M.gguf'), 'Q4_K_M')
  assert.equal(quantFromFile('Qwen3.5-2B-Q6_K.gguf'), 'Q6_K')
  assert.doesNotMatch(chatModelLabel({ family: 'qwen3.5', params_b: 9 }), /Q4_K_M|Q6_K|gguf/)
})

test('picker lines show download size and RAM', () => {
  assert.equal(formatModelSize(1574961408), '1.57 GB')
  assert.equal(formatModelSize(3525956768), '3.53 GB')
  assert.equal(formatModelSize(7458301152), '7.46 GB')
  assert.equal(formatModelSize(668227264), '0.67 GB')
  assert.equal(modelChoiceLabel({ label: 'Qwen3.5 2B', sizeBytes: 1574961408, minRamGb: 2 }), 'Qwen3.5 2B · 1.57 GB · needs 2 GB RAM')
  assert.doesNotMatch(modelChoiceLabel({ label: 'Qwen3.5 9B', sizeBytes: 7458301152, minRamGb: 8 }), /Q6_K|gguf/)
})
