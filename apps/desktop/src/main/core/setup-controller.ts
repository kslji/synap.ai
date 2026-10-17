/**
 * First open: pick the Qwen file, adopt one that is already in Downloads,
 * copy the offline installer's copy, or download it. Pause keeps the .part file.
 */
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  byteRate,
  chooseSetupModel,
  modelFromMarker,
  planSetup,
  type SetupErrorView,
  type SetupModel,
  type SetupPlan,
  type SetupSnapshot,
} from '../../shared/setup-choice.js'
import { copyVerified, downloadVerified, DownloadError, isAbortError, type DownloadSpec } from './model-download.js'

export type { SetupErrorView, SetupSnapshot }

export interface SetupHost {
  ramGb: () => number
  markerText: () => string | null
  overrideText: () => string | null
  writeOverride: (modelId: string) => void
  linkModelId: () => string | null
  catalog: () => SetupModel[]
  isInstalled: (model: SetupModel) => Promise<boolean>
  adopt: (preferredId: string) => Promise<string | null>
  bundled: (model: SetupModel) => boolean
  spec: (model: SetupModel) => DownloadSpec
  bundledSource: (model: SetupModel) => string | null
  saveChoice: (modelId: string) => void
  offlineOnly: () => boolean
  freeBytes: (dir: string) => Promise<number | null>
  emit: (snapshot: SetupSnapshot) => void
  download?: typeof downloadVerified
  copy?: typeof copyVerified
}

const EMPTY: SetupSnapshot = {
  phase: 'idle',
  modelId: '',
  modelName: '',
  source: 'default',
  ramGb: null,
  done: 0,
  total: 0,
  bytesPerSecond: null,
  error: null,
}

