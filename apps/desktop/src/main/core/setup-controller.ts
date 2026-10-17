/**
 * First open shows Qwen 2B, 4B, and 9B. Download fetches that file and
 * EmbeddingGemma. Pause keeps the .part file. A Downloads copy is used only
 * when the person asks.
 */
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  byteRate,
  planFirstRun,
  setupChoices,
  type FirstRunPlan,
  type SetupEmbed,
  type SetupErrorView,
  type SetupFileView,
  type SetupModel,
  type SetupSnapshot,
  type SetupStep,
} from '../../shared/setup-choice.js'
import { downloadVerified, DownloadError, isAbortError, type DownloadSpec } from './model-download.js'

export type { SetupErrorView, SetupSnapshot }

export interface SetupHost {
  ramGb: () => number
  catalog: () => SetupModel[]
  embedding: () => SetupEmbed
  isInstalled: (file: string, size: number) => Promise<boolean>
  inDownloads: (file: string, size: number, sha256: string) => Promise<boolean>
  takeDownloads: (file: string, size: number, sha256: string, dest: string) => Promise<void>
  spec: (step: SetupStep) => DownloadSpec
  saveChoice: (modelId: string) => void
  offlineOnly: () => boolean
  freeBytes: (dir: string) => Promise<number | null>
  emit: (snapshot: SetupSnapshot) => void
  download?: typeof downloadVerified
}

