import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createHash } from 'node:crypto'
import { hashFile, registryEntries, verifyFile } from './model-weights.mjs'

test('verifyFile accepts a matching hash and rejects a different file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'surf-weights-'))
  try {
    const path = join(dir, 'tiny.gguf')
    writeFileSync(path, 'surf-weights')
    const sha = createHash('sha256').update('surf-weights').digest('hex')
    const ok = await verifyFile(path, sha, Buffer.byteLength('surf-weights'))
    assert.equal(ok.ok, true)
    assert.equal(await hashFile(path), sha)
    const bad = await verifyFile(path, 'a'.repeat(64), Buffer.byteLength('surf-weights'))
    assert.equal(bad.ok, false)
    assert.equal(bad.reason, 'sha256')
    const missing = await verifyFile(join(dir, 'nope.gguf'), sha, 1)
    assert.equal(missing.reason, 'missing')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('registry lists the 2B Q4 file and a separate mmproj name', () => {
  const rows = registryEntries(['qwen3.5-2b-q4_k_m'], { mmproj: true })
  const weights = rows.find((row) => row.kind === 'weights')
  const vision = rows.find((row) => row.kind === 'mmproj')
  assert.equal(weights?.file, 'Qwen3.5-2B-Q4_K_M.gguf')
  assert.equal(weights?.sha256, 'aaf42c8b7c3cab2bf3d69c355048d4a0ee9973d48f16c731c0520ee914699223')
  assert.equal(weights?.sizeBytes, 1280835840)
  assert.equal(vision?.file, 'qwen3.5-2b-q4_k_m--mmproj-F16.gguf')
  assert.notEqual(vision?.sha256, weights?.sha256)
})
