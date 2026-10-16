import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createFrameBatcher, createTextBatch, takeOutputUpdate } from '../../shared/stream-batch.js'
import { BackgroundIndex } from './live/index-queue.js'
import { MetricsLog } from './live/metrics-log.js'
import { aggregateUsage, cpuPercent, metricLine, parseProcCpu, percentile } from './live/metrics.js'
import {
  DRAFT_MODEL_ID,
  modelFitsLaptop,
  prefixCacheKey,
  promptCacheMiB,
  promptCacheReuse,
  qwenDefaultParams,
  routeStepModel,
  runtimeSupportsSpeculative,
  selectKeepWarmModel,
  selectRoutePair,
  shouldUnload,
  speculativeDecision,
  speculativeServerArgs,
  type LiveModel,
} from './live/policy.js'
import { assertInsideAppData, buildStorageReport, removeInside, treeBytes } from './live/storage.js'

const qwen2: LiveModel = { id: 'qwen-2b', family: 'qwen3.5', paramsB: 2, sizeBytes: 1_280_000_000, minRamGb: 4 }
const qwen4: LiveModel = { id: 'qwen-4b', family: 'qwen3.5', paramsB: 4, sizeBytes: 2_740_000_000, minRamGb: 8 }
const qwen9: LiveModel = { id: 'qwen-9b', family: 'qwen3.5', paramsB: 9, sizeBytes: 5_680_000_000, minRamGb: 16 }
const gemma8: LiveModel = { id: 'gemma-e2b', family: 'gemma4', paramsB: 2, sizeBytes: 3_350_000_000, minRamGb: 8 }
const draft: LiveModel = { id: DRAFT_MODEL_ID, family: 'qwen3', paramsB: 0.6, sizeBytes: 396_705_472, minRamGb: 4, draft: true }

test('Qwen defaults follow the laptop class and the file cap', () => {
  assert.equal(qwenDefaultParams(3.8), 2)
  assert.equal(qwenDefaultParams(8), 4)
  assert.equal(qwenDefaultParams(15.6), 9)
  assert.equal(qwenDefaultParams(32), 9)
  assert.equal(modelFitsLaptop(qwen2, 4), true)
  assert.equal(modelFitsLaptop(qwen4, 4), false)
  assert.equal(modelFitsLaptop(qwen4, 8), true)
  assert.equal(modelFitsLaptop(qwen9, 16), false)
  assert.equal(modelFitsLaptop(qwen9, 32), true)
  assert.equal(modelFitsLaptop(gemma8, 8), false)
  assert.equal(modelFitsLaptop(gemma8, 16), true)
})

test('keep-warm loads the selected model when it fits, otherwise the Qwen default, and unloads after idle', () => {
  const models = [qwen2, qwen4, qwen9, gemma8, draft]
  const installed = new Set([qwen2.id, qwen4.id, qwen9.id, gemma8.id, draft.id])
  assert.equal(selectKeepWarmModel({ enabled: false, totalRamGb: 32, selectedId: qwen9.id, models, installed }), null)
  assert.equal(selectKeepWarmModel({ enabled: true, totalRamGb: 4, selectedId: qwen2.id, models, installed })?.id, qwen2.id)
  assert.equal(selectKeepWarmModel({ enabled: true, totalRamGb: 4, selectedId: gemma8.id, models, installed })?.id, qwen2.id)
  assert.equal(selectKeepWarmModel({ enabled: true, totalRamGb: 8, selectedId: '', models, installed })?.id, qwen4.id)
  assert.equal(selectKeepWarmModel({ enabled: true, totalRamGb: 16, selectedId: qwen9.id, models, installed })?.id, qwen4.id)
  assert.equal(selectKeepWarmModel({ enabled: true, totalRamGb: 32, selectedId: gemma8.id, models, installed })?.id, gemma8.id)
  assert.equal(selectKeepWarmModel({ enabled: true, totalRamGb: 32, selectedId: draft.id, models, installed })?.id, qwen9.id)
  assert.equal(shouldUnload({ enabled: true, busy: false, lastUsedAt: 0, now: 15 * 60_000, idleMinutes: 15 }), true)
  assert.equal(shouldUnload({ enabled: true, busy: false, lastUsedAt: 0, now: 15 * 60_000 - 1, idleMinutes: 15 }), false)
  assert.equal(shouldUnload({ enabled: true, busy: true, lastUsedAt: 0, now: 60 * 60_000, idleMinutes: 1 }), false)
  assert.equal(shouldUnload({ enabled: false, busy: false, lastUsedAt: 0, now: 0, idleMinutes: 15 }), true)
  assert.equal(shouldUnload({ enabled: false, busy: true, lastUsedAt: 0, now: 0, idleMinutes: 15 }), false)
})