const EMPTY: SetupSnapshot = {
  phase: 'pick',
  modelId: '',
  modelName: '',
  ramGb: null,
  choices: [],
  files: [],
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
  let pending: { modelId: string; useDownloads: boolean } | null = null

  function publish(next: SetupSnapshot): void {
    snapshot = next
    host.emit(snapshot)
  }

  async function showPick(): Promise<void> {
    if (snapshot.phase === 'downloading' || snapshot.phase === 'checking') return
    const catalog = host.catalog()
    const ramGb = host.ramGb()
    const downloads: string[] = []
    for (const model of catalog) {
      if (await host.inDownloads(model.file, model.sizeBytes, model.sha256)) downloads.push(model.id)
    }
    publish({
      ...EMPTY,
      phase: 'pick',
      ramGb: ramGb > 0 ? ramGb : null,
      choices: setupChoices(catalog, ramGb > 0 ? ramGb : null, downloads),
    })
  }

  async function run(): Promise<void> {
    const gen = ++generation
    const request = pending
    if (!request) {
      await showPick()
      return
    }
    samples = []
    const catalog = host.catalog()
    const embedding = host.embedding()
    const ramGb = host.ramGb()
    const chosen = catalog.find((model) => model.id === request.modelId)
    if (!chosen) {
      await showPick()
      return
    }
    publish({
      ...EMPTY,
      phase: 'checking',
      modelId: chosen.id,
      modelName: chosen.name,
      ramGb: ramGb > 0 ? ramGb : null,
    })
    const chatInstalled = await host.isInstalled(chosen.file, chosen.sizeBytes)
    const embedInstalled = await host.isInstalled(embedding.file, embedding.sizeBytes)
    const chatInDownloads = await host.inDownloads(chosen.file, chosen.sizeBytes, chosen.sha256)
    const embedInDownloads = await host.inDownloads(embedding.file, embedding.sizeBytes, embedding.sha256)
    if (gen !== generation) return
    const probe = host.spec({
      id: chosen.id, role: 'chat', name: chosen.name, file: chosen.file, url: chosen.url, sha256: chosen.sha256, sizeBytes: chosen.sizeBytes, action: 'download',
    })
    mkdirSync(dirname(probe.dest), { recursive: true })
    const free = await host.freeBytes(dirname(probe.dest))
    const plan = planFirstRun({
      chosenId: chosen.id,
      useDownloads: request.useDownloads,
      freeBytes: free,
      chatInstalled,
      embedInstalled,
      chatInDownloads,
      embedInDownloads,
      catalog,
      embedding,
    })
    if (gen !== generation) return
    if (plan.action === 'done') {
      finish(plan.modelId, catalog, ramGb)
      return
    }
    const files = plan.steps.map((step) => fileView(step, step.action === 'ready' ? step.sizeBytes : 0, step.action === 'ready' ? 'done' : 'waiting'))
    if (plan.action === 'disk') {
      publish({
        phase: 'error',
        modelId: chosen.id,
        modelName: chosen.name,
        ramGb: ramGb > 0 ? ramGb : null,
        choices: [],
        files,
        done: 0,
        total: files[0]?.total ?? 0,
        bytesPerSecond: null,
        error: { code: 'disk', requiredBytes: plan.requiredBytes ?? null, freeBytes: plan.freeBytes ?? null },
      })
      return
    }
    if (plan.steps.some((step) => step.action === 'download') && host.offlineOnly()) {
      publish({
        phase: 'error',
        modelId: chosen.id,
        modelName: chosen.name,
        ramGb: ramGb > 0 ? ramGb : null,
        choices: [],
        files,
        done: 0,
        total: files[0]?.total ?? 0,
        bytesPerSecond: null,
        error: { code: 'offline' },
      })
      return
    }
    await transfer(plan, catalog, ramGb, gen, files)
  }

  async function transfer(plan: FirstRunPlan, catalog: readonly SetupModel[], ramGb: number, gen: number, files: SetupFileView[]): Promise<void> {
    const chosen = catalog.find((model) => model.id === plan.modelId)
    if (!chosen) return
    for (const step of plan.steps) {
      if (gen !== generation) return
      if (step.action === 'ready') continue
      const spec = host.spec(step)
      const ac = new AbortController()
      abort = ac
      samples = []
      const phase = 'downloading' as const
      const mark = (done: number, state: SetupFileView['state']) => files.map((file) => file.id === step.id ? { ...file, done, state } : file)
      files = mark(0, 'active')
      publish({
        phase,
        modelId: chosen.id,
        modelName: chosen.name,
        ramGb: ramGb > 0 ? ramGb : null,
        choices: [],
        files,
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
        files = mark(done, 'active')
        publish({
          ...snapshot,
          phase,
          files,
          done,
          total: spec.size,
          bytesPerSecond: byteRate(samples),
          error: null,
        })
      }
      try {
        if (step.action === 'copy') {
          await host.takeDownloads(step.file, step.sizeBytes, step.sha256, spec.dest)
          onProgress(spec.size)
        } else {
          const download = host.download ?? downloadVerified
          await download(spec, onProgress, ac.signal)
        }
        if (gen !== generation) return
        files = mark(spec.size, 'done')
      } catch (error) {
        if (gen !== generation) return
        if (isAbortError(error) || ac.signal.aborted) {
          publish({ ...snapshot, phase: 'paused', files, bytesPerSecond: null })
          return
        }
        publish({ ...snapshot, phase: 'error', files, bytesPerSecond: null, error: errorView(error) })
        return
      } finally {
        if (abort === ac) abort = null
      }
    }
    if (gen !== generation) return
    finish(chosen.id, catalog, ramGb)
  }

  function finish(modelId: string, catalog: readonly SetupModel[], ramGb: number): void {
    const model = catalog.find((item) => item.id === modelId)
    host.saveChoice(modelId)
    pending = null
    publish({
      phase: 'done',
      modelId,
      modelName: model?.name ?? '',
      ramGb: ramGb > 0 ? ramGb : null,
      choices: [],
      files: snapshot.files.map((file) => ({ ...file, done: file.total, state: 'done' })),
      done: model?.sizeBytes ?? snapshot.done,
      total: model?.sizeBytes ?? snapshot.total,
      bytesPerSecond: null,
      error: null,
    })
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

  async function begin(modelId: string, useDownloads: boolean): Promise<void> {
    if (snapshot.phase === 'downloading' || snapshot.phase === 'checking') return
    if (running) return
    pending = { modelId, useDownloads }
    const job = run()
    running = job
    try { await job } finally { if (running === job) running = null }
  }

  return {
    state: async () => snapshot.choices.length || snapshot.phase !== 'pick' ? snapshot : showPick().then(() => snapshot),
    start: () => showPick(),
    choose: (modelId: string) => begin(modelId, false),
    useFile: (modelId: string) => begin(modelId, true),
    pause() {
      abort?.abort()
    },
    resume: () => {
      if (!pending) return showPick()
      return begin(pending.modelId, pending.useDownloads)
    },
    retry: () => {
      if (!pending) return showPick()
      return begin(pending.modelId, pending.useDownloads)
    },
  }
}

function fileView(step: SetupStep, done: number, state: SetupFileView['state']): SetupFileView {
  return { id: step.id, name: step.name, role: step.role, done, total: step.sizeBytes, state }
}
