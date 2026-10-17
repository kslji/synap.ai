import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { DownloadError } from './model-download.js'
import { createSetupController, type SetupHost, type SetupSnapshot } from './setup-controller.js'
import type { SetupEmbed, SetupModel } from '../../shared/setup-choice.js'

const two: SetupModel = {
  id: 'qwen3.5-2b-q4_k_m', token: '2b', name: 'Qwen 2B', file: 'Qwen3.5-2B-Q4_K_M.gguf',
  minRamGb: 4, sizeBytes: 100, sha256: 'ab', url: 'https://example.invalid/2b',
}
const four: SetupModel = {
  id: 'qwen3.5-4b-q4_k_m', token: '4b', name: 'Qwen 4B', file: 'Qwen3.5-4B-Q4_K_M.gguf',
  minRamGb: 8, sizeBytes: 200, sha256: 'bc', url: 'https://example.invalid/4b',
}
const nine: SetupModel = {
  id: 'qwen3.5-9b-q4_k_m', token: '9b', name: 'Qwen 9B', file: 'Qwen3.5-9B-Q4_K_M.gguf',
  minRamGb: 16, sizeBytes: 500, sha256: 'cd', url: 'https://example.invalid/9b',
}
const embed: SetupEmbed = {
  id: 'embeddinggemma-2-text-q8_0', name: 'EmbeddingGemma', file: 'embeddinggemma-2-Q8_0.gguf',
  sizeBytes: 50, sha256: 'ef', url: 'https://example.invalid/emb',
}

function host(over: Partial<SetupHost> & { ram?: number } = {}): { host: SetupHost; events: SetupSnapshot[]; saved: string[]; downloads: string[]; copies: string[] } {
  const events: SetupSnapshot[] = []
  const saved: string[] = []
  const downloads: string[] = []
  const copies: string[] = []
  const root = mkdtempSync(join(tmpdir(), 'surf-setup-'))
  const built: SetupHost = {
    ramGb: () => over.ram ?? 8,
    catalog: () => [two, four, nine],
    embedding: () => embed,
    isInstalled: async () => false,
    inDownloads: async () => false,
    takeDownloads: async (file) => { copies.push(file) },
    spec: (step) => ({ url: step.url, dest: join(root, step.file), size: step.sizeBytes, sha256: step.sha256 }),
    saveChoice: (id) => { saved.push(id) },
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
  return { host: built, events, saved, downloads, copies }
}

test('first open lists the three sizes and does not download', async () => {
  const built = host({ ram: 8 })
  const setup = createSetupController(built.host)
  await setup.start()
  const last = built.events.at(-1)
  assert.equal(last?.phase, 'pick')
  assert.equal(last?.choices.find((choice) => choice.id === four.id)?.recommended, true)
  assert.match(last?.choices.find((choice) => choice.id === nine.id)?.warning ?? '', /needs 16 GB/)
  assert.match(last?.choices.find((choice) => choice.id === nine.id)?.warning ?? '', /has 8 GB/)
  assert.equal(built.downloads.length, 0)
  assert.deepEqual(built.saved, [])
})

test('unknown RAM recommends nothing', async () => {
  const built = host({ ram: 0 })
  const setup = createSetupController(built.host)
  await setup.start()
  const choices = built.events.at(-1)?.choices ?? []
  assert.equal(choices.every((choice) => !choice.recommended), true)
  assert.equal(choices.find((choice) => choice.id === two.id)?.warning, null)
})

test('a 9B choice on 8 GB still downloads, and EmbeddingGemma is always added', async () => {
  const built = host({ ram: 8 })
  const setup = createSetupController(built.host)
  await setup.choose(nine.id)
  assert.deepEqual(built.downloads, [nine.url, embed.url])
  assert.equal(built.events.at(-1)?.phase, 'done')
  assert.deepEqual(built.saved, [nine.id])
  const files = built.events.find((event) => event.phase === 'downloading')?.files ?? []
  assert.deepEqual(files.map((file) => file.name), ['Qwen 9B', 'EmbeddingGemma'])
})

test('Use the file in Downloads copies that Qwen and still fetches EmbeddingGemma', async () => {
  const built = host({
    ram: 8,
    inDownloads: async (file) => file === two.file,
  })
  const setup = createSetupController(built.host)
  await setup.start()
  assert.equal(built.events.at(-1)?.choices.find((choice) => choice.id === two.id)?.inDownloads, true)
  await setup.useFile(two.id)
  assert.deepEqual(built.copies, [two.file])
  assert.deepEqual(built.downloads, [embed.url])
  assert.equal(built.events.at(-1)?.phase, 'done')
  assert.deepEqual(built.saved, [two.id])
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
  await setup.choose(two.id)
  const last = built.events.at(-1)
  assert.equal(last?.error?.code, 'disk')
  assert.equal(last?.error?.freeBytes, 10)
  assert.equal(last?.error?.requiredBytes, Math.ceil((two.sizeBytes + embed.sizeBytes) * 1.05))
  assert.equal(built.downloads.length, 0)
})

test('a checksum failure asks for a fresh download', async () => {
  const built = host({
    download: async () => { throw new DownloadError('checksum', 'sha256 mismatch - file deleted, retry') },
  })
  const setup = createSetupController(built.host)
  await setup.choose(two.id)
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
  await setup.choose(two.id)
  assert.equal(built.events.at(-1)?.error?.code, 'offline')
  await setup.retry()
  assert.equal(built.events.at(-1)?.phase, 'done')
  assert.deepEqual(built.saved, [two.id])
  assert.equal(calls, 3)
})

test('offline mode does not start a download', async () => {
  const built = host({ offlineOnly: () => true, download: async () => { throw new Error('downloaded') } })
  const setup = createSetupController(built.host)
  await setup.choose(two.id)
  assert.equal(built.events.at(-1)?.error?.code, 'offline')
  assert.deepEqual(built.saved, [])
})
