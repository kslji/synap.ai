import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { tierFor } from './hardware.js'
import { parseRegistry } from './model-registry.js'
import {
  byteRate,
  formatByteCount,
  formatByteRate,
  formatRamGb,
  planFirstRun,
  recommendSetupModel,
  requiredFreeBytes,
  setupCatalog,
  setupChoices,
  setupEmbedding,
  setupErrorCopy,
  setupShot,
} from '../../shared/setup-choice.js'

const registry = parseRegistry(JSON.parse(readFileSync(fileURLToPath(new URL('../../../resources/models.registry.json', import.meta.url)), 'utf8')))
const catalog = setupCatalog(registry.models)
const embedding = setupEmbedding(registry.models)
if (!embedding) throw new Error('registry has no embedding model')

test('the setup catalog is the three Q4_K_M Qwen files, plus EmbeddingGemma', () => {
  assert.deepEqual(catalog.map((model) => model.token), ['2b', '4b', '9b'])
  assert.equal(catalog[0].sizeBytes, 1_280_835_840)
  assert.equal(formatByteCount(catalog[0].sizeBytes), '1.28 GB')
  assert.equal(formatByteCount(catalog[1].sizeBytes), '2.74 GB')
  assert.equal(formatByteCount(catalog[2].sizeBytes), '5.68 GB')
  assert.equal(embedding.name, 'EmbeddingGemma')
  assert.equal(embedding.sizeBytes, 309_855_520)
  assert.equal(formatByteCount(embedding.sizeBytes), '309.9 MB')
})

test('recommendation follows RAM, and unknown RAM is 2B with no tag', () => {
  assert.equal(recommendSetupModel(null, catalog).id, 'qwen3.5-2b-q4_k_m')
  assert.equal(recommendSetupModel(null, catalog).source, 'default')
  assert.equal(recommendSetupModel(0, catalog).source, 'default')
  assert.equal(recommendSetupModel(4, catalog).id, 'qwen3.5-2b-q4_k_m')
  assert.equal(recommendSetupModel(8, catalog).id, 'qwen3.5-4b-q4_k_m')
  assert.equal(recommendSetupModel(7.6, catalog).id, 'qwen3.5-4b-q4_k_m')
  assert.equal(recommendSetupModel(16, catalog).id, 'qwen3.5-9b-q4_k_m')
  assert.equal(recommendSetupModel(32, catalog).id, 'qwen3.5-9b-q4_k_m')
  assert.equal(tierFor(4, 0, false), 0)
  assert.equal(tierFor(8, 0, false), 1)
  assert.equal(tierFor(16, 0, false), 2)
  const unknown = setupChoices(catalog, null, [])
  assert.equal(unknown.every((choice) => !choice.recommended), true)
  assert.equal(unknown.every((choice) => choice.warning == null), true)
  const eight = setupChoices(catalog, 8, [])
  assert.equal(eight.find((choice) => choice.id === 'qwen3.5-4b-q4_k_m')?.recommended, true)
  assert.equal(eight.find((choice) => choice.id === 'qwen3.5-2b-q4_k_m')?.recommended, false)
  assert.equal(eight.find((choice) => choice.id === 'qwen3.5-9b-q4_k_m')?.recommended, false)
})

test('a size that needs more memory stays selectable and shows a warning', () => {
  const choices = setupChoices(catalog, 8, ['qwen3.5-2b-q4_k_m'])
  const nine = choices.find((choice) => choice.id === 'qwen3.5-9b-q4_k_m')
  assert.equal(nine?.warning, 'This model needs 16 GB of memory. This computer has 8 GB.')
  assert.equal(choices.find((choice) => choice.id === 'qwen3.5-4b-q4_k_m')?.warning, null)
  assert.equal(choices.find((choice) => choice.id === 'qwen3.5-2b-q4_k_m')?.inDownloads, true)
  const tight = setupChoices(catalog, 4, [])
  assert.match(tight.find((choice) => choice.id === 'qwen3.5-4b-q4_k_m')?.warning ?? '', /needs 8 GB/)
  assert.match(tight.find((choice) => choice.id === 'qwen3.5-4b-q4_k_m')?.warning ?? '', /has 4 GB/)
  assert.equal(formatRamGb(7.6), '7.6 GB')
})

test('EmbeddingGemma is always in the plan, and an oversize choice is not blocked', () => {
  const plan = planFirstRun({
    chosenId: 'qwen3.5-9b-q4_k_m',
    useDownloads: false,
    freeBytes: 20_000_000_000,
    chatInstalled: false,
    embedInstalled: false,
    chatInDownloads: false,
    embedInDownloads: false,
    catalog,
    embedding,
  })
  assert.equal(plan.action, 'run')
  assert.deepEqual(plan.steps.map((step) => step.role), ['chat', 'embedding'])
  assert.deepEqual(plan.steps.map((step) => step.action), ['download', 'download'])
  assert.equal(plan.steps[1]?.id, embedding.id)
})

