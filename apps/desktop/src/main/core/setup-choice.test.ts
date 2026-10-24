import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { tierFor } from './hardware.js'
import { parseRegistry } from './model-registry.js'
import {
  bundledModelBytes,
  byteRate,
  fitsGitHubAsset,
  formatByteCount,
  formatByteRate,
  formatRamGb,
  GITHUB_ASSET_LIMIT_BYTES,
  keywordSearchNote,
  planEmbeddingRepair,
  planFirstRun,
  requiredFreeBytes,
  setupCatalog,
  setupChoices,
  setupEmbedding,
  setupReranker,
  setupErrorCopy,
  setupShot,
} from '../../shared/setup-choice.js'

const registry = parseRegistry(JSON.parse(readFileSync(fileURLToPath(new URL('../../../resources/models.registry.json', import.meta.url)), 'utf8')))
const catalog = setupCatalog(registry.models)
const embedding = setupEmbedding(registry.models)
const reranker = setupReranker(registry.models)
if (!embedding) throw new Error('registry has no embedding model')
if (!reranker) throw new Error('registry has no reranker model')

test('the setup catalog is the one Qwen 2B file, plus the Jina search and rerank models', () => {
  assert.deepEqual(catalog.map((model) => model.id), ['qwen3.5-2b-q4_k_m'])
  assert.equal(catalog[0].name, 'Qwen 2B')
  assert.equal(catalog[0].minRamGb, 8)
  assert.equal(formatByteCount(catalog[0].sizeBytes), '1.28 GB')
  assert.equal(embedding.name, 'Search model')
  assert.equal(embedding.sizeBytes, 121_387_072)
  assert.equal(formatByteCount(embedding.sizeBytes), '121.4 MB')
  assert.equal(reranker.name, 'Rerank model')
  assert.equal(reranker.sizeBytes, 37_323_936)
  assert.equal(formatByteCount(reranker.sizeBytes), '37.3 MB')
  assert.equal(tierFor(4, 0, false), 0)
  assert.equal(tierFor(8, 0, false), 1)
  assert.equal(tierFor(16, 0, false), 2)
})

test('the one choice warns below 8 GB and stays downloadable', () => {
  const unknown = setupChoices(catalog, null, [], embedding.sizeBytes, reranker.sizeBytes)
  assert.equal(unknown.length, 1)
  assert.equal(unknown[0].warning, null)
  assert.equal(unknown[0].withSearchBytes, catalog[0].sizeBytes + embedding.sizeBytes + reranker.sizeBytes)
  assert.equal(setupChoices(catalog, 7.6, [], embedding.sizeBytes, reranker.sizeBytes)[0].warning, null)
  assert.equal(setupChoices(catalog, 16, [], embedding.sizeBytes, reranker.sizeBytes)[0].warning, null)
  const tight = setupChoices(catalog, 4, ['qwen3.5-2b-q4_k_m'], embedding.sizeBytes, reranker.sizeBytes)
  assert.match(tight[0].warning ?? '', /needs 8 GB/)
  assert.match(tight[0].warning ?? '', /has 4 GB/)
  assert.equal(tight[0].inDownloads, true)
  assert.equal(formatRamGb(7.6), '7.6 GB')
})

test('the search and rerank models are always in the plan', () => {
  const plan = planFirstRun({
    chosenId: 'qwen3.5-2b-q4_k_m',
    useDownloads: false,
    freeBytes: 20_000_000_000,
    chatInstalled: false,
    embedInstalled: false,
    chatInDownloads: false,
    embedInDownloads: false,
    catalog,
    embedding,
    reranker,
  })
  assert.equal(plan.action, 'run')
  assert.deepEqual(plan.steps.map((step) => step.role), ['chat', 'embedding', 'reranker'])
  assert.deepEqual(plan.steps.map((step) => step.action), ['download', 'download', 'download'])
  assert.equal(plan.steps[1]?.id, embedding.id)
  assert.equal(plan.steps[2]?.id, reranker.id)
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
    reranker,
    rerankInDownloads: true,
  })
  assert.equal(adopted.action, 'run')
  assert.deepEqual(adopted.steps.map((step) => step.action), ['copy', 'copy', 'copy'])
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
    reranker,
  })
  assert.deepEqual(chatOnly.steps.map((step) => step.action), ['copy', 'ready', 'download'])
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
    reranker,
    rerankInstalled: true,
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
    reranker,
  })
  assert.equal(disk.action, 'disk')
  assert.equal(disk.requiredBytes, requiredFreeBytes(catalog[0].sizeBytes + embedding.sizeBytes + reranker.sizeBytes))
  assert.equal(disk.freeBytes, free)
  const copy = setupErrorCopy({ code: 'disk', requiredBytes: disk.requiredBytes, freeBytes: free })
  assert.match(copy.body, /1\.58 GB/)
  assert.match(copy.body, /200 MB/)
  const offline = setupErrorCopy({ code: 'offline' })
  assert.doesNotMatch(offline.body, /offline installer/i)
  assert.equal(formatByteCount(Number.NaN), '')
})

