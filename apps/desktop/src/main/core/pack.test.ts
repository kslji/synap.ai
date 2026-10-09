import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { EMBEDDINGGEMMA2_256 } from './embedding.js'
import { commitInstall, readInstalled } from './pack-install.js'
import { downloadFile, shouldSync, DEFAULT_SYNC_MS } from './pack-sync.js'
import { verifyPack, type PackManifest, type TrustedKeys } from './pack-verify.js'
import { mergeLocal } from './retrieval.js'

function publicHex(key: KeyObject): string {
  const jwk = key.export({ format: 'jwk' }) as { x: string }
  return Buffer.from(jwk.x, 'base64url').toString('hex')
}

function signedPack(dir: string, fileBody: Buffer, key: KeyObject, keyId = 'k-test'): { manifest: PackManifest; keys: TrustedKeys } {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'pack.sqlite'), fileBody)
  const digest = createHash('sha256').update(fileBody).digest('hex')
  const manifest: PackManifest = {
    format: 'surf-pack/1',
    pack_id: 'general-starter',
    niche: 'general',
    version: '2026.10.09',
    created_at: '2026-10-09T00:00:00Z',
    min_app_version: '0.1.0',
    embedding: {
      id: EMBEDDINGGEMMA2_256.id,
      model: EMBEDDINGGEMMA2_256.model,
      file: EMBEDDINGGEMMA2_256.gguf,
      native_dim: EMBEDDINGGEMMA2_256.nativeDim,
      dim: EMBEDDINGGEMMA2_256.dim,
      pooling: 'mean',
      normalize: true,
      query_prefix: EMBEDDINGGEMMA2_256.queryPrefix,
      doc_template: EMBEDDINGGEMMA2_256.docTemplate,
    },
    chunking: { target_tokens: 250, overlap_tokens: 40 },
    files: [{ name: 'pack.sqlite', role: 'index', size: fileBody.length, sha256: digest, url: 'https://packs.invalid/pack.sqlite' }],
    signing_key_id: keyId,
  }
  const body = Buffer.from(JSON.stringify(manifest))
  writeFileSync(join(dir, 'manifest.json'), body)
  writeFileSync(join(dir, 'manifest.sig'), sign(null, body, key))
  return { manifest, keys: { [keyId]: publicHex(key) } }
}

const baseSync = {
  now: 1_000_000,
  lastSyncAt: null as number | null,
  intervalMs: DEFAULT_SYNC_MS,
  online: true,
  signedIn: true,
  chatBusy: false,
  offlineOnly: false,
  metered: false,
}

