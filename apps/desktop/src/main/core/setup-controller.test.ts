import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { DownloadError } from './model-download.js'
import { buildBundledManifest } from '../../shared/offline-pack.js'
import { createSetupController, type SetupHost, type SetupSnapshot } from './setup-controller.js'
import type { SetupEmbed, SetupModel } from '../../shared/setup-choice.js'

const four: SetupModel = {
  id: 'qwen3.5-4b-q4_k_m', token: '4b', name: 'Qwen 4B', file: 'Qwen3.5-4B-Q4_K_M.gguf',
  minRamGb: 8, sizeBytes: 200, sha256: 'bc', url: 'https://example.invalid/4b',
}
const embed: SetupEmbed = {
  id: 'embeddinggemma-2-text-q8_0', name: 'Search model', file: 'embeddinggemma-2-Q8_0.gguf',
  sizeBytes: 50, sha256: 'ef', url: 'https://example.invalid/emb',
}

function host(over: Partial<SetupHost> & { ram?: number } = {}): { host: SetupHost; events: SetupSnapshot[]; saved: string[]; downloads: string[]; copies: string[]; ready: string[] } {
  const events: SetupSnapshot[] = []
  const saved: string[] = []
  const downloads: string[] = []
  const copies: string[] = []
  const ready: string[] = []
  const root = mkdtempSync(join(tmpdir(), 'surf-setup-'))
  const built: SetupHost = {
    ramGb: () => over.ram ?? 8,
    catalog: () => [four],
    embedding: () => embed,
    isInstalled: async () => false,
    inDownloads: async () => false,
    takeDownloads: async (file) => { copies.push(file) },
    spec: (step) => ({ url: step.url, dest: join(root, step.file), size: step.sizeBytes, sha256: step.sha256 }),
    saveChoice: (id) => { saved.push(id) },
    embeddingReady: () => { ready.push('ready') },
    installedSetupId: async () => null,
    anyChatInstalled: async () => false,
    bundled: async () => null,
    copyBundled: async () => undefined,
    offlineOnly: () => false,
    freeBytes: async () => 10_000,
    emit: (snapshot) => { events.push(snapshot) },
    download: async (spec, onProgress) => {
      downloads.push(spec.url)
      onProgress?.(spec.size, spec.size)
      return spec.dest
    },
    ...over,
  }
  return { host: built, events, saved, downloads, copies, ready }
}

test('first open shows the one model and does not download', async () => {
  const built = host({ ram: 8 })
  const setup = createSetupController(built.host)
  await setup.start()
  const last = built.events.at(-1)
  assert.equal(last?.phase, 'pick')
  assert.deepEqual(last?.choices.map((choice) => choice.id), [four.id])
  assert.equal(last?.choices[0]?.warning, null)
  assert.equal(built.downloads.length, 0)
  assert.deepEqual(built.saved, [])
})

test('under 8 GB the one model warns, and unknown RAM does not', async () => {
  const small = host({ ram: 4 })
  await createSetupController(small.host).start()
  assert.match(small.events.at(-1)?.choices[0]?.warning ?? '', /needs 8 GB/)
  assert.match(small.events.at(-1)?.choices[0]?.warning ?? '', /has 4 GB/)
  const unknown = host({ ram: 0 })
  await createSetupController(unknown.host).start()
  assert.equal(unknown.events.at(-1)?.choices[0]?.warning, null)
})

test('the model still downloads under 8 GB, and EmbeddingGemma is always added', async () => {
  const built = host({ ram: 4 })
  const setup = createSetupController(built.host)
  await setup.choose(four.id)
  assert.deepEqual(built.downloads, [four.url, embed.url])
  assert.equal(built.events.at(-1)?.phase, 'done')
  assert.deepEqual(built.saved, [four.id])
  const files = built.events.find((event) => event.phase === 'downloading')?.files ?? []
  assert.deepEqual(files.map((file) => file.name), ['Qwen 4B', 'Search model'])
  const moving = built.events.find((event) => event.phase === 'downloading' && event.files[0]?.done === four.sizeBytes)
  assert.equal(moving?.total, four.sizeBytes + embed.sizeBytes)
  assert.equal(moving?.done, four.sizeBytes)
  assert.equal(built.ready.length, 1)
})