export function createSetupController(host: SetupHost) {
  let snapshot: SetupSnapshot = { ...EMPTY }
  let abort: AbortController | null = null
  let running: Promise<void> | null = null
  let generation = 0
  let samples: { at: number; bytes: number }[] = []

  function publish(next: SetupSnapshot): void {
    snapshot = next
    host.emit(snapshot)
  }

  function modelOf(catalog: readonly SetupModel[], id: string): SetupModel {
    const found = catalog.find((model) => model.id === id)
    if (!found) throw new Error('no setup model')
    return found
  }

  async function run(): Promise<void> {
    const gen = ++generation
    samples = []
    const catalog = host.catalog()
    const ramGb = host.ramGb()
    const chosen = chooseSetupModel({
      overrideId: modelFromMarker(host.overrideText()),
      markerId: modelFromMarker(host.markerText()),
      linkId: host.linkModelId(),
      ramGb,
      catalog,
    })
    publish({
      ...EMPTY,
      phase: 'checking',
      modelId: chosen.id,
      modelName: modelOf(catalog, chosen.id).name,
      source: chosen.source,
      ramGb: ramGb > 0 ? ramGb : null,
    })
    const adoptedId = await host.adopt(chosen.id)
    if (gen !== generation) return
    const installed: string[] = []
    for (const model of catalog) {
      if (await host.isInstalled(model)) installed.push(model.id)
    }
    if (gen !== generation) return
    const current = modelOf(catalog, chosen.id)
    const spec = host.spec(current)
    mkdirSync(dirname(spec.dest), { recursive: true })
    const free = await host.freeBytes(dirname(spec.dest))
    const bundledIds = catalog.filter((model) => host.bundled(model)).map((model) => model.id)
    const plan = planSetup({
      chosenId: chosen.id,
      ramGb: ramGb > 0 ? ramGb : null,
      freeBytes: free,
      installedIds: installed,
      adoptedId,
      bundledIds,
      catalog,
    })
    if (gen !== generation) return
    if (plan.action === 'done') {
      finish(plan.modelId, catalog, chosen.source, ramGb)
      return
    }
    if (plan.action === 'ram' || plan.action === 'disk') {
      publish(errorSnapshot(plan, catalog, chosen.source, ramGb))
      return
    }
    if (plan.action === 'download' && host.offlineOnly()) {
      publish({
        ...snapshot,
        phase: 'error',
        modelId: plan.modelId,
        modelName: modelOf(catalog, plan.modelId).name,
        total: spec.size,
        error: { code: 'offline' },
      })
      return
    }
    await transfer(plan, catalog, chosen.source, ramGb, gen)
  }

  async function transfer(plan: SetupPlan, catalog: readonly SetupModel[], source: SetupSnapshot['source'], ramGb: number, gen: number): Promise<void> {
    const model = modelOf(catalog, plan.modelId)
    const spec = host.spec(model)
    const phase = plan.action === 'copy' ? 'copying' : 'downloading'
    const ac = new AbortController()
    abort = ac
    samples = []
    publish({
      phase,
      modelId: model.id,
      modelName: model.name,
      source,
      ramGb: ramGb > 0 ? ramGb : null,
      done: 0,
      total: spec.size,
      bytesPerSecond: null,
      error: null,
    })
    const onProgress = (done: number) => {
      if (gen !== generation || ac.signal.aborted) return
      const at = Date.now()
      samples.push({ at, bytes: done })
      if (samples.length > 6) samples.shift()
      publish({
        ...snapshot,
        phase,
        done,
        total: spec.size,
        bytesPerSecond: byteRate(samples),
        error: null,
      })
    }
    try {
      if (plan.action === 'copy') {
        const sourcePath = host.bundledSource(model)
        if (!sourcePath) throw new DownloadError('network', 'no internet')
        const copy = host.copy ?? copyVerified
        await copy(sourcePath, spec, onProgress, ac.signal)
      } else {
        const download = host.download ?? downloadVerified
        await download(spec, onProgress, ac.signal)
      }
      if (gen !== generation) return
      finish(model.id, catalog, source, ramGb)
    } catch (error) {
      if (gen !== generation) return
      if (isAbortError(error) || ac.signal.aborted) {
        publish({ ...snapshot, phase: 'paused', bytesPerSecond: null })
        return
      }
      publish({ ...snapshot, phase: 'error', bytesPerSecond: null, error: errorView(error) })
    } finally {
      if (abort === ac) abort = null
    }
  }

  function finish(modelId: string, catalog: readonly SetupModel[], source: SetupSnapshot['source'], ramGb: number): void {
    const model = modelOf(catalog, modelId)
    host.saveChoice(modelId)
    publish({
      phase: 'done',
      modelId,
      modelName: model.name,
      source,
      ramGb: ramGb > 0 ? ramGb : null,
      done: model.sizeBytes,
      total: model.sizeBytes,
      bytesPerSecond: null,
      error: null,
    })
  }

  function errorSnapshot(plan: SetupPlan, catalog: readonly SetupModel[], source: SetupSnapshot['source'], ramGb: number): SetupSnapshot {
    const model = modelOf(catalog, plan.modelId)
    const suggest = plan.suggestId ? catalog.find((item) => item.id === plan.suggestId) : undefined
    return {
      phase: 'error',
      modelId: model.id,
      modelName: model.name,
      source,
      ramGb: plan.ramGb ?? (ramGb > 0 ? ramGb : null),
      done: 0,
      total: model.sizeBytes,
      bytesPerSecond: null,
      error: plan.action === 'ram'
        ? { code: 'ram', ramGb: plan.ramGb ?? null, needRamGb: plan.needRamGb ?? null, suggestId: suggest?.id ?? null, suggestName: suggest?.name ?? null }
        : { code: 'disk', requiredBytes: plan.requiredBytes ?? null, freeBytes: plan.freeBytes ?? null },
    }
  }

  function errorView(error: unknown): SetupErrorView {
    if (error instanceof DownloadError) {
      if (error.code === 'disk') return { code: 'disk', requiredBytes: error.requiredBytes, freeBytes: error.freeBytes }
      if (error.code === 'checksum' || error.code === 'size') return { code: 'checksum' }
      if (error.code === 'http') return { code: 'http', httpStatus: error.httpStatus }
      return { code: 'offline' }
    }
    return { code: 'offline' }
  }

  async function start(): Promise<void> {
    if (snapshot.phase === 'downloading' || snapshot.phase === 'copying' || snapshot.phase === 'checking') return
    if (running) return
    const job = run()
    running = job
    try { await job } finally { if (running === job) running = null }
  }

  return {
    state: async () => snapshot,
    start,
    pause() {
      abort?.abort()
    },
    resume: () => start(),
    retry: () => start(),
    async useSmaller(modelId: string) {
      host.writeOverride(modelId)
      generation += 1
      abort?.abort()
      abort = null
      if (running) await running.catch(() => undefined)
      snapshot = { ...snapshot, phase: 'idle' }
      await start()
    },
  }
}
