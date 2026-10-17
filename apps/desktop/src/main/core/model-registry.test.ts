import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { EVAL_SAMPLING, chatRequestFields } from './llama-client.js'
import { codeFitMark, ramTierForFile } from '../../shared/code-ram.js'
import { chatModelLabel, codeModelLine, quantFromFile } from '../../shared/model-label.js'
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
    'gemma-4-12b-q4_0',
    'gemma-4-e2b-q4_0',
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
  assert.equal(chatModelLabel(fallback!), 'Qwen 2B')
  const e2b = code.find((model) => model.id === 'gemma-4-e2b-q4_0')
  const e4b = code.find((model) => model.id === 'gemma-4-e4b-q4_0')
  const g12 = code.find((model) => model.id === 'gemma-4-12b-q4_0')
  assert.equal(e2b?.size_bytes, 3349516256)
  assert.equal(e2b?.sha256, 'fa401b55b07ee70a54c6dae3903c783a6e65064312529ea57175cb5f8dec6634')
  assert.equal(e2b?.mmproj?.size_bytes, 986833664)
  assert.equal(e2b?.mmproj?.sha256, '021059cce659fe7f9170d5599761d7bbaf644b798dab9503aca30dc43e6beb14')
  assert.equal(e2b?.min_ram_gb, 8)
  assert.equal(e4b?.size_bytes, 5154941280)
  assert.equal(e4b?.sha256, '676c35070db6dbe52f93e9c864ee0fba4eddea94b9c875d9cb10daff453fbaee')
  assert.equal(e4b?.mmproj?.size_bytes, 991552256)
  assert.equal(e4b?.mmproj?.sha256, '7498a37cb619e55f2fcf87eb931f56e99389ed6d432e4c5c66110694c0d65578')
  assert.equal(e4b?.min_ram_gb, 16)
  assert.equal(g12?.size_bytes, 6975879296)
  assert.equal(g12?.sha256, '93567e57a8fe10b23569b9d9ec38cd005deedf71e29477c421a4b83f418a538b')
  assert.equal(g12?.mmproj?.size_bytes, 175115616)
  assert.equal(g12?.mmproj?.sha256, 'cb018338a7538a9814d994bfe54644c71eb7ed54e31eae2f721e45fd3c260da7')
  assert.equal(g12?.min_ram_gb, 32)
  assert.equal(quantFromFile(e2b!.file), 'Q4_0')
  assert.equal(quantFromFile(g12!.file), 'Q4_0')
  for (const model of code.filter((row) => row.family === 'qwen3.5')) {
    assert.equal(model.min_ram_gb, ramTierForFile(model.size_bytes))
  }
  assert.equal(codeModelLine({
    family: e2b!.family,
    sizeName: e2b!.size_name,
    quant: 'Q4_0',
    sizeBytes: e2b!.size_bytes,
    minRamGb: e2b!.min_ram_gb,
  }), 'Gemma 4 · E2B · Q4_0 · 3.35 GB · needs 8 GB RAM · 8 GB tier')
})

test('a failed Code model steps down inside the family, then to Qwen', () => {
  const code = registry.models.filter((model) => model.agents?.includes('code'))
  assert.equal(smallerChatModel(code, 'qwen3.5-9b-q6_k')?.id, 'qwen3.5-4b-q6_k')
  assert.equal(smallerChatModel(code, 'qwen3.5-4b-q6_k')?.id, 'qwen3.5-2b-q6_k')
  assert.equal(smallerChatModel(code, 'qwen3.5-2b-q6_k'), null)
  assert.equal(smallerChatModel(code, 'gemma-4-12b-q4_0')?.id, 'gemma-4-e4b-q4_0')
  assert.equal(smallerChatModel(code, 'gemma-4-e4b-q4_0')?.id, 'gemma-4-e2b-q4_0')
  assert.equal(smallerChatModel(code, 'gemma-4-e2b-q4_0')?.id, 'qwen3.5-2b-q6_k')
})

test('a 4 GB laptop lists Qwen3.5 2B only, and Gemma follows its RAM tier', () => {
  const code = registry.models.filter((model) => model.agents?.includes('code'))
  const offered = (ram: number) => code.filter((model) => codeFitMark({
    family: model.family,
    minRamGb: model.min_ram_gb,
    defaultFor: model.default_for,
  }, ram) !== 'too-big').map((model) => model.id).sort()
  assert.deepEqual(offered(3.8), ['qwen3.5-2b-q6_k'])
  assert.deepEqual(offered(8), ['gemma-4-e2b-q4_0', 'qwen3.5-2b-q6_k'])
  assert.deepEqual(offered(15.6), ['gemma-4-e2b-q4_0', 'gemma-4-e4b-q4_0', 'qwen3.5-2b-q6_k', 'qwen3.5-4b-q6_k'])
  assert.deepEqual(offered(31.2), [
    'gemma-4-12b-q4_0',
    'gemma-4-e2b-q4_0',
    'gemma-4-e4b-q4_0',
    'qwen3.5-2b-q6_k',
    'qwen3.5-4b-q6_k',
    'qwen3.5-9b-q6_k',
  ])
  assert.equal(codeFitMark({ family: 'qwen3.5', minRamGb: 4, defaultFor: ['code'] }, 3.8), 'recommended')
  assert.equal(codeFitMark({ family: 'gemma4', minRamGb: 8 }, 8), 'fits')
})

test('chat requests use the registry sampling and template flags', () => {
  const qwen = registry.models.find((model) => model.id === 'qwen3.5-2b-q6_k')
  const gemma = registry.models.find((model) => model.id === 'gemma-4-e2b-q4_0')
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
  assert.deepEqual(chatRequestFields({ sampling: { ...EVAL_SAMPLING }, chatTemplateKwargs: { enable_thinking: false } }), {
    temperature: 0,
    top_p: 1,
    top_k: 1,
    presence_penalty: 0,
    repeat_penalty: 1,
    seed: 20261010,
    chat_template_kwargs: { enable_thinking: false },
  })
})
