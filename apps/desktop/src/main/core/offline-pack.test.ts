import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { copyVerified } from './model-download.js'
import { readBundledManifest } from './bundled-models.js'
import { bundledModelBytes, fitsGitHubAsset, GITHUB_ASSET_LIMIT_BYTES, setupCatalog, setupEmbedding } from '../../shared/setup-choice.js'
import {
  ASAR_LIMIT_BYTES,
  acceptBundledManifest,
  asarCanHold,
  buildBundledManifest,
  githubReleaseAssetUrl,
  huggingfaceFileUrl,
  missingHfTokenMessage,
  NSIS_DATABLOCK_LIMIT_BYTES,
  nsisCanEmbed,
  offlineAssetName,
  offlineDiskMessage,
  offlineDiskOk,
  offlineHostFor,
  offlinePackaging,
  offlineUploadPlan,
  planOfflineModel,
} from '../../shared/offline-pack.js'

const registry = JSON.parse(readFileSync(new URL('../../../resources/models.registry.json', import.meta.url), 'utf8')) as {
  models: {
    id: string
    role?: string
    file: string
    url: string
    size_bytes: number
    sha256: string
    min_ram_gb: number
    params_b?: number | null
  }[]
}

test('the 2B offline package fits a GitHub asset, and every offline package is a zip', () => {
  const catalog = setupCatalog(registry.models)
  const embedding = setupEmbedding(registry.models)
  assert.ok(embedding)
  assert.equal(planOfflineModel(registry.models, '4b'), null)
  assert.equal(planOfflineModel(registry.models, '9b'), null)
  const two = planOfflineModel(registry.models, '2b')
  assert.ok(two)
  // The installer pack stays chat + embedding; the reranker is fetched by the setup plan when online.
  assert.equal(two.modelBytes, 1_402_222_912)
  assert.equal(bundledModelBytes(catalog[0]?.sizeBytes ?? 0, embedding.sizeBytes), two.modelBytes)
  assert.equal(fitsGitHubAsset(two.modelBytes), true)
  assert.equal(offlineHostFor(two.modelBytes), 'github')
  assert.equal(offlineHostFor(3_050_793_408), 'huggingface')
  assert.equal(offlineUploadPlan(two.modelBytes, false), 'github')
  assert.equal(offlineUploadPlan(3_050_793_408, false), 'missing-token')
  assert.equal(offlineUploadPlan(3_050_793_408, true), 'huggingface')
  // The 2B payload is the first offline bundle that fits one NSIS data block.
  assert.equal(nsisCanEmbed(two.model.sizeBytes), true)
  assert.equal(nsisCanEmbed(two.modelBytes), true)
  assert.equal(nsisCanEmbed(NSIS_DATABLOCK_LIMIT_BYTES), false)
  assert.equal(asarCanHold(two.model.sizeBytes), true)
  assert.equal(asarCanHold(ASAR_LIMIT_BYTES + 1), false)
  assert.equal(offlinePackaging(), 'zip')
  assert.equal(offlineAssetName('v0.2.0', 'arm64', '2b'), 'Synap.surf-0.2.0-arm64-2b-offline.zip')
  assert.equal(offlineAssetName('0.2.0', 'x64', '9b'), 'Synap.surf-0.2.0-x64-9b-offline.zip')
  assert.equal(
    huggingfaceFileUrl('kslji/synap-surf-offline', 'v0.2.0', 'Synap.surf-0.2.0-x64-9b-offline.zip'),
    'https://huggingface.co/datasets/kslji/synap-surf-offline/resolve/main/v0.2.0/Synap.surf-0.2.0-x64-9b-offline.zip',
  )
  assert.equal(
    githubReleaseAssetUrl('v0.2.0', 'Synap.surf-0.2.0-arm64-2b-offline.zip'),
    'https://github.com/kslji/synap.ai/releases/download/v0.2.0/Synap.surf-0.2.0-arm64-2b-offline.zip',
  )
  assert.match(missingHfTokenMessage('4b', 3_050_793_408, 'kslji/synap-surf-offline'), /HF_TOKEN/)
  assert.match(missingHfTokenMessage('4b', 3_050_793_408, 'kslji/synap-surf-offline'), /kslji\/synap-surf-offline/)
  assert.equal(GITHUB_ASSET_LIMIT_BYTES, 2_147_483_648)
})

test('a 14 GB runner can refuse the 9B zip', () => {
  const appBytes = 800_000_000
  const modelBytes = 5_990_377_984
  assert.equal(offlineDiskOk(14_000_000_000, appBytes, modelBytes, true), false)
  const message = offlineDiskMessage('9b', 14_654_497_792, 14_000_000_000)
  assert.match(message, /9b/)
  assert.match(message, /larger runner/)
  assert.equal(offlineDiskOk(80_000_000_000, appBytes, modelBytes, true), true)
})

test('a tampered manifest does not match the registry and is not installed', () => {
  const planned = planOfflineModel(registry.models, '2b')
  assert.ok(planned)
  const good = buildBundledManifest(planned.model, planned.embedding)
  const root = mkdtempSync(join(tmpdir(), 'surf-bundle-'))
  try {
    const dir = join(root, 'setup-models')
    mkdirSync(dir)
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(good))
    assert.equal(readBundledManifest(root, registry.models)?.modelId, planned.model.id)
    const tampered = structuredClone(good)
    const chat = tampered.files[0]
    assert.ok(chat)
    chat.sha256 = 'f'.repeat(64)
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(tampered))
    assert.equal(readBundledManifest(root, registry.models), null)
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ modelId: planned.model.id, files: [{ role: 'chat', file: '../secret', sizeBytes: 1, sha256: 'ab' }] }))
    assert.equal(readBundledManifest(root, registry.models), null)
    assert.equal(acceptBundledManifest({ modelId: 'nope', files: good.files }, setupCatalog(registry.models), planned.embedding), null)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a bundled file with the wrong bytes is deleted', async () => {
  const root = mkdtempSync(join(tmpdir(), 'surf-copy-'))
  try {
    const source = join(root, 'source.gguf')
    const dest = join(root, 'models', 'source.gguf')
    const body = Buffer.from('good-model')
    writeFileSync(source, body)
    mkdirSync(join(root, 'models'))
    writeFileSync(dest, Buffer.from('wrong-bytes-here'))
    const sha256 = createHash('sha256').update(body).digest('hex')
    await assert.rejects(copyVerified(source, { dest, size: body.length + 5, sha256 }))
    const { existsSync } = await import('node:fs')
    assert.equal(existsSync(dest), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
