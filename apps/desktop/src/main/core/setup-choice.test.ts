import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { tierFor } from './hardware.js'
import { parseRegistry } from './model-registry.js'
import {
  byteRate,
  chooseSetupModel,
  formatByteCount,
  formatByteRate,
  formatRamGb,
  GITHUB_ASSET_LIMIT_BYTES,
  modelFromInstallerName,
  modelFromMarker,
  planSetup,
  recommendSetupModel,
  requiredFreeBytes,
  setupCatalog,
  setupErrorCopy,
  setupShot,
  suggestSmaller,
} from '../../shared/setup-choice.js'

const registry = parseRegistry(JSON.parse(readFileSync(fileURLToPath(new URL('../../../resources/models.registry.json', import.meta.url)), 'utf8')))
const catalog = setupCatalog(registry.models)

test('the setup catalog is the three Q4_K_M Qwen files', () => {
  assert.deepEqual(catalog.map((model) => model.token), ['2b', '4b', '9b'])
  assert.equal(catalog[0].sizeBytes, 1_280_835_840)
  assert.ok(catalog[0].sizeBytes < GITHUB_ASSET_LIMIT_BYTES)
  assert.equal(formatByteCount(catalog[0].sizeBytes), '1.28 GB')
  assert.equal(formatByteCount(catalog[1].sizeBytes), '2.74 GB')
  assert.equal(formatByteCount(catalog[2].sizeBytes), '5.68 GB')
})

test('a missing installer choice follows RAM, and unknown RAM is 2B', () => {
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
  const chosen = chooseSetupModel({ overrideId: null, markerId: null, linkId: null, ramGb: 16, catalog })
  assert.equal(chosen.id, 'qwen3.5-9b-q4_k_m')
  assert.equal(chosen.source, 'ram')
})

test('an installer marker beats a link, and a saved override beats the marker', () => {
  assert.equal(modelFromMarker('{"model":"qwen3.5-4b-q4_k_m"}'), 'qwen3.5-4b-q4_k_m')
  assert.equal(modelFromMarker('{"size":"9b"}'), 'qwen3.5-9b-q4_k_m')
  assert.equal(modelFromMarker('{"model":"nope"}'), null)
  assert.deepEqual(modelFromInstallerName('Synap.surf-0.2.0-arm64-4b.dmg'), { id: 'qwen3.5-4b-q4_k_m', bundled: false })
  assert.deepEqual(modelFromInstallerName('C:\\Users\\a\\Synap.surf-0.2.0-x64-offline-2b.exe'), { id: 'qwen3.5-2b-q4_k_m', bundled: true })
  assert.equal(modelFromInstallerName('Synap.surf-0.2.0-x64.exe'), null)
  const marked = chooseSetupModel({
    overrideId: null,
    markerId: 'qwen3.5-9b-q4_k_m',
    linkId: 'qwen3.5-2b-q4_k_m',
    ramGb: 4,
    catalog,
  })
  assert.equal(marked.id, 'qwen3.5-9b-q4_k_m')
  assert.equal(marked.source, 'installer')
  const saved = chooseSetupModel({
    overrideId: 'qwen3.5-2b-q4_k_m',
    markerId: 'qwen3.5-9b-q4_k_m',
    linkId: null,
    ramGb: 32,
    catalog,
  })
  assert.equal(saved.id, 'qwen3.5-2b-q4_k_m')
  assert.equal(saved.source, 'override')
})

test('a model that does not fit suggests a smaller one', () => {
  assert.equal(suggestSmaller('qwen3.5-9b-q4_k_m', 4, catalog), 'qwen3.5-2b-q4_k_m')
  assert.equal(suggestSmaller('qwen3.5-9b-q4_k_m', 8, catalog), 'qwen3.5-4b-q4_k_m')
  assert.equal(suggestSmaller('qwen3.5-2b-q4_k_m', 4, catalog), null)
  const plan = planSetup({
    chosenId: 'qwen3.5-9b-q4_k_m',
    ramGb: 4,
    freeBytes: 20_000_000_000,
    installedIds: [],
    adoptedId: null,
    bundledIds: [],
    catalog,
  })
  assert.equal(plan.action, 'ram')
  assert.equal(plan.suggestId, 'qwen3.5-2b-q4_k_m')
  assert.equal(plan.needRamGb, 16)
  const copy = setupErrorCopy({ code: 'ram', ramGb: 4, needRamGb: 16, suggestName: 'Qwen 2B' })
  assert.match(copy.body, /4 GB/)
  assert.match(copy.body, /16 GB/)
  assert.match(copy.body, /Qwen 2B/)
})