test('Use the file in Downloads copies that Qwen and still fetches EmbeddingGemma', async () => {
  const built = host({
    ram: 8,
    inDownloads: async (file) => file === four.file,
  })
  const setup = createSetupController(built.host)
  await setup.start()
  assert.equal(built.events.at(-1)?.choices.find((choice) => choice.id === four.id)?.inDownloads, true)
  await setup.useFile(four.id)
  assert.deepEqual(built.copies, [four.file])
  assert.deepEqual(built.downloads, [embed.url])
  assert.equal(built.events.at(-1)?.phase, 'done')
  assert.deepEqual(built.saved, [four.id])
})

test('EmbeddingGemma already in Downloads is copied without asking', async () => {
  const built = host({
    inDownloads: async (file) => file === embed.file,
  })
  const setup = createSetupController(built.host)
  await setup.choose(four.id)
  assert.deepEqual(built.downloads, [four.url])
  assert.deepEqual(built.copies, [embed.file])
})

test('disk full counts every file that still has to arrive', async () => {
  const built = host({ freeBytes: async () => 10, download: async () => { throw new Error('downloaded') } })
  const setup = createSetupController(built.host)
  await setup.choose(four.id)
  const last = built.events.at(-1)
  assert.equal(last?.error?.code, 'disk')
  assert.equal(last?.error?.freeBytes, 10)
  assert.equal(last?.error?.requiredBytes, Math.ceil((four.sizeBytes + embed.sizeBytes) * 1.05))
  assert.equal(built.downloads.length, 0)
})

test('a checksum failure asks for a fresh download', async () => {
  const built = host({
    download: async () => { throw new DownloadError('checksum', 'sha256 mismatch - file deleted, retry') },
  })
  const setup = createSetupController(built.host)
  await setup.choose(four.id)
  assert.equal(built.events.at(-1)?.error?.code, 'checksum')
})

test('a network failure stays resumable and a retry can finish', async () => {
  let calls = 0
  const built = host({
    download: async (spec, onProgress) => {
      calls += 1
      if (calls === 1) throw new DownloadError('network', 'no internet')
      onProgress?.(spec.size, spec.size)
      return spec.dest
    },
  })
  const setup = createSetupController(built.host)
  await setup.choose(four.id)
  assert.equal(built.events.at(-1)?.error?.code, 'offline')
  await setup.retry()
  assert.equal(built.events.at(-1)?.phase, 'done')
  assert.deepEqual(built.saved, [four.id])
  assert.equal(calls, 3)
})

test('chat is not ready until the search model verifies', async () => {
  const built = host({
    download: async (spec, onProgress) => {
      if (spec.url === embed.url) throw new DownloadError('checksum', 'sha256 mismatch - file deleted, retry')
      onProgress?.(spec.size, spec.size)
      return spec.dest
    },
  })
  const setup = createSetupController(built.host)
  await setup.choose(four.id)
  assert.equal(built.events.at(-1)?.phase, 'error')
  assert.equal(built.events.at(-1)?.error?.code, 'checksum')
  assert.deepEqual(built.saved, [])
  assert.deepEqual(built.ready, [])
})

test('a later launch with Qwen already installed downloads only the search model', async () => {
  const hashes: string[] = []
  const built = host({
    isInstalled: async (file, _size, sha) => {
      if (sha) hashes.push(sha)
      return file === four.file && !sha
    },
    installedSetupId: async () => four.id,
    anyChatInstalled: async () => true,
  })
  const setup = createSetupController(built.host)
  await setup.repair()
  assert.deepEqual(hashes, [embed.sha256])
  assert.deepEqual(built.downloads, [embed.url])
  assert.deepEqual(built.copies, [])
  assert.deepEqual(built.saved, [])
  assert.equal(built.events.at(-1)?.phase, 'done')
  assert.deepEqual(built.ready, ['ready'])
  const names = built.events.find((event) => event.phase === 'downloading')?.files.map((file) => file.name)
  assert.deepEqual(names, ['Qwen 4B', 'Search model'])
})

