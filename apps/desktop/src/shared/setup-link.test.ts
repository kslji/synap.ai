import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseSetupLink, parseSetupModel, resolveSetupModel } from './setup-link'

test('setup links accept the registry id and the short name', () => {
  assert.equal(parseSetupModel('synap://setup?model=qwen3.5-4b-q4_k_m'), 'qwen3.5-4b-q4_k_m')
  assert.equal(parseSetupModel('synap://setup?model=qwen3.5-9b'), 'qwen3.5-9b-q4_k_m')
  assert.equal(parseSetupModel('qwen3.5-2b'), 'qwen3.5-2b-q4_k_m')
  assert.equal(parseSetupModel('4b'), 'qwen3.5-4b-q4_k_m')
})

test('a setup link can carry an absolute model path', () => {
  assert.deepEqual(parseSetupLink('synap://setup?model=4b&file=%2FUsers%2Fme%2FDownloads%2FQwen3.5-4B-Q4_K_M.gguf'), {
    modelId: 'qwen3.5-4b-q4_k_m',
    filePath: '/Users/me/Downloads/Qwen3.5-4B-Q4_K_M.gguf',
  })
  assert.equal(parseSetupLink('synap://setup?file=file:///tmp/model.gguf').filePath, '/tmp/model.gguf')
  assert.equal(parseSetupLink('synap://setup?model=qwen3.5-2b&file=downloads/model.gguf').filePath, null)
  assert.equal(parseSetupLink('synap://setup?model=nope&file=%2Ftmp%2Fmodel.gguf').modelId, null)
})

test('unknown setup links fall back to Qwen 2B', () => {
  assert.equal(parseSetupModel('synap://setup?model=grok-4.7'), null)
  assert.equal(parseSetupModel('synap://other?model=qwen3.5-4b'), null)
  assert.equal(parseSetupModel(''), null)
  assert.equal(resolveSetupModel(null), 'qwen3.5-2b-q4_k_m')
  assert.equal(resolveSetupModel('synap://setup?model=nope'), 'qwen3.5-2b-q4_k_m')
})
