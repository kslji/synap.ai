import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chatModelLabel, codeModelLine, fitMarkLabel, formatModelSize, modelChoiceLabel, modelMarkLabel, quantFromFile } from './model-label.js'

test('chat model names come from the registry family', () => {
  assert.equal(chatModelLabel({ family: 'qwen3.5', params_b: 9 }), 'Qwen 9B')
  assert.equal(chatModelLabel({ family: 'qwen3.5', params_b: 4 }), 'Qwen 4B')
  assert.equal(chatModelLabel({ family: 'qwen3.5', params_b: 2 }), 'Qwen 2B')
  assert.equal(chatModelLabel({ family: 'qwen3.5', params_b: null }), 'Qwen')
  assert.equal(chatModelLabel({ id: 'qwen3.5-2b-q4_k_m', family: 'qwen3.5', params_b: 2, label: 'Qwen3.5 2B' }), 'Qwen 2B')
  assert.equal(chatModelLabel({ id: 'gemma-4-e2b-q4_0', family: 'gemma4', params_b: 2, label: 'Gemma 4 E2B' }), 'Gemma 4 E2B')
  assert.equal(chatModelLabel({ id: 'gemma-4-e2b-q4_k_m', family: 'gemma-4', params_b: 2, label: 'Gemma 4 E2B (optional)' }), 'Gemma 4 E2B')
  assert.equal(chatModelLabel({ id: 'gemma-4-e4b-q4_k_m', family: 'gemma-4', params_b: 4 }), 'Gemma 4 E4B')
  assert.equal(chatModelLabel({ id: 'gemma-4-12b-q4_0', family: 'gemma4', params_b: 12, label: 'Gemma 4 12B' }), 'Gemma 12B')
  assert.equal(chatModelLabel({ id: 'qwen3-0.6b-q4_k_m', family: 'qwen3', params_b: 0.6, label: 'Qwen 0.6B draft' }), 'Qwen 0.6B')
  assert.equal(quantFromFile('Qwen3.5-9B-Q4_K_M.gguf'), 'Q4_K_M')
  assert.equal(quantFromFile('Qwen3.5-2B-Q6_K.gguf'), 'Q6_K')
  assert.equal(quantFromFile('gemma-4-E2B_q4_0-it.gguf'), 'Q4_0')
  assert.equal(quantFromFile('gemma-4-12b-it-qat-q4_0.gguf'), 'Q4_0')
  assert.doesNotMatch(chatModelLabel({ family: 'qwen3.5', params_b: 9 }), /Q4_K_M|Q6_K|gguf|3\.5/)
})

test('picker lines show download size and RAM', () => {
  assert.equal(formatModelSize(1574961408), '1.57 GB')
  assert.equal(formatModelSize(3525956768), '3.53 GB')
  assert.equal(formatModelSize(7458301152), '7.46 GB')
  assert.equal(formatModelSize(668227264), '0.67 GB')
  assert.equal(modelChoiceLabel({ label: 'Qwen3.5 2B', sizeBytes: 1574961408, minRamGb: 4 }), 'Qwen3.5 2B · 1.57 GB · needs 4 GB RAM')
  assert.equal(codeModelLine({ family: 'qwen3.5', sizeName: '2B', quant: 'Q6_K', sizeBytes: 1574961408, minRamGb: 4 }), 'Qwen3.5 · 2B · Q6_K · 1.57 GB · needs 4 GB RAM · 4 GB tier')
  assert.equal(fitMarkLabel('recommended'), 'Recommended')
  assert.equal(fitMarkLabel('fits'), 'Fits')
  assert.equal(fitMarkLabel('too-big'), 'Too big for this laptop')
  assert.doesNotMatch(modelChoiceLabel({ label: 'Qwen3.5 9B', sizeBytes: 7458301152, minRamGb: 8 }), /Q6_K|gguf/)
})

test('an alternative family is marked optional, not more accurate', () => {
  assert.equal(modelMarkLabel('qwen3.5-2b-q4_k_m', true), 'Recommended')
  assert.equal(modelMarkLabel('qwen3.5-4b-q4_k_m', false), 'More accurate')
  assert.equal(modelMarkLabel('gemma-4-e2b-q4_k_m', false), 'Optional')
})
