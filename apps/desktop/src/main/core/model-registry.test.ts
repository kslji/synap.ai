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

test('Code defaults to Qwen3.5 2B Q6_K and lists Gemma and Granite without making Gemma the default', () => {
  const code = registry.models.filter((model) => model.agents?.includes('code'))
  const ids = code.map((model) => model.id).sort()
  assert.deepEqual(ids, [
    'gemma-4-e2b-q4_k_m',
    'gemma-4-e4b-q6_k',
    'granite-4.2-3b-q6_k',
    'granite-4.2-8b-q6_k',
    'qwen3.5-2b-q6_k',
    'qwen3.5-4b-q6_k',
    'qwen3.5-9b-q6_k',
  ])
  const fallback = defaultForAgent(registry, 'code')
  assert.equal(fallback?.id, 'qwen3.5-2b-q6_k')
  assert.equal(fallback?.size_bytes, 1574961408)
  assert.equal(fallback?.peak_ram_gb, 1.74)
  assert.equal(chatModelLabel(fallback!), 'Qwen3.5 2B')
  assert.equal(code.filter((model) => model.family.startsWith('gemma') && model.default_for?.includes('code')).length, 0)
  assert.equal(code.filter((model) => model.min_ram_gb === 4).map((model) => model.family).sort().join(','), 'gemma4,granite-4.2,qwen3.5')
  assert.equal(code.filter((model) => model.min_ram_gb === 8).map((model) => model.family).sort().join(','), 'gemma4,granite-4.2,qwen3.5')
  const qwen4 = code.find((model) => model.id === 'qwen3.5-4b-q6_k')
  assert.equal(qwen4?.ram_measured, false)
  assert.equal(qwen4?.mmproj?.size_bytes, 672423616)
})

test('a failed Code model offers a smaller model in the same family, then Qwen', () => {
  const code = registry.models.filter((model) => model.agents?.includes('code'))
  assert.equal(smallerChatModel(code, 'qwen3.5-9b-q6_k')?.id, 'qwen3.5-4b-q6_k')
  assert.equal(smallerChatModel(code, 'qwen3.5-4b-q6_k')?.id, 'qwen3.5-2b-q6_k')
  assert.equal(smallerChatModel(code, 'qwen3.5-2b-q6_k'), null)
  assert.equal(smallerChatModel(code, 'gemma-4-e4b-q6_k')?.id, 'gemma-4-e2b-q4_k_m')
  assert.equal(smallerChatModel(code, 'granite-4.2-8b-q6_k')?.id, 'granite-4.2-3b-q6_k')
  assert.equal(smallerChatModel(code, 'granite-4.2-3b-q6_k')?.id, 'qwen3.5-2b-q6_k')
})

test('chat requests use the registry sampling and template flags', () => {
  const gemma = registry.models.find((model) => model.id === 'gemma-4-e4b-q6_k')
  const qwen = registry.models.find((model) => model.id === 'qwen3.5-2b-q6_k')
  assert.deepEqual(chatRequestFields({ sampling: gemma?.sampling, chatTemplateKwargs: gemma?.chat_template_kwargs }), {
    temperature: 1,
    top_p: 0.95,
    top_k: 64,
    chat_template_kwargs: { enable_thinking: false },
  })
  assert.deepEqual(chatRequestFields({ sampling: qwen?.sampling, chatTemplateKwargs: qwen?.chat_template_kwargs }), {
    temperature: 0.7,
    top_p: 0.8,
    top_k: 20,
    presence_penalty: 1.5,
    chat_template_kwargs: { enable_thinking: false },
  })
})
