import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseSetupLink, parseSetupModel, resolveSetupModel } from './setup-link'

const MODEL = 'qwen3.5-2b-q4_k_m'
const OPTIONAL = 'qwen3.5-4b-q4_k_m'

test('setup links accept the registry id, a 4B link keeps the optional 4B, and 9B links fall back to the 2B', () => {
  assert.equal(parseSetupModel('synap://setup?model=qwen3.5-4b-q4_k_m'), OPTIONAL)
  assert.equal(parseSetupModel('synap://setup?model=qwen3.5-2b-q4_k_m'), MODEL)
  assert.equal(parseSetupModel('synap://setup?model=qwen3.5-9b'), MODEL)
  assert.equal(parseSetupModel('qwen3.5-2b'), MODEL)
  assert.equal(parseSetupModel('4b'), OPTIONAL)
  assert.equal(parseSetupModel('9b'), MODEL)
})

test('a setup link can carry an absolute model path', () => {
  assert.deepEqual(parseSetupLink('synap://setup?model=4b&file=%2FUsers%2Fme%2FDownloads%2FQwen3.5-4B-Q4_K_M.gguf'), {
    modelId: OPTIONAL,
    filePath: '/Users/me/Downloads/Qwen3.5-4B-Q4_K_M.gguf',
  })
  assert.equal(parseSetupLink('synap://setup?file=file:///tmp/model.gguf').filePath, '/tmp/model.gguf')
  assert.equal(parseSetupLink('synap://setup?model=4b&file=downloads/model.gguf').filePath, null)
  assert.equal(parseSetupLink('synap://setup?model=nope&file=%2Ftmp%2Fmodel.gguf').modelId, null)
})

test('unknown setup links fall back to the one model', () => {
  assert.equal(parseSetupModel('synap://setup?model=grok-4.7'), null)
  assert.equal(parseSetupModel('synap://other?model=qwen3.5-4b'), null)
  assert.equal(parseSetupModel(''), null)
  assert.equal(resolveSetupModel(null), MODEL)
  assert.equal(resolveSetupModel('synap://setup?model=nope'), MODEL)
})