test('a chat model outside the setup catalog still repairs the search model alone', async () => {
  const built = host({
    installedSetupId: async () => null,
    anyChatInstalled: async () => true,
  })
  const setup = createSetupController(built.host)
  await setup.repair()
  assert.deepEqual(built.downloads, [embed.url])
  assert.deepEqual(built.saved, [])
  assert.equal(built.events.at(-1)?.phase, 'done')
  assert.equal(built.events.at(-1)?.modelName, 'Search model')
})

test('offline mode does not start a download', async () => {
  const built = host({ offlineOnly: () => true, download: async () => { throw new Error('downloaded') } })
  const setup = createSetupController(built.host)
  await setup.choose(four.id)
  assert.equal(built.events.at(-1)?.error?.code, 'offline')
  assert.deepEqual(built.saved, [])
})

test('an offline zip copies both files and opens chat only after both succeed', async () => {
  const copied: string[] = []
  const built = host({
    offlineOnly: () => true,
    bundled: async () => buildBundledManifest(four, embed),
    copyBundled: async (file, _size, _sha, onProgress) => {
      copied.push(file)
      onProgress(1, 1)
    },
    download: async () => { throw new Error('downloaded') },
  })
  const setup = createSetupController(built.host)
  const seen = setup.state()
  await setup.start()
  const snapshot = await seen
  assert.deepEqual(copied, [four.file, embed.file])
  assert.deepEqual(built.downloads, [])
  assert.deepEqual(built.saved, [four.id])
  assert.deepEqual(built.ready, ['ready'])
  assert.equal(snapshot.phase, 'done')
  assert.equal(built.events.some((event) => event.phase === 'pick'), false)
  const names = built.events.find((event) => event.phase === 'downloading')?.files.map((file) => file.name)
  assert.deepEqual(names, ['Qwen 4B', 'Search model'])
  assert.equal(built.events.find((event) => event.localCopy)?.localCopy, true)
})

test('a bundled copy that fails the search model does not open chat', async () => {
  const built = host({
    bundled: async () => buildBundledManifest(four, embed),
    copyBundled: async (file, _size, _sha, onProgress) => {
      if (file === embed.file) throw new DownloadError('checksum', 'sha256 mismatch - file deleted, retry')
      onProgress(1, 1)
    },
  })
  const setup = createSetupController(built.host)
  await setup.start()
  assert.equal(built.events.at(-1)?.phase, 'error')
  assert.equal(built.events.at(-1)?.error?.code, 'checksum')
  assert.deepEqual(built.saved, [])
  assert.deepEqual(built.ready, [])
})

test('a tampered offline manifest is ignored and nothing is copied', async () => {
  const copied: string[] = []
  const tampered = buildBundledManifest(four, embed)
  tampered.files[0] = { ...tampered.files[0], sha256: 'not-the-registry' }
  const built = host({
    bundled: async () => tampered,
    copyBundled: async (file) => { copied.push(file) },
  })
  const setup = createSetupController(built.host)
  await setup.start()
  assert.deepEqual(copied, [])
  assert.equal(built.events.at(-1)?.phase, 'pick')
  assert.deepEqual(built.saved, [])
})

test('a later launch copies the search model from the zip and keeps the chosen chat model', async () => {
  const copied: string[] = []
  const built = host({
    isInstalled: async (file) => file === four.file,
    anyChatInstalled: async () => true,
    bundled: async () => buildBundledManifest(four, embed),
    copyBundled: async (file, _size, _sha, onProgress) => {
      copied.push(file)
      onProgress(file.length, file.length)
    },
  })
  const setup = createSetupController(built.host)
  await setup.repair()
  assert.deepEqual(copied, [embed.file])
  assert.deepEqual(built.saved, [])
  assert.deepEqual(built.downloads, [])
  assert.deepEqual(built.ready, ['ready'])
  assert.equal(built.events.at(-1)?.phase, 'done')
})

test('an offline zip reports a full disk before it copies', async () => {
  const copied: string[] = []
  const built = host({
    freeBytes: async () => 10,
    bundled: async () => buildBundledManifest(four, embed),
    copyBundled: async (file) => { copied.push(file) },
  })
  const setup = createSetupController(built.host)
  await setup.start()
  assert.equal(built.events.at(-1)?.error?.code, 'disk')
  assert.deepEqual(copied, [])
  assert.deepEqual(built.saved, [])
})
