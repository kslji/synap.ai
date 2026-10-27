import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { EVAL_SAMPLING, chatRequestFields } from './llama-client.js'
import { codeFitMark, offeredOnLaptop, ramTierForFile } from '../../shared/code-ram.js'
import { chatModelLabel, quantFromFile } from '../../shared/model-label.js'
import { defaultForAgent, parseRegistry, pick, servesAgent, smallerChatModel } from './model-registry.js'
import { setupCatalog } from '../../shared/setup-choice.js'

const registry = parseRegistry(JSON.parse(readFileSync(join(fileURLToPath(new URL('.', import.meta.url)), '../../../resources/models.registry.json'), 'utf8')))
const GENERIC = 'qwen3.5-2b-q4_k_m'
const OPTIONAL = 'qwen3.5-4b-q4_k_m'
const GEMMA = 'gemma-4-e2b-q4_k_m'

test('the registry has one default chat model, two optional bigger ones, and the draft', () => {
  const chats = registry.models.filter((model) => model.role === 'chat')
  const main = chats.filter((model) => !model.agents?.includes('draft'))
  assert.deepEqual(main.map((model) => model.id), [GENERIC, OPTIONAL, GEMMA])
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
  // The 4B and Gemma stay available but are not what anything selects by itself.
  const optional = main[1]
  assert.equal(optional.default_for, undefined)
  assert.equal(optional.mmproj?.size_bytes, 672423616)
  const gemma = main[2]
  assert.equal(gemma.label, 'Gemma 4 E2B (optional)')
  assert.equal(gemma.family, 'gemma-4')
  assert.equal(gemma.default_for, undefined)
  assert.equal(gemma.file, 'gemma-4-E2B-it-Q4_K_M.gguf')
  assert.equal(gemma.size_bytes, 3106738272)
  assert.equal(gemma.sha256, '740185b21d22ceb83a11c3aa62ad5842ef32c70f6096d756bbee85a1e4ec34b8')
  assert.deepEqual(gemma.tiers, [0, 1, 2, 3])
  assert.equal(main.filter((row) => row.default_for?.includes('*')).length, 1)
})

test('Gemma 4 E2B is optional: offered, never picked, never in the first-run download', () => {
  const gemma = registry.models.find((model) => model.id === GEMMA)
  assert.ok(gemma)
  // Offered in the Offline picker for every agent and tier, and deletable like any chat model.
  assert.equal(servesAgent(gemma, 'general'), true)
  assert.equal(servesAgent(gemma, 'code'), true)
  assert.equal(gemma.role, 'chat')
  assert.equal(gemma.label, 'Gemma 4 E2B (optional)')
  assert.equal(chatModelLabel(gemma), 'Gemma 4 E2B')
  // Never selected by a pick, a default, or a step-down.
  for (const tier of [0, 1, 2, 3]) assert.equal(pick(registry, 'chat', tier, 'code').id, GENERIC)
  assert.equal(defaultForAgent(registry, 'general')?.id, GENERIC)
  const chats = registry.models.filter((model) => model.role === 'chat' && servesAgent(model, 'general'))
  assert.notEqual(smallerChatModel(chats, GENERIC)?.id, GEMMA)
  // Never auto-downloaded: the first-run catalog is the starter ids only.
  assert.equal(setupCatalog(registry.models).some((model) => model.id === GEMMA), false)
})

test('the search files are the Jina code embedding and its reranker', () => {
  const embedding = registry.models.find((model) => model.role === 'embedding')
  const reranker = registry.models.find((model) => model.role === 'reranker')
  assert.ok(embedding)
  assert.ok(reranker)
  assert.equal(embedding.id, 'jina-embeddings-v2-base-code-q5_k_m')
  assert.equal(embedding.spec_id, 'jina-embeddings-v2-base-code@256')
  assert.equal(embedding.family, 'jina')
  assert.equal(embedding.dim, 256)
  assert.equal(embedding.native_dim, 768)
  assert.equal(embedding.query_prefix, '')
  assert.equal(embedding.doc_template, '{title}\n{text}')
  assert.equal(embedding.bundled_with_chat, true)
  assert.equal(embedding.file, 'jina-embeddings-v2-base-code-Q5_K_M.gguf')
  assert.equal(embedding.size_bytes, 121395616)
  assert.equal(reranker.id, 'jina-reranker-v1-turbo-en-q5_k_m')
  assert.equal(reranker.bundled_with_chat, true)
  assert.equal(reranker.file, 'jina-reranker-v1-turbo-en-Q5_K_M.gguf')
  assert.equal(reranker.size_bytes, 37323936)
  assert.equal(registry.models.filter((model) => model.role === 'embedding').length, 1)
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