test('simple edits and triage use the small model, and planning uses the large one only when both fit', () => {
  const both = selectRoutePair({ totalRamGb: 32, models: [qwen2, qwen9, draft], installed: new Set([qwen2.id, qwen9.id, draft.id]) })
  assert.equal(both.dual, true)
  assert.equal(routeStepModel({ kind: 'triage', ...both }).modelId, qwen2.id)
  assert.equal(routeStepModel({ kind: 'edit', ...both }).reason, 'small')
  assert.equal(routeStepModel({ kind: 'plan', ...both }).modelId, qwen9.id)
  assert.equal(routeStepModel({ kind: 'hard-fix', ...both }).reason, 'large')

  const tight = selectRoutePair({ totalRamGb: 8, models: [qwen2, qwen9], installed: new Set([qwen2.id, qwen9.id]) })
  assert.equal(tight.dual, false)
  assert.equal(tight.small?.id, qwen2.id)
  assert.equal(routeStepModel({ kind: 'plan', ...tight }).reason, 'only')
  assert.equal(routeStepModel({ kind: 'edit', ...tight }).modelId, qwen2.id)

  const none = selectRoutePair({ totalRamGb: 4, models: [qwen9], installed: new Set([qwen9.id]) })
  assert.equal(routeStepModel({ kind: 'plan', ...none }).reason, 'none')
})

test('the prompt cache key is reused for the same system and project context', () => {
  const system = '# Rules\nStay inside the project.\n'
  const project = 'root:/work/app\n'
  const key = prefixCacheKey(system, project)
  assert.equal(prefixCacheKey(system, project), key)
  assert.notEqual(prefixCacheKey(system, 'root:/work/other\n'), key)
  assert.notEqual(prefixCacheKey('# Rules\nChanged.\n', project), key)
  const first = promptCacheReuse(null, key)
  assert.equal(first.reuse, false)
  assert.equal(first.cachePrompt, true)
  const again = promptCacheReuse(key, key)
  assert.equal(again.reuse, true)
  assert.equal(again.cachePrompt, true)
  const moved = promptCacheReuse(key, prefixCacheKey(system, 'root:/elsewhere\n'))
  assert.equal(moved.reuse, false)
  assert.equal(moved.cachePrompt, true)
  assert.equal(promptCacheReuse(null, key, false).cachePrompt, false)
  assert.equal(promptCacheReuse(key, key, false).reuse, false)
  assert.equal(promptCacheMiB(4), 0)
  assert.equal(promptCacheMiB(8), 256)
  assert.equal(promptCacheMiB(16), 512)
  assert.equal(promptCacheMiB(32), 1024)
})

test('speculative decoding stays off unless the runtime, the draft, and RAM all allow it', () => {
  const base = {
    userEnabled: true,
    runtimeSupports: true,
    draftInstalled: true,
    totalRamGb: 16,
    mainSizeBytes: qwen4.sizeBytes,
    draftSizeBytes: draft.sizeBytes,
    mainMinRamGb: qwen4.minRamGb,
  }
  assert.equal(speculativeDecision(base).enabled, true)
  assert.equal(speculativeDecision(base).offerDownload, false)
  assert.deepEqual(speculativeServerArgs(true, '/models/draft.gguf'), ['-md', '/models/draft.gguf', '--draft-max', '8'])
  assert.deepEqual(speculativeServerArgs(false, '/models/draft.gguf'), [])
  assert.equal(speculativeDecision({ ...base, userEnabled: false }).reason, 'off')
  assert.equal(speculativeDecision({ ...base, userEnabled: false, draftInstalled: false }).offerDownload, true)
  assert.equal(speculativeDecision({ ...base, runtimeSupports: false }).reason, 'runtime')
  assert.equal(speculativeDecision({ ...base, runtimeSupports: false }).offerDownload, false)
  assert.equal(speculativeDecision({ ...base, draftInstalled: false }).reason, 'missing')
  assert.equal(speculativeDecision({ ...base, draftInstalled: false }).offerDownload, true)
  assert.equal(speculativeDecision({ ...base, totalRamGb: 4, mainSizeBytes: qwen2.sizeBytes, mainMinRamGb: 4 }).reason, 'ram')
  assert.equal(speculativeDecision({ ...base, mainSizeBytes: qwen9.sizeBytes, mainMinRamGb: 16 }).reason, 'ram')
  assert.equal(runtimeSupportsSpeculative('usage: llama-server --model-draft FNAME'), true)
  assert.equal(runtimeSupportsSpeculative('-md FNAME'), true)
  assert.equal(runtimeSupportsSpeculative('no draft flag here'), false)
})

