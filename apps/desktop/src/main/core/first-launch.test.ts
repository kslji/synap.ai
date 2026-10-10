import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { firstLaunchPlan } from './first-launch.js'
import { downloadVerified } from './model-download.js'
import { parseRegistry } from './model-registry.js'

const registry = parseRegistry(JSON.parse(readFileSync(join(fileURLToPath(new URL('.', import.meta.url)), '../../../resources/models.registry.json'), 'utf8')))

test('first launch picks the chat model for the RAM tier and skips when both files are present', () => {
  const none = () => false
  assert.equal(firstLaunchPlan({ tier: 0, registry, installed: none }).chat.id, 'qwen3.5-2b-q4_k_m')
  assert.equal(firstLaunchPlan({ tier: 1, registry, installed: none }).chat.id, 'qwen3.5-4b-q4_k_m')
  assert.equal(firstLaunchPlan({ tier: 2, registry, installed: none }).chat.id, 'qwen3.5-9b-q4_k_m')
  assert.equal(firstLaunchPlan({ tier: 3, registry, installed: none }).chat.id, 'qwen3.5-9b-q4_k_m')
  for (const tier of [0, 1, 2, 3]) {
    const plan = firstLaunchPlan({ tier, registry, installed: none })
    assert.equal(plan.embed.id, 'embeddinggemma-2-text-q8_0')
    assert.equal(plan.skip, false)
  }
  const present = firstLaunchPlan({ tier: 1, registry, installed: () => true })
  assert.equal(present.skip, true)
})

test('a model download resumes from the part file', async () => {
  const root = mkdtempSync(join(tmpdir(), 'surf-model-'))
  const dest = join(root, 'model.gguf')
  const full = Buffer.from('abcdefghij')
  writeFileSync(`${dest}.part`, full.subarray(0, 4))
  const sha256 = createHash('sha256').update(full).digest('hex')
  try {
    await downloadVerified({ url: 'http://127.0.0.1/model.gguf', dest, size: full.length, sha256 }, undefined, undefined, async (_url, init) => {
      assert.equal(new Headers(init?.headers).get('range'), 'bytes=4-')
      return new Response(full.subarray(4), { status: 206 })
    })
    assert.equal(readFileSync(dest).equals(full), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a bad checksum deletes the part file', async () => {
  const root = mkdtempSync(join(tmpdir(), 'surf-model-bad-'))
  const dest = join(root, 'model.gguf')
  const body = Buffer.from('not the model')
  try {
    await assert.rejects(
      () => downloadVerified(
        { url: 'http://127.0.0.1/model.gguf', dest, size: body.length, sha256: '0'.repeat(64) },
        undefined,
        undefined,
        async () => new Response(body),
      ),
      /sha256 mismatch/,
    )
    assert.equal(existsSync(dest), false)
    assert.equal(existsSync(`${dest}.part`), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
