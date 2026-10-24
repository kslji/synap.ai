import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { fitsGitHubAsset } from '../src/shared/setup-choice.ts'
import type { SetupEmbed, SetupModel } from '../src/shared/setup-choice.ts'
import { OfflinePackError, packOfflineZip } from './pack-offline-zip.ts'

function sha(body: Buffer): string {
  return createHash('sha256').update(body).digest('hex')
}

function fixture(os: 'mac' | 'windows'): {
  root: string
  appDir: string
  chatPath: string
  embedPath: string
  model: SetupModel
  embedding: SetupEmbed
} {
  const root = mkdtempSync(join(tmpdir(), 'surf-offline-'))
  const chatBody = Buffer.from(`chat-${os}`)
  const embedBody = Buffer.from(`embed-${os}`)
  const chatPath = join(root, 'Qwen.gguf')
  const embedPath = join(root, 'embed.gguf')
  writeFileSync(chatPath, chatBody)
  writeFileSync(embedPath, embedBody)
  const model: SetupModel = {
    id: 'qwen3.5-2b-q4_k_m',
    token: '2b',
    name: 'Qwen 2B',
    file: 'Qwen.gguf',
    minRamGb: 4,
    sizeBytes: chatBody.length,
    sha256: sha(chatBody),
    url: 'https://example.invalid/qwen',
  }
  const embedding: SetupEmbed = {
    id: 'jina-embeddings-v2-base-code-q5_k_m',
    name: 'Search model',
    file: 'embed.gguf',
    sizeBytes: embedBody.length,
    sha256: sha(embedBody),
    url: 'https://example.invalid/embed',
  }
  if (os === 'windows') {
    const appDir = join(root, 'win-unpacked')
    mkdirSync(appDir)
    writeFileSync(join(appDir, 'SynapSurf.exe'), 'exe')
    return { root, appDir, chatPath, embedPath, model, embedding }
  }
  const appDir = join(root, 'Synap.surf.app')
  mkdirSync(join(appDir, 'Contents', 'MacOS'), { recursive: true })
  writeFileSync(join(appDir, 'Contents', 'MacOS', 'SynapSurf'), 'mac')
  symlinkSync('SynapSurf', join(appDir, 'Contents', 'MacOS', 'SynapSurf.link'))
  return { root, appDir, chatPath, embedPath, model, embedding }
}

test('the fixture zip contains both models and stays under the GitHub limit', async () => {
  for (const os of ['windows', 'mac'] as const) {
    const built = fixture(os)
    const out = join(built.root, 'out')
    const catalog = join(out, 'offline-packages.json')
    try {
      const entry = await packOfflineZip({
        appDir: built.appDir,
        os,
        arch: os === 'mac' ? 'arm64' : 'x64',
        version: '0.2.0',
        tag: 'v0.2.0',
        outDir: out,
        catalogPath: catalog,
        repo: 'kslji/synap-surf-offline',
        hasHfToken: false,
        model: built.model,
        embedding: built.embedding,
        chatPath: built.chatPath,
        embedPath: built.embedPath,
        noSign: true,
        countDownloadCache: false,
        freeBytes: 80_000_000_000,
        platform: 'linux',
      })
      assert.equal(entry.host, 'github')
      assert.equal(entry.token, '2b')
      assert.equal(fitsGitHubAsset(entry.bytes), true)
      assert.equal(entry.modelBytes, built.model.sizeBytes + built.embedding.sizeBytes)
      const listed = spawnSync('unzip', ['-l', join(out, entry.name)], { encoding: 'utf8' })
      assert.equal(listed.status, 0, listed.stderr)
      assert.match(listed.stdout, /Qwen\.gguf/)
      assert.match(listed.stdout, /embed\.gguf/)
      assert.match(listed.stdout, /manifest\.json/)
      const extracted = join(built.root, 'extracted')
      const unzipped = spawnSync('unzip', ['-o', join(out, entry.name), '-d', extracted], { encoding: 'utf8' })
      assert.equal(unzipped.status, 0, unzipped.stderr)
      const manifestPath = os === 'mac'
        ? join(extracted, 'Synap.surf.app', 'Contents', 'Resources', 'setup-models', 'manifest.json')
        : join(extracted, 'Synap.surf', 'resources', 'setup-models', 'manifest.json')
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { modelId: string; files: { file: string; sha256: string }[] }
      assert.equal(manifest.modelId, built.model.id)
      assert.equal(manifest.files.find((file) => file.file === 'Qwen.gguf')?.sha256, built.model.sha256)
      assert.equal(manifest.files.find((file) => file.file === 'embed.gguf')?.sha256, built.embedding.sha256)
      const saved = JSON.parse(readFileSync(catalog, 'utf8')) as { name: string }[]
      assert.equal(saved[0]?.name, entry.name)
    } finally {
      rmSync(built.root, { recursive: true, force: true })
    }
  }
})