test('each screenshot fixture is the state it is named for', () => {
  const pick = setupShot('pick')
  assert.equal(pick.phase, 'pick')
  assert.deepEqual(pick.choices.map((choice) => choice.id), ['qwen3.5-2b-q4_k_m'])
  assert.equal(pick.choices[0]?.inDownloads, true)
  const progress = setupShot('progress')
  assert.equal(progress.phase, 'downloading')
  assert.equal(progress.error, null)
  assert.equal(progress.files[0]?.name, 'Qwen 2B')
  assert.equal(progress.files[0]?.state, 'active')
  assert.equal(progress.files[0]?.done, 412_000_000)
  assert.equal(progress.files[1]?.name, 'Search model')
  assert.equal(progress.files[1]?.state, 'waiting')
  assert.equal(progress.files[1]?.total, 121_387_072)
  assert.equal(progress.files[2]?.name, 'Rerank model')
  assert.equal(progress.files[2]?.total, 37_323_936)
  assert.equal(progress.done, 412_000_000)
  assert.equal(progress.total, 1_280_835_840 + 121_387_072 + 37_323_936)
  assert.equal(formatByteCount(progress.total), '1.44 GB')
  assert.equal(progress.bytesPerSecond, 8_200_000)
  assert.equal(formatByteCount(progress.done), '412 MB')
  assert.equal(formatByteRate(progress.bytesPerSecond ?? 0), '8.2 MB/s')
  assert.equal(setupShot('paused').phase, 'paused')
  assert.equal(setupShot('paused').bytesPerSecond, null)
  assert.equal(setupShot('offline').error?.code, 'offline')
  assert.equal(setupShot('disk').error?.code, 'disk')
  assert.equal(setupShot('disk').error?.freeBytes, 200_000_000)
  assert.equal(setupShot('disk').error?.requiredBytes, requiredFreeBytes(1_280_835_840 + 121_387_072 + 37_323_936))
  assert.equal(setupShot('checksum').error?.code, 'checksum')
})

test('a later launch repairs both search files', () => {
  const missing = planEmbeddingRepair({
    embedding,
    embedInstalled: false,
    embedInDownloads: false,
    freeBytes: 20_000_000_000,
    reranker,
  })
  assert.equal(missing.action, 'run')
  assert.deepEqual(missing.steps.map((step) => step.role), ['embedding', 'reranker'])
  assert.equal(missing.steps[0]?.name, 'Search model')
  assert.equal(missing.steps[0]?.action, 'download')
  assert.equal(missing.steps[1]?.name, 'Rerank model')
  const copied = planEmbeddingRepair({
    embedding,
    embedInstalled: false,
    embedInDownloads: true,
    freeBytes: 20_000_000_000,
    reranker,
    rerankInDownloads: true,
  })
  assert.deepEqual(copied.steps.map((step) => step.action), ['copy', 'copy'])
  const ready = planEmbeddingRepair({
    embedding,
    embedInstalled: true,
    embedInDownloads: false,
    freeBytes: 0,
    reranker,
    rerankInstalled: true,
  })
  assert.equal(ready.action, 'done')
})

test('Qwen 2B plus both search files fits one GitHub release asset, and the optional 4B does not', () => {
  const pair = bundledModelBytes(catalog[0].sizeBytes, embedding.sizeBytes, reranker.sizeBytes)
  assert.equal(pair, 1_439_546_848)
  assert.equal(fitsGitHubAsset(pair), true)
  const optional4b = bundledModelBytes(2_740_937_888, embedding.sizeBytes, reranker.sizeBytes)
  assert.equal(fitsGitHubAsset(optional4b), false)
  assert.equal(fitsGitHubAsset(GITHUB_ASSET_LIMIT_BYTES - 1), true)
})

test('keyword search is named only while the search model is downloading or the computer is offline', () => {
  assert.match(keywordSearchNote('downloading'), /until the search model finishes downloading/)
  assert.match(keywordSearchNote('offline'), /offline/)
  assert.match(keywordSearchNote('offline'), /keywords/)
})

test('speed needs two samples and is computed from them', () => {
  assert.equal(byteRate([{ at: 0, bytes: 0 }]), null)
  assert.equal(byteRate([{ at: 0, bytes: 1000 }, { at: 0, bytes: 2000 }]), null)
  assert.equal(byteRate([{ at: 1000, bytes: 0 }, { at: 2000, bytes: 2_000_000 }]), 2_000_000)
  assert.equal(formatByteRate(2_000_000), '2 MB/s')
  assert.equal(formatByteRate(Number.NaN), '')
})