test('a Downloads copy is offered as a copy, and disk space covers every file still needed', () => {
  const adopted = planFirstRun({
    chosenId: 'qwen3.5-2b-q4_k_m',
    useDownloads: true,
    freeBytes: 20_000_000_000,
    chatInstalled: false,
    embedInstalled: false,
    chatInDownloads: true,
    embedInDownloads: true,
    catalog,
    embedding,
  })
  assert.equal(adopted.action, 'run')
  assert.deepEqual(adopted.steps.map((step) => step.action), ['copy', 'copy'])
  const chatOnly = planFirstRun({
    chosenId: 'qwen3.5-2b-q4_k_m',
    useDownloads: true,
    freeBytes: 20_000_000_000,
    chatInstalled: false,
    embedInstalled: true,
    chatInDownloads: true,
    embedInDownloads: false,
    catalog,
    embedding,
  })
  assert.deepEqual(chatOnly.steps.map((step) => step.action), ['copy', 'ready'])
  const bothReady = planFirstRun({
    chosenId: 'qwen3.5-2b-q4_k_m',
    useDownloads: false,
    freeBytes: 0,
    chatInstalled: true,
    embedInstalled: true,
    chatInDownloads: false,
    embedInDownloads: false,
    catalog,
    embedding,
  })
  assert.equal(bothReady.action, 'done')
  const free = 200_000_000
  const disk = planFirstRun({
    chosenId: catalog[0].id,
    useDownloads: false,
    freeBytes: free,
    chatInstalled: false,
    embedInstalled: false,
    chatInDownloads: false,
    embedInDownloads: false,
    catalog,
    embedding,
  })
  assert.equal(disk.action, 'disk')
  assert.equal(disk.requiredBytes, requiredFreeBytes(catalog[0].sizeBytes + embedding.sizeBytes))
  assert.equal(disk.freeBytes, free)
  const copy = setupErrorCopy({ code: 'disk', requiredBytes: disk.requiredBytes, freeBytes: free })
  assert.match(copy.body, /1\.67 GB/)
  assert.match(copy.body, /200 MB/)
  const offline = setupErrorCopy({ code: 'offline' })
  assert.doesNotMatch(offline.body, /offline installer/i)
  assert.equal(formatByteCount(Number.NaN), '')
})

test('each screenshot fixture is the state it is named for', () => {
  const pick = setupShot('pick')
  assert.equal(pick.phase, 'pick')
  assert.equal(pick.choices.find((choice) => choice.id === 'qwen3.5-4b-q4_k_m')?.recommended, true)
  assert.match(pick.choices.find((choice) => choice.id === 'qwen3.5-9b-q4_k_m')?.warning ?? '', /16 GB/)
  assert.equal(pick.choices.find((choice) => choice.id === 'qwen3.5-2b-q4_k_m')?.inDownloads, true)
  const progress = setupShot('progress')
  assert.equal(progress.phase, 'downloading')
  assert.equal(progress.error, null)
  assert.equal(progress.files[0]?.name, 'Qwen 2B')
  assert.equal(progress.files[0]?.state, 'active')
  assert.equal(progress.files[0]?.done, 412_000_000)
  assert.equal(progress.files[1]?.name, 'EmbeddingGemma')
  assert.equal(progress.files[1]?.state, 'waiting')
  assert.equal(progress.files[1]?.total, 309_855_520)
  assert.equal(progress.done, 412_000_000)
  assert.equal(progress.total, 1_280_835_840)
  assert.equal(progress.bytesPerSecond, 8_200_000)
  assert.equal(formatByteCount(progress.done), '412 MB')
  assert.equal(formatByteRate(progress.bytesPerSecond ?? 0), '8.2 MB/s')
  assert.equal(setupShot('paused').phase, 'paused')
  assert.equal(setupShot('paused').bytesPerSecond, null)
  assert.equal(setupShot('offline').error?.code, 'offline')
  assert.equal(setupShot('disk').error?.code, 'disk')
  assert.equal(setupShot('disk').error?.freeBytes, 200_000_000)
  assert.equal(setupShot('disk').error?.requiredBytes, requiredFreeBytes(1_280_835_840 + 309_855_520))
  assert.equal(setupShot('checksum').error?.code, 'checksum')
})

test('speed needs two samples and is computed from them', () => {
  assert.equal(byteRate([{ at: 0, bytes: 0 }]), null)
  assert.equal(byteRate([{ at: 0, bytes: 1000 }, { at: 0, bytes: 2000 }]), null)
  assert.equal(byteRate([{ at: 1000, bytes: 0 }, { at: 2000, bytes: 2_000_000 }]), 2_000_000)
  assert.equal(formatByteRate(2_000_000), '2 MB/s')
  assert.equal(formatByteRate(Number.NaN), '')
})