test('a Mac zip is refused on Linux unless signing is skipped', async () => {
  const built = fixture('mac')
  try {
    await assert.rejects(
      () => packOfflineZip({
        appDir: built.appDir,
        os: 'mac',
        arch: 'arm64',
        version: '0.2.0',
        tag: 'v0.2.0',
        outDir: join(built.root, 'out'),
        catalogPath: join(built.root, 'out', 'catalog.json'),
        repo: 'kslji/synap-surf-offline',
        hasHfToken: true,
        model: built.model,
        embedding: built.embedding,
        chatPath: built.chatPath,
        embedPath: built.embedPath,
        noSign: false,
        countDownloadCache: false,
        platform: 'linux',
      }),
      (error: unknown) => error instanceof OfflinePackError && error.exitCode === 1 && /macOS runner/.test(error.message),
    )
  } finally {
    rmSync(built.root, { recursive: true, force: true })
  }
})

test('a package over 2 GiB fails before the zip when HF_TOKEN is missing', async () => {
  const built = fixture('windows')
  built.model = { ...built.model, sizeBytes: 3_000_000_000 }
  try {
    await assert.rejects(
      () => packOfflineZip({
        appDir: '/missing',
        os: 'windows',
        arch: 'x64',
        version: '0.2.0',
        tag: 'v0.2.0',
        outDir: join(built.root, 'out'),
        catalogPath: join(built.root, 'catalog.json'),
        repo: 'kslji/synap-surf-offline',
        hasHfToken: false,
        model: built.model,
        embedding: built.embedding,
        chatPath: built.chatPath,
        embedPath: built.embedPath,
        noSign: true,
        countDownloadCache: true,
      }),
      (error: unknown) => {
        assert.ok(error instanceof OfflinePackError)
        assert.equal(error.exitCode, 1)
        assert.match(error.message, /HF_TOKEN/)
        assert.ok(error.message.includes(String(built.model.sizeBytes + built.embedding.sizeBytes)))
        assert.match(error.message, /kslji\/synap-surf-offline/)
        return true
      },
    )
  } finally {
    rmSync(built.root, { recursive: true, force: true })
  }
})

test('a short disk stops the zip and names the runner', async () => {
  const built = fixture('windows')
  try {
    await assert.rejects(
      () => packOfflineZip({
        appDir: built.appDir,
        os: 'windows',
        arch: 'x64',
        version: '0.2.0',
        tag: 'v0.2.0',
        outDir: join(built.root, 'out'),
        catalogPath: join(built.root, 'catalog.json'),
        repo: 'kslji/synap-surf-offline',
        hasHfToken: true,
        model: built.model,
        embedding: built.embedding,
        chatPath: built.chatPath,
        embedPath: built.embedPath,
        noSign: true,
        countDownloadCache: false,
        freeBytes: 1,
      }),
      (error: unknown) => error instanceof OfflinePackError && error.exitCode === 2 && /larger runner/.test(error.message),
    )
  } finally {
    rmSync(built.root, { recursive: true, force: true })
  }
})