test('a signed pack verifies, and tamper or the wrong key is rejected', async () => {
  const root = mkdtempSync(join(tmpdir(), 'surf-pack-'))
    const { privateKey } = generateKeyPairSync('ed25519')
  try {
    const good = join(root, 'good')
    const { keys } = signedPack(good, Buffer.from('pack-bytes'), privateKey)
    const manifest = await verifyPack(good, { trustedKeys: keys, expectedEmbedding: EMBEDDINGGEMMA2_256 })
    assert.equal(manifest.pack_id, 'general-starter')

    const tamperedManifest = join(root, 'bad-manifest')
    signedPack(tamperedManifest, Buffer.from('pack-bytes'), privateKey)
    const raw = readFileSync(join(tamperedManifest, 'manifest.json'), 'utf8').replace('general-starter', 'general-starterx')
    writeFileSync(join(tamperedManifest, 'manifest.json'), raw)
    await assert.rejects(
      () => verifyPack(tamperedManifest, { trustedKeys: keys, expectedEmbedding: EMBEDDINGGEMMA2_256 }),
      /bad pack signature/,
    )

    const tamperedFile = join(root, 'bad-file')
    signedPack(tamperedFile, Buffer.from('pack-bytes'), privateKey)
    writeFileSync(join(tamperedFile, 'pack.sqlite'), Buffer.from('tampered!!'))
    await assert.rejects(
      () => verifyPack(tamperedFile, { trustedKeys: keys, expectedEmbedding: EMBEDDINGGEMMA2_256 }),
      /sha256 mismatch/,
    )

    const wrong = generateKeyPairSync('ed25519')
    await assert.rejects(
      () => verifyPack(good, { trustedKeys: { 'k-test': publicHex(wrong.publicKey) }, expectedEmbedding: EMBEDDINGGEMMA2_256 }),
      /bad pack signature/,
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a failed install restores the previous version', async () => {
  const root = mkdtempSync(join(tmpdir(), 'surf-install-'))
  const manifest = {
    format: 'surf-pack/1' as const,
    pack_id: 'general-starter',
    niche: 'general',
    version: '2026.10.09',
    created_at: '2026-10-09T00:00:00Z',
    min_app_version: '0.1.0',
    embedding: {
      id: 'embeddinggemma-2-text@256', model: 'google/embeddinggemma-2', file: 'embeddinggemma-2-Q8_0.gguf',
      native_dim: 768, dim: 256, pooling: 'mean', normalize: true,
      query_prefix: 'task: search result | query: ', doc_template: 'title: {title} | text: {text}',
    },
    chunking: { target_tokens: 250, overlap_tokens: 40 },
    files: [{ name: 'pack.sqlite', role: 'index' as const, size: 3, sha256: 'a'.repeat(64), url: 'https://packs.invalid/pack.sqlite' }],
    signing_key_id: 'k-test',
  }
  try {
    const first = join(root, 'stage-1')
    mkdirSync(first)
    writeFileSync(join(first, 'marker.txt'), 'old')
    await commitInstall(first, join(root, 'packs'), manifest, 'General starter')
    const kept = readFileSync(join(root, 'packs', 'general-starter', '2026.10.09', 'marker.txt'), 'utf8')
    assert.equal(kept, 'old')

    const second = join(root, 'stage-2')
    mkdirSync(second)
    writeFileSync(join(second, 'marker.txt'), 'new')
    await assert.rejects(
      () => commitInstall(second, join(root, 'packs'), manifest, 'General starter', { failAfterAside: true }),
      /install rolled back/,
    )
    assert.equal(readFileSync(join(root, 'packs', 'general-starter', '2026.10.09', 'marker.txt'), 'utf8'), 'old')
    const installed = await readInstalled(join(root, 'packs'))
    assert.equal(installed.length, 1)
    assert.equal(installed[0].version, '2026.10.09')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('sync waits for sign-in, the network, and a quiet chat', () => {
  assert.equal(shouldSync({ ...baseSync, signedIn: false }), false)
  assert.equal(shouldSync({ ...baseSync, online: false }), false)
  assert.equal(shouldSync({ ...baseSync, offlineOnly: true }), false)
  assert.equal(shouldSync({ ...baseSync, metered: true }), false)
  assert.equal(shouldSync({ ...baseSync, chatBusy: true }), false)
  assert.equal(shouldSync(baseSync), true)
  assert.equal(shouldSync({ ...baseSync, lastSyncAt: baseSync.now - 1000 }), false)
  assert.equal(shouldSync({ ...baseSync, lastSyncAt: baseSync.now - DEFAULT_SYNC_MS }), true)
  assert.equal(shouldSync({ ...baseSync, lastSyncAt: baseSync.now, force: true }), true)
  assert.equal(shouldSync({ ...baseSync, chatBusy: true, force: true }), false)
})

test('a partial download resumes from the part file', async () => {
  const root = mkdtempSync(join(tmpdir(), 'surf-download-'))
  const dest = join(root, 'pack.sqlite')
  writeFileSync(`${dest}.part`, Buffer.from('hello'))
  try {
    await downloadFile('https://packs.invalid/pack.sqlite', dest, {}, async (_url, init) => {
      const headers = new Headers(init?.headers)
      assert.equal(headers.get('range'), 'bytes=5-')
      return new Response('!', { status: 206 })
    })
    assert.equal(readFileSync(dest, 'utf8'), 'hello!')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('document and pack gates merge by strength', () => {
  const doc = { hits: ['doc'], decision: 'answer' as const }
  const pack = { hits: ['pack'], decision: 'answer' as const }
  const both = mergeLocal(doc, pack)
  assert.deepEqual(both.hits, ['doc', 'pack'])
  assert.equal(both.decision, 'answer')
  const onlyPack = mergeLocal({ hits: ['doc'], decision: 'insufficient' }, pack)
  assert.deepEqual(onlyPack.hits, ['pack'])
  const neither = mergeLocal({ hits: ['doc'], decision: 'insufficient' }, { hits: ['pack'], decision: 'insufficient' })
  assert.equal(neither.decision, 'insufficient')
  assert.deepEqual(neither.hits, [])
})
