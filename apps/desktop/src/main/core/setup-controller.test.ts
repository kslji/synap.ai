import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { DownloadError } from './model-download.js'
import { createSetupController, type SetupHost, type SetupSnapshot } from './setup-controller.js'
import type { SetupModel } from '../../shared/setup-choice.js'

const two: SetupModel = {
  id: 'qwen3.5-2b-q4_k_m', token: '2b', name: 'Qwen 2B', file: 'Qwen3.5-2B-Q4_K_M.gguf',
  minRamGb: 4, sizeBytes: 100, sha256: 'ab', url: 'https://example.invalid/2b',
}
const nine: SetupModel = {
  id: 'qwen3.5-9b-q4_k_m', token: '9b', name: 'Qwen 9B', file: 'Qwen3.5-9B-Q4_K_M.gguf',
  minRamGb: 16, sizeBytes: 500, sha256: 'cd', url: 'https://example.invalid/9b',
}

function host(over: Partial<SetupHost> & { ram?: number; marker?: string | null }): { host: SetupHost; events: SetupSnapshot[]; saved: string[] } {
  const events: SetupSnapshot[] = []
  const saved: string[] = []
  const root = mkdtempSync(join(tmpdir(), 'surf-setup-'))
  const built: SetupHost = {
    ramGb: () => over.ram ?? 16,
    markerText: () => over.marker ?? null,
    overrideText: () => null,
    writeOverride: () => undefined,
    linkModelId: () => null,
    catalog: () => [two, nine],
    isInstalled: async () => false,
    adopt: async () => null,
    bundled: () => false,
    spec: (model) => ({ url: model.url, dest: join(root, model.file), size: model.sizeBytes, sha256: model.sha256 }),
    bundledSource: () => null,
    saveChoice: (id) => { saved.push(id) },
    offlineOnly: () => false,
    freeBytes: async () => 10_000,
    emit: (snapshot) => { events.push(snapshot) },
    download: async (_spec, onProgress) => { onProgress?.(100, 100); return 'ok' },
    ...over,
  }
  return { host: built, events, saved }
}

test('a 9B choice on a 4 GB machine does not download', async () => {
  const built = host({ ram: 4, marker: '{"model":"qwen3.5-9b-q4_k_m"}', download: async () => { throw new Error('downloaded') } })
  const setup = createSetupController(built.host)
  await setup.start()
  const last = built.events.at(-1)
  assert.equal(last?.phase, 'error')
  assert.equal(last?.error?.code, 'ram')
  assert.equal(last?.error?.suggestId, two.id)
  assert.equal(last?.error?.needRamGb, 16)
  assert.equal(last?.ramGb, 4)
  assert.deepEqual(built.saved, [])
})

test('disk full is reported from the measured free space', async () => {
  const built = host({ marker: '{"size":"2b"}', freeBytes: async () => 10, download: async () => { throw new Error('downloaded') } })
  const setup = createSetupController(built.host)
  await setup.start()
  const last = built.events.at(-1)
  assert.equal(last?.error?.code, 'disk')
  assert.equal(last?.error?.freeBytes, 10)
  assert.equal(last?.error?.requiredBytes, Math.ceil(two.sizeBytes * 1.05))
})

test('a checksum failure asks for a fresh download', async () => {
  const built = host({
    marker: '{"size":"2b"}',
    download: async () => { throw new DownloadError('checksum', 'sha256 mismatch - file deleted, retry') },
  })
  const setup = createSetupController(built.host)
  await setup.start()
  assert.equal(built.events.at(-1)?.error?.code, 'checksum')
})

test('a network failure stays resumable and a retry can finish', async () => {
  let calls = 0
  const built = host({
    ram: 16,
    marker: '{"size":"2b"}',
    download: async (_spec, onProgress) => {
      calls += 1
      if (calls === 1) throw new DownloadError('network', 'no internet')
      onProgress?.(two.sizeBytes, two.sizeBytes)
      return 'ok'
    },
  })
  const setup = createSetupController(built.host)
  await setup.start()
  assert.equal(built.events.at(-1)?.error?.code, 'offline')
  await setup.retry()
  assert.equal(built.events.at(-1)?.phase, 'done')
  assert.deepEqual(built.saved, [two.id])
  assert.equal(calls, 2)
})

test('an adopted download is not fetched again', async () => {
  const built = host({
    marker: '{"model":"qwen3.5-9b-q4_k_m"}',
    adopt: async () => two.id,
    download: async () => { throw new Error('downloaded') },
  })
  const setup = createSetupController(built.host)
  await setup.start()
  assert.equal(built.events.at(-1)?.phase, 'done')
  assert.equal(built.events.at(-1)?.modelId, two.id)
  assert.deepEqual(built.saved, [two.id])
})
