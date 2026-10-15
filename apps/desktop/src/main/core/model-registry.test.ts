import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { chatRequestFields } from './llama-client.js'
import { codeFitMark, ramTierForFile } from '../../shared/code-ram.js'
import { chatModelLabel, codeModelLine } from '../../shared/model-label.js'
import { defaultForAgent, parseRegistry, pick, smallerChatModel } from './model-registry.js'

const registry = parseRegistry(JSON.parse(readFileSync(join(fileURLToPath(new URL('.', import.meta.url)), '../../../resources/models.registry.json'), 'utf8')))

test('general chat still picks the Q4 model for the RAM tier', () => {
  assert.equal(pick(registry, 'chat', 0).id, 'qwen3.5-2b-q4_k_m')
  assert.equal(pick(registry, 'chat', 1).id, 'qwen3.5-4b-q4_k_m')
  assert.equal(pick(registry, 'chat', 2).id, 'qwen3.5-9b-q4_k_m')
  assert.equal(pick(registry, 'chat', 3).id, 'qwen3.5-9b-q4_k_m')
})

test('Code defaults to Qwen3.5 2B and lists Gemma 4 as optional', () => {
  const code = registry.models.filter((model) => model.agents?.includes('code'))
  assert.deepEqual(code.map((model) => model.id).sort(), [
    'gemma-4-12b-q4_k_m',
    'gemma-4-e2b-q4_k_m',
    'gemma-4-e4b-q4_0',
    'qwen3.5-2b-q6_k',
    'qwen3.5-4b-q6_k',
    'qwen3.5-9b-q6_k',
  ])
  assert.equal(code.some((model) => model.family.startsWith('granite')), false)
  const fallback = defaultForAgent(registry, 'code')
  assert.equal(fallback?.id, 'qwen3.5-2b-q6_k')
  assert.equal(fallback?.family, 'qwen3.5')
  assert.equal(code.filter((model) => model.default_for?.includes('code')).map((model) => model.id).join(','), 'qwen3.5-2b-q6_k')
  assert.equal(fallback?.size_bytes, 1574961408)
  assert.equal(fallback?.peak_ram_gb, 1.74)
  assert.equal(chatModelLabel(fallback!), 'Qwen3.5 2B')
  const e2b = code.find((model) => model.id === 'gemma-4-e2b-q4_k_m')
  const e4b = code.find((model) => model.id === 'gemma-4-e4b-q4_0')
  const g12 = code.find((model) => model.id === 'gemma-4-12b-q4_k_m')
  assert.equal(e2b?.size_bytes, 3106738272)
  assert.equal(e4b?.size_bytes, 4590807392)
  assert.equal(g12?.size_bytes, 7121861440)
  for (const model of code) assert.equal(model.min_ram_gb, ramTierForFile(model.size_bytes))
  assert.equal(codeModelLine({
    family: e2b!.family,
    sizeName: e2b!.size_name,
    quant: 'Q4_K_M',
    sizeBytes: e2b!.size_bytes,
    minRamGb: e2b!.min_ram_gb,
  }), 'Gemma 4 · E2B · Q4_K_M · 3.11 GB · needs 16 GB RAM · 16 GB tier')
})

test('a failed Code model steps down inside the family, then to Qwen', () => {
  const code = registry.models.filter((model) => model.agents?.includes('code'))
  assert.equal(smallerChatModel(code, 'qwen3.5-9b-q6_k')?.id, 'qwen3.5-4b-q6_k')
  assert.equal(smallerChatModel(code, 'qwen3.5-4b-q6_k')?.id, 'qwen3.5-2b-q6_k')
  assert.equal(smallerChatModel(code, 'qwen3.5-2b-q6_k'), null)
  assert.equal(smallerChatModel(code, 'gemma-4-12b-q4_k_m')?.id, 'gemma-4-e4b-q4_0')
  assert.equal(smallerChatModel(code, 'gemma-4-e4b-q4_0')?.id, 'gemma-4-e2b-q4_k_m')
  assert.equal(smallerChatModel(code, 'gemma-4-e2b-q4_k_m')?.id, 'qwen3.5-2b-q6_k')
})

test('Qwen3.5 2B stays Recommended, and the file cap marks the rest', () => {
  const code = registry.models.filter((model) => model.agents?.includes('code'))
  const marks = (ram: number) => Object.fromEntries(code.map((model) => [model.id, codeFitMark({
    family: model.family,
    sizeBytes: model.size_bytes,
    defaultFor: model.default_for,
  }, ram)]))
  assert.deepEqual(marks(3.8), {
    'qwen3.5-2b-q6_k': 'recommended',
    'qwen3.5-4b-q6_k': 'too-big',
    'qwen3.5-9b-q6_k': 'too-big',
    'gemma-4-e2b-q4_k_m': 'too-big',
    'gemma-4-e4b-q4_0': 'too-big',
    'gemma-4-12b-q4_k_m': 'too-big',
  })
  assert.equal(marks(8)['qwen3.5-2b-q6_k'], 'recommended')
  assert.equal(marks(8)['gemma-4-e2b-q4_k_m'], 'too-big')
  assert.equal(marks(15.6)['qwen3.5-4b-q6_k'], 'fits')
  assert.equal(marks(15.6)['gemma-4-e2b-q4_k_m'], 'fits')
  assert.equal(marks(15.6)['gemma-4-e4b-q4_0'], 'too-big')
  assert.equal(marks(31.2)['qwen3.5-9b-q6_k'], 'fits')
  assert.equal(marks(31.2)['gemma-4-12b-q4_k_m'], 'fits')
  assert.equal(marks(31.2)['qwen3.5-2b-q6_k'], 'recommended')
})

test('chat requests use the registry sampling and template flags', () => {
  const qwen = registry.models.find((model) => model.id === 'qwen3.5-2b-q6_k')
  const gemma = registry.models.find((model) => model.id === 'gemma-4-e2b-q4_k_m')
  assert.deepEqual(chatRequestFields({ sampling: qwen?.sampling, chatTemplateKwargs: qwen?.chat_template_kwargs }), {
    temperature: 0.7,
    top_p: 0.8,
    top_k: 20,
    presence_penalty: 1.5,
    chat_template_kwargs: { enable_thinking: false },
  })
  assert.deepEqual(chatRequestFields({ sampling: gemma?.sampling, chatTemplateKwargs: gemma?.chat_template_kwargs }), {
    temperature: 1,
    top_p: 0.95,
    top_k: 64,
    chat_template_kwargs: { enable_thinking: false },
  })
})
