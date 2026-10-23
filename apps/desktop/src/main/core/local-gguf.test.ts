import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { formatModelSize } from '../../shared/model-label.js'
import { STARTER_CHAT_MODEL_ID, LOCAL_CHAT_MODEL_ID } from '../../shared/starter-model.js'
import { isGgufName, parseLocalPointer, planLocalGguf, type RegistryFile } from './local-gguf.js'

const registryPath = join(dirname(fileURLToPath(import.meta.url)), '../../../resources/models.registry.json')

test('the generic Qwen 4B row is the file the first-run card offers', () => {
  const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as { models: RegistryFile[] }
  const starter = registry.models.find((model) => model.id === STARTER_CHAT_MODEL_ID)
  assert.ok(starter)
  assert.equal(starter.role, 'chat')
  assert.equal(starter.file, 'Qwen3.5-2B-Q4_K_M.gguf')
  assert.equal(starter.size_bytes, 1_280_835_840)
  assert.equal(formatModelSize(starter.size_bytes), '1.28 GB')
})

test('a file with the registry size selects that model, and any other GGUF stays local', () => {
  const models: RegistryFile[] = [
    { id: STARTER_CHAT_MODEL_ID, role: 'chat', size_bytes: 100, file: 'Qwen3.5-2B-Q4_K_M.gguf' },
    { id: 'embeddinggemma-2-text-q8_0', role: 'embedding', size_bytes: 50, file: 'embeddinggemma-2-Q8_0.gguf' },
  ]
  const matched = planLocalGguf({ sourcePath: '/models/Qwen3.5-2B-Q4_K_M.gguf', bytes: 100, models })
  assert.equal(matched.modelId, STARTER_CHAT_MODEL_ID)
  assert.equal(matched.file, 'Qwen3.5-2B-Q4_K_M.gguf')
  const other = planLocalGguf({ sourcePath: '/home/me/custom.gguf', bytes: 50, models })
  assert.equal(other.modelId, LOCAL_CHAT_MODEL_ID)
  assert.equal(other.file, '/home/me/custom.gguf')
  assert.equal(other.name, 'custom.gguf')
  assert.equal(isGgufName('Model.GGUF'), true)
  assert.equal(isGgufName('notes.txt'), false)
})

test('a saved pointer must be a GGUF path with a size', () => {
  const ok = parseLocalPointer({ path: '/m/a.gguf', bytes: 10, name: 'a.gguf', modelId: 'local-gguf', file: '/m/a.gguf' })
  assert.equal(ok?.modelId, 'local-gguf')
  assert.equal(parseLocalPointer({ path: '/m/a.bin', bytes: 10, modelId: 'x', file: 'a.bin' }), null)
  assert.equal(parseLocalPointer({ path: '/m/a.gguf', bytes: 0, modelId: 'x', file: 'a.gguf' }), null)
  assert.equal(parseLocalPointer(null), null)
})
