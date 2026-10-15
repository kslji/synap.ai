import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { chatRequestFields } from './llama-client.js'
import { chatModelLabel } from '../../shared/model-label.js'
import { defaultForAgent, parseRegistry, pick, smallerChatModel } from './model-registry.js'

const registry = parseRegistry(JSON.parse(readFileSync(join(fileURLToPath(new URL('.', import.meta.url)), '../../../resources/models.registry.json'), 'utf8')))

test('general chat still picks the Q4 model for the RAM tier', () => {
  assert.equal(pick(registry, 'chat', 0).id, 'qwen3.5-2b-q4_k_m')
  assert.equal(pick(registry, 'chat', 1).id, 'qwen3.5-4b-q4_k_m')
  assert.equal(pick(registry, 'chat', 2).id, 'qwen3.5-9b-q4_k_m')
  assert.equal(pick(registry, 'chat', 3).id, 'qwen3.5-9b-q4_k_m')
})

test('Code lists only Qwen3.5 2B, 4B, and 9B, and defaults to 2B Q6_K', () => {
  const code = registry.models.filter((model) => model.agents?.includes('code'))
  assert.deepEqual(code.map((model) => model.id).sort(), [
    'qwen3.5-2b-q6_k',
    'qwen3.5-4b-q6_k',
    'qwen3.5-9b-q6_k',
  ])
  assert.equal(code.every((model) => model.family === 'qwen3.5'), true)
  const fallback = defaultForAgent(registry, 'code')
  assert.equal(fallback?.id, 'qwen3.5-2b-q6_k')
  assert.equal(fallback?.size_bytes, 1574961408)
  assert.equal(fallback?.peak_ram_gb, 1.74)
  assert.equal(chatModelLabel(fallback!), 'Qwen3.5 2B')
  const qwen4 = code.find((model) => model.id === 'qwen3.5-4b-q6_k')
  assert.equal(qwen4?.ram_measured, false)
  assert.equal(qwen4?.mmproj?.size_bytes, 672423616)
  assert.equal(code.find((model) => model.id === 'qwen3.5-2b-q6_k')?.mmproj?.size_bytes, 668227264)
})

test('a failed Code model offers the next smaller Qwen', () => {
  const code = registry.models.filter((model) => model.agents?.includes('code'))
  assert.equal(smallerChatModel(code, 'qwen3.5-9b-q6_k')?.id, 'qwen3.5-4b-q6_k')
  assert.equal(smallerChatModel(code, 'qwen3.5-4b-q6_k')?.id, 'qwen3.5-2b-q6_k')
  assert.equal(smallerChatModel(code, 'qwen3.5-2b-q6_k'), null)
})

test('chat requests use the registry sampling and template flags', () => {
  const qwen = registry.models.find((model) => model.id === 'qwen3.5-2b-q6_k')
  assert.deepEqual(chatRequestFields({ sampling: qwen?.sampling, chatTemplateKwargs: qwen?.chat_template_kwargs }), {
    temperature: 0.7,
    top_p: 0.8,
    top_k: 20,
    presence_penalty: 1.5,
    chat_template_kwargs: { enable_thinking: false },
  })
})