test('disk full reports the required bytes and the free bytes', () => {
  const size = catalog[0].sizeBytes
  const free = 200_000_000
  const plan = planSetup({
    chosenId: catalog[0].id,
    ramGb: 16,
    freeBytes: free,
    installedIds: [],
    adoptedId: null,
    bundledIds: [],
    catalog,
  })
  assert.equal(plan.action, 'disk')
  assert.equal(plan.requiredBytes, requiredFreeBytes(size))
  assert.equal(plan.freeBytes, free)
  const copy = setupErrorCopy({ code: 'disk', requiredBytes: plan.requiredBytes, freeBytes: free })
  assert.match(copy.body, /1\.34 GB/)
  assert.match(copy.body, /200 MB/)
  assert.equal(formatByteCount(Number.NaN), '')
  assert.equal(formatRamGb(7.6), '7.6 GB')
})

test('a file already adopted is kept, and a bundled file is copied', () => {
  const adopted = planSetup({
    chosenId: 'qwen3.5-9b-q4_k_m',
    ramGb: 32,
    freeBytes: null,
    installedIds: [],
    adoptedId: 'qwen3.5-4b-q4_k_m',
    bundledIds: [],
    catalog,
  })
  assert.equal(adopted.action, 'done')
  assert.equal(adopted.via, 'adopted')
  const installed = planSetup({
    chosenId: 'qwen3.5-2b-q4_k_m',
    ramGb: 4,
    freeBytes: 0,
    installedIds: ['qwen3.5-2b-q4_k_m'],
    adoptedId: null,
    bundledIds: [],
    catalog,
  })
  assert.equal(installed.via, 'installed')
  const bundled = planSetup({
    chosenId: 'qwen3.5-2b-q4_k_m',
    ramGb: 4,
    freeBytes: requiredFreeBytes(catalog[0].sizeBytes),
    installedIds: [],
    adoptedId: null,
    bundledIds: ['qwen3.5-2b-q4_k_m'],
    catalog,
  })
  assert.equal(bundled.action, 'copy')
})

test('each screenshot fixture is the state it is named for', () => {
  const progress = setupShot('progress')
  assert.equal(progress.phase, 'downloading')
  assert.equal(progress.error, null)
  assert.equal(progress.done, 412_000_000)
  assert.equal(progress.total, 1_280_835_840)
  assert.equal(progress.bytesPerSecond, 8_200_000)
  assert.equal(formatByteCount(progress.done), '412 MB')
  assert.equal(formatByteRate(progress.bytesPerSecond ?? 0), '8.2 MB/s')
  assert.ok(progress.done > 0 && progress.done < progress.total)
  assert.equal(setupShot('paused').phase, 'paused')
  assert.equal(setupShot('paused').bytesPerSecond, null)
  assert.equal(setupShot('offline').error?.code, 'offline')
  assert.equal(setupShot('disk').error?.code, 'disk')
  assert.equal(setupShot('disk').error?.freeBytes, 200_000_000)
  assert.equal(setupShot('checksum').error?.code, 'checksum')
  assert.equal(setupShot('ram').error?.code, 'ram')
  assert.equal(setupShot('ram').error?.needRamGb, 16)
})

test('speed needs two samples and is computed from them', () => {
  assert.equal(byteRate([{ at: 0, bytes: 0 }]), null)
  assert.equal(byteRate([{ at: 0, bytes: 1000 }, { at: 0, bytes: 2000 }]), null)
  assert.equal(byteRate([{ at: 1000, bytes: 0 }, { at: 2000, bytes: 2_000_000 }]), 2_000_000)
  assert.equal(formatByteRate(2_000_000), '2 MB/s')
  assert.equal(formatByteRate(Number.NaN), '')
})
