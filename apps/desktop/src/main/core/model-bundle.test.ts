import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { parseRegistry } from './model-registry.js'
import { bundling, legacySearchFiles, missingBundleFiles } from './model-bundle.js'
import { deleteBlockedReason, setupEmbedding, setupReranker } from '../../shared/setup-choice.js'

const registry = parseRegistry(JSON.parse(readFileSync(join(fileURLToPath(new URL('.', import.meta.url)), '../../../resources/models.registry.json'), 'utf8')))
const embedding = setupEmbedding(registry.models)
const reranker = setupReranker(registry.models)
const chat = registry.models.find((model) => model.id === 'qwen3.5-2b-q4_k_m')
if (!chat || !embedding || !reranker) throw new Error('registry is missing the offline bundle')

const asDownload = (model: { id: string; role: string; file: string; url: string; sha256: string; size_bytes: number }) => ({
  id: model.id,
  role: model.role,
  file: model.file,
  url: model.url,
  sha256: model.sha256,
  sizeBytes: model.size_bytes,
})

const searchFiles = [{ ...embedding, role: 'embedding' }, { ...reranker, role: 'reranker' }]

test('a chat download brings the search and rerank files that are missing on disk', () => {
  const files = missingBundleFiles(asDownload(chat), searchFiles, new Set())
  assert.deepEqual(files.map((file) => file.role), ['chat', 'embedding', 'reranker'])
  assert.equal(files[0].sizeBytes, 1_280_835_840)
  assert.equal(files[1].file, 'jina-embeddings-v2-base-code-Q5_K_M.gguf')
  assert.equal(files[2].file, 'jina-reranker-v1-turbo-en-Q5_K_M.gguf')
  // A reranker already on disk is not fetched twice.
  const partial = missingBundleFiles(asDownload(chat), searchFiles, new Set([reranker.file]))
  assert.deepEqual(partial.map((file) => file.role), ['chat', 'embedding'])
  const none = missingBundleFiles(asDownload(chat), searchFiles, new Set([embedding.file, reranker.file]))
  assert.deepEqual(none.map((file) => file.role), ['chat'])
})

test('the disk check covers the whole bundle plus ten percent', () => {
  const files = missingBundleFiles(asDownload(chat), searchFiles, new Set())
  const total = 1_280_835_840 + 121_395_616 + 37_323_936
  assert.equal(bundling(files), Math.ceil(total * 1.1))
  assert.equal(bundling([]), 0)
})

test('only the retired search file is deleted, never the current one', () => {
  const retired = ['embedding', 'gemma', '-2-Q8_0.gguf'].join('')
  const entries = [chat.file, embedding.file, reranker.file, retired, 'notes.txt']
  assert.deepEqual(legacySearchFiles(entries), [retired])
  assert.deepEqual(legacySearchFiles([...entries.filter((name) => name !== retired)]), [])
})

test('the bundled search files cannot be deleted while an offline chat model is installed', () => {
  assert.match(deleteBlockedReason('embedding', true) ?? '', /installed/)
  assert.match(deleteBlockedReason('reranker', true) ?? '', /installed/)
  assert.equal(deleteBlockedReason('embedding', false), null)
  assert.equal(deleteBlockedReason('reranker', false), null)
  assert.equal(deleteBlockedReason('chat', true), null)
})
