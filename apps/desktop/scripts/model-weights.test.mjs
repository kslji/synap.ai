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

test('registry lists the 4B Q4 file and a separate mmproj name', () => {
  const rows = registryEntries(['qwen3.5-4b-q4_k_m'], { mmproj: true })
  const weights = rows.find((row) => row.kind === 'weights')
  const vision = rows.find((row) => row.kind === 'mmproj')
  assert.equal(weights?.file, 'Qwen3.5-4B-Q4_K_M.gguf')
  assert.equal(weights?.sha256, '00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4')
  assert.equal(weights?.sizeBytes, 2740937888)
  assert.equal(vision?.file, 'qwen3.5-4b-q4_k_m--mmproj-F16.gguf')
  assert.notEqual(vision?.sha256, weights?.sha256)
})