test('usage totals, per-model rows, daily rows, and percentiles stay on the samples', () => {
  const day = Date.parse('2026-10-16T12:00:00.000Z')
  const report = aggregateUsage([
    { at: day, modelId: 'qwen-2b', tasks: 1, steps: 2, tokensIn: 100, tokensOut: 40, ttftMs: 100, genMs: 1000, ramMb: 800, cpuPercent: 20 },
    { at: day + 1000, modelId: 'qwen-2b', tasks: 0, steps: 1, tokensIn: 50, tokensOut: 60, ttftMs: 300, genMs: 1000, ramMb: 900, cpuPercent: 40 },
    { at: Date.parse('2026-10-15T08:00:00.000Z'), modelId: 'qwen-9b', tasks: 1, steps: 4, tokensIn: 20, tokensOut: 10, ttftMs: 200, genMs: 500, ramMb: 2000, cpuPercent: 50 },
  ])
  assert.equal(report.localOnly, true)
  assert.equal(report.tasks, 2)
  assert.equal(report.steps, 7)
  assert.equal(report.tokensIn, 170)
  assert.equal(report.tokensOut, 110)
  assert.equal(report.tokensPerSec, 44)
  assert.equal(report.ttftP50Ms, 200)
  assert.equal(report.ttftP95Ms, 300)
  assert.equal(report.models[0]?.modelId, 'qwen-2b')
  assert.equal(report.models[0]?.tokensOut, 100)
  assert.equal(report.models[1]?.modelId, 'qwen-9b')
  assert.deepEqual(report.days.map((row) => row.day), ['2026-10-15', '2026-10-16'])
  assert.equal(percentile([], 50), null)
  const line = metricLine({
    at: day, modelId: 'qwen-2b', tasks: 1, steps: 2, tokensIn: 100, tokensOut: 40, ttftMs: 100, genMs: 1000, ramMb: 800, cpuPercent: 20,
  })
  assert.match(line, new RegExp(`^at=${day} model=qwen-2b `))
  assert.equal(line.includes('secret prompt'), false)
  assert.equal(parseProcCpu('9 (llama-server) S 1 1 1 0 -1 0 0 0 0 0 10 20')?.ticks, 30)
  assert.equal(parseProcCpu('9 (llama server) S 1 1 1 0 -1 0 0 0 0 0 10 20')?.ticks, 30)
  assert.equal(cpuPercent(10, 30, 1000, 100), 20)
})

