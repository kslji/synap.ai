import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { EVAL_SAMPLING, chatRequestFields } from './llama-client.js'
import { codeFitMark, offeredOnLaptop, ramTierForFile } from '../../shared/code-ram.js'
import { chatModelLabel, quantFromFile } from '../../shared/model-label.js'
import { defaultForAgent, parseRegistry, pick, servesAgent, smallerChatModel } from './model-registry.js'

const registry = parseRegistry(JSON.parse(readFileSync(join(fileURLToPath(new URL('.', import.meta.url)), '../../../resources/models.registry.json'), 'utf8')))
const GENERIC = 'qwen3.5-2b-q4_k_m'
const OPTIONAL = 'qwen3.5-4b-q4_k_m'

test('the registry has one default chat model, an optional bigger one, and the draft', () => {
  const chats = registry.models.filter((model) => model.role === 'chat')
  const main = chats.filter((model) => !model.agents?.includes('draft'))
  assert.deepEqual(main.map((model) => model.id), [GENERIC, OPTIONAL])
  const model = main[0]
  assert.equal(model.min_ram_gb, 8)
  assert.equal(model.size_bytes, 1280835840)
  assert.equal(model.sha256, 'aaf42c8b7c3cab2bf3d69c355048d4a0ee9973d48f16c731c0520ee914699223')
  assert.deepEqual(model.default_for, ['*'])
  assert.equal(quantFromFile(model.file), 'Q4_K_M')
  assert.equal(chatModelLabel(model), 'Qwen 2B')
  // The file itself would sit on a 4 GB laptop; the registry still asks 8 GB for context and the OS.
  assert.equal(ramTierForFile(model.size_bytes), 4)
  assert.equal(offeredOnLaptop(model.min_ram_gb, 4), false)
  assert.equal(offeredOnLaptop(model.min_ram_gb, 8), true)
  assert.equal(registry.models.some((model) => model.family.startsWith('gemma4')), false)
  // The 4B stays available but is not what anything selects by itself.
  const optional = main[1]
  assert.equal(optional.default_for, undefined)
  assert.equal(optional.mmproj?.size_bytes, 672423616)
})

test('every tier and every agent uses the default model', () => {
  for (const tier of [0, 1, 2, 3]) assert.equal(pick(registry, 'chat', tier).id, GENERIC)
  for (const agent of ['general', 'assistant', 'code', 'construction', 'marine', 'pilot']) {
    assert.equal(pick(registry, 'chat', 1, agent).id, GENERIC)
  }
  assert.equal(defaultForAgent(registry, 'code')?.id, GENERIC)
  const draft = registry.models.find((model) => model.agents?.includes('draft'))
  assert.ok(draft)
  assert.equal(servesAgent(draft, 'general'), false)
  assert.equal(servesAgent(draft, 'code'), false)
  assert.equal(servesAgent({}, 'code'), true)
})

test('stepping down from the optional 4B lands on the 2B, and nothing is smaller than the 2B', () => {
  const chats = registry.models.filter((model) => model.role === 'chat' && servesAgent(model, 'general'))
  assert.equal(smallerChatModel(chats, GENERIC), null)
  assert.equal(smallerChatModel(chats, OPTIONAL)?.id, GENERIC)
  assert.equal(codeFitMark({ family: 'qwen3.5', minRamGb: 8, defaultFor: ['*'] }, 8), 'recommended')
  assert.equal(codeFitMark({ family: 'qwen3.5', minRamGb: 16 }, 8), 'too-big')
})

test('chat requests use the registry sampling and template flags', () => {
  const qwen = registry.models.find((model) => model.id === GENERIC)
  assert.deepEqual(chatRequestFields({ sampling: qwen?.sampling, chatTemplateKwargs: qwen?.chat_template_kwargs }), {
    temperature: 0.7,
    top_p: 0.8,
    top_k: 20,
    presence_penalty: 1.5,
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
