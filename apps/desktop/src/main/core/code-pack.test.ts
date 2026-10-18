import assert from 'node:assert/strict'
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { loadCodePack, type CodePackManifest } from './code-pack.js'

function publicHex(key: KeyObject): string {
  const jwk = key.export({ format: 'jwk' }) as { x: string }
  return Buffer.from(jwk.x, 'base64url').toString('hex')
}

test('a missing code pack is absent, and a signed stub manifest loads', async () => {
  const root = mkdtempSync(join(tmpdir(), 'surf-code-pack-'))
  const { privateKey } = generateKeyPairSync('ed25519')
  const keys = { 'k-test': publicHex(privateKey) }
  try {
    assert.equal((await loadCodePack(join(root, 'missing'), keys)).status, 'absent')

    const dir = join(root, 'code-pack')
    mkdirSync(dir)
    const manifest: CodePackManifest = {
      format: 'surf-code-pack/1',
      pack_id: 'code',
      version: '2026.10.15',
      created_at: '2026-10-15T00:00:00Z',
      min_app_version: '0.1.0',
      signing_key_id: 'k-test',
      notes: 'placeholder',
      sources: [],
      files: [],
    }
    const body = Buffer.from(JSON.stringify(manifest))
    writeFileSync(join(dir, 'manifest.json'), body)
    writeFileSync(join(dir, 'manifest.sig'), sign(null, body, privateKey))
    const ready = await loadCodePack(dir, keys)
    assert.equal(ready.status, 'ready')
    if (ready.status === 'ready') assert.equal(ready.manifest.pack_id, 'code')

    writeFileSync(join(dir, 'manifest.json'), body.toString('utf8').replace('placeholder', 'tampered'))
    const invalid = await loadCodePack(dir, keys)
    assert.equal(invalid.status, 'invalid')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