test('the metrics file resets and the log line has no answer text', () => {
  const root = mkdtempSync(join(tmpdir(), 'surf-usage-'))
  try {
    const log = new MetricsLog(join(root, 'usage.json'), join(root, 'logs', 'live.log'))
    log.record({
      at: Date.parse('2026-10-16T00:00:00.000Z'),
      modelId: 'qwen-2b',
      tasks: 1,
      steps: 3,
      tokensIn: 10,
      tokensOut: 5,
      ttftMs: 40,
      genMs: 200,
      ramMb: 100,
      cpuPercent: 5,
    })
    assert.equal(log.report().tasks, 1)
    assert.equal(log.reset().tasks, 0)
    assert.equal(log.report().steps, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('storage totals add up and delete refuses a path outside app data', () => {
  const report = buildStorageReport({
    freeBytes: 50,
    diskBytes: 100,
    categories: [
      { id: 'models', label: 'Models', bytes: 0, items: [{ id: 'a.gguf', label: 'a.gguf', bytes: 10 }] },
      { id: 'packs', label: 'Packs', bytes: 0, items: [{ id: 'marine', label: 'Marine', bytes: 4, version: '2026.10.16' }] },
      { id: 'indexes', label: 'Indexes', bytes: 0, items: [] },
      { id: 'chats', label: 'Chats', bytes: 0, items: [{ id: 'history', label: 'Chat history', bytes: 3 }] },
      { id: 'web', label: 'Web', bytes: 0, items: [{ id: 'web', label: 'Web cache', bytes: 2 }] },
      { id: 'logs', label: 'Logs', bytes: 0, items: [{ id: 'live.log', label: 'live.log', bytes: 1 }] },
    ],
  })
  assert.equal(report.totalBytes, 20)
  assert.equal(report.categories.find((row) => row.id === 'packs')?.items[0]?.version, '2026.10.16')

  const root = mkdtempSync(join(tmpdir(), 'surf-store-'))
  const outside = mkdtempSync(join(tmpdir(), 'surf-outside-'))
  try {
    mkdirSync(join(root, 'models'))
    writeFileSync(join(root, 'models', 'a.gguf'), '12345')
    writeFileSync(join(outside, 'secret.txt'), 'keep')
    symlinkSync(join(outside, 'secret.txt'), join(root, 'models', 'leak'))
    assert.equal(treeBytes(join(root, 'models')) >= 5, true)
    assert.throws(() => assertInsideAppData(root, outside), /outside app data/)
    assert.throws(() => assertInsideAppData(root, join(root, '..', 'secret.txt')), /outside app data/)
    assert.throws(() => removeInside(root, join(root, 'models', 'leak')), /outside app data/)
    assert.equal(existsSync(join(outside, 'secret.txt')), true)
    removeInside(root, join(root, 'models', 'a.gguf'))
    assert.equal(existsSync(join(root, 'models', 'a.gguf')), false)
    assert.throws(() => removeInside(root, root), /outside app data/)
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  }
})

test('background indexing lets a search run before the rest of the queue', async () => {
  let release: () => void = () => undefined
  const hold = new Promise<void>((resolve) => { release = resolve })
  const order: string[] = []
  const index = new BackgroundIndex(async (path) => {
    order.push(`start:${path}`)
    if (path === 'a') await hold
    order.push(`end:${path}`)
  })
  index.enqueue(['a', 'b', 'c'])
  await waitFor(() => order.includes('start:a'))
  const search = index.prioritize(async () => { order.push('search') })
  release()
  await search
  await index.whenIdle()
  assert.deepEqual(order, ['start:a', 'end:a', 'search', 'start:b', 'end:b', 'start:c', 'end:c'])
})

test('token updates batch until the limit or a flush', () => {
  const batch = createTextBatch(4)
  assert.equal(batch.push('ab'), null)
  assert.equal(batch.push('cd'), 'abcd')
  assert.equal(batch.push('x\n'), 'x\n')
  assert.equal(batch.flush(), null)
  batch.push('z')
  assert.equal(batch.flush(), 'z')
  assert.deepEqual(takeOutputUpdate('', 'short', 80), { pending: 'short', emit: false })
  assert.deepEqual(takeOutputUpdate('short', '\nmore', 80), { pending: '', emit: true })

  const seen: string[][] = []
  const queued: { fn: (() => void) | null } = { fn: null }
  const frames = createFrameBatcher<string>(
    (items) => seen.push(items),
    (fn) => { queued.fn = fn; return 1 },
    () => { queued.fn = null },
    (item) => item === 'done',
  )
  frames.push('a')
  frames.push('b')
  assert.equal(seen.length, 0)
  queued.fn?.()
  assert.deepEqual(seen, [['a', 'b']])
  frames.push('done')
  assert.deepEqual(seen[1], ['done'])
})

async function waitFor(ready: () => boolean): Promise<void> {
  for (let i = 0; i < 50; i++) {
    if (ready()) return
    await new Promise((resolve) => setImmediate(resolve))
  }
  throw new Error('timed out')
}
