/**
 * First open shows Qwen 2B, 4B, and 9B. Download fetches that file and
 * EmbeddingGemma. Pause keeps the .part file. A Downloads copy is used only
 * when the person asks.
 */
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { acceptBundledManifest, type BundledManifest } from '../../shared/offline-pack.js'
import {
  byteRate,
  planEmbeddingRepair,
  planFirstRun,
  requiredFreeBytes,
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
  /** Pass sha256 to require a checksum. Size alone treats a same-size corrupt file as installed. */
  isInstalled: (file: string, size: number, sha256?: string) => Promise<boolean>
  inDownloads: (file: string, size: number, sha256: string) => Promise<boolean>
  takeDownloads: (file: string, size: number, sha256: string, dest: string) => Promise<void>
  spec: (step: SetupStep) => DownloadSpec
  saveChoice: (modelId: string) => void
  embeddingReady: () => void
  installedSetupId: () => Promise<string | null>
  anyChatInstalled: () => Promise<boolean>
  offlineOnly: () => boolean
  freeBytes: (dir: string) => Promise<number | null>
  emit: (snapshot: SetupSnapshot) => void
  /** Manifest shipped in resources/setup-models, or null when this app has none. */
  bundled: () => Promise<BundledManifest | null>
  copyBundled: (file: string, size: number, sha256: string, onProgress: (done: number, total: number) => void) => Promise<void>
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
  let opening = false
  let openGate: Promise<void> = Promise.resolve()
  let releaseOpen: () => void = () => undefined
  let generation = 0
  let samples: { at: number; bytes: number }[] = []
  let pending: { modelId: string; useDownloads: boolean; keepChoice: boolean; embeddingOnly: boolean } | null = null

  function publish(next: SetupSnapshot): void {
    const done = next.files.reduce((sum, file) => sum + file.done, 0)
    const total = next.files.reduce((sum, file) => sum + file.total, 0)
    snapshot = next.files.length ? { ...next, done, total } : next
    host.emit(snapshot)
  }

  async function showPick(): Promise<void> {
    if (opening || snapshot.phase !== 'pick') return
    const catalog = host.catalog()
    const ramGb = host.ramGb()
    const downloads: string[] = []
    for (const model of catalog) {
      if (await host.inDownloads(model.file, model.sizeBytes, model.sha256)) downloads.push(model.id)
    }
    if (opening || snapshot.phase !== 'pick') return
    const embedBytes = host.embedding().sizeBytes
    publish({
      ...EMPTY,
      phase: 'pick',
      ramGb: ramGb > 0 ? ramGb : null,
      choices: setupChoices(catalog, ramGb > 0 ? ramGb : null, downloads, embedBytes),
    })
  }

  async function run(): Promise<void> {
    const gen = ++generation
    const request = pending
    if (!request) {
      await showPick()
      return
    }
    if (request.embeddingOnly) {
      await runEmbedding(gen)
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
    const embedInstalled = await host.isInstalled(embedding.file, embedding.sizeBytes, embedding.sha256)
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
      finish(plan.modelId, catalog, ramGb, request.keepChoice)
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
    const modelId = chosen?.id ?? plan.modelId
    const modelName = chosen?.name ?? 'Search model'
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
        modelId,
        modelName,
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
    finish(modelId, catalog, ramGb, pending?.keepChoice ?? !chosen)
  }

  async function runEmbedding(gen: number): Promise<void> {
    const embedding = host.embedding()
    const ramGb = host.ramGb()
    publish({
      ...EMPTY,
      phase: 'checking',
      modelId: embedding.id,
      modelName: embedding.name,
      ramGb: ramGb > 0 ? ramGb : null,
    })
    const embedInstalled = await host.isInstalled(embedding.file, embedding.sizeBytes, embedding.sha256)
    const embedInDownloads = await host.inDownloads(embedding.file, embedding.sizeBytes, embedding.sha256)
    const probe = host.spec({
      id: embedding.id, role: 'embedding', name: embedding.name, file: embedding.file, url: embedding.url, sha256: embedding.sha256, sizeBytes: embedding.sizeBytes, action: 'download',
    })
    mkdirSync(dirname(probe.dest), { recursive: true })
    const free = await host.freeBytes(dirname(probe.dest))
    const plan = planEmbeddingRepair({ embedding, embedInstalled, embedInDownloads, freeBytes: free })
    if (gen !== generation) return
    if (plan.action === 'done') {
      finish(plan.modelId, host.catalog(), ramGb, true)
      return
    }
    const files = plan.steps.map((step) => fileView(step, 0, 'waiting'))
    if (plan.action === 'disk') {
      publish({
        phase: 'error', modelId: embedding.id, modelName: embedding.name, ramGb: ramGb > 0 ? ramGb : null, choices: [], files,
        done: 0, total: files[0]?.total ?? 0, bytesPerSecond: null,
        error: { code: 'disk', requiredBytes: plan.requiredBytes ?? null, freeBytes: plan.freeBytes ?? null },
      })
      return
    }
    if (plan.steps.some((step) => step.action === 'download') && host.offlineOnly()) {
      publish({
        phase: 'error', modelId: embedding.id, modelName: embedding.name, ramGb: ramGb > 0 ? ramGb : null, choices: [], files,
        done: 0, total: files[0]?.total ?? 0, bytesPerSecond: null, error: { code: 'offline' },
      })
      return
    }
    await transfer(plan, host.catalog(), ramGb, gen, files)
  }

  async function runBundled(manifest: BundledManifest, keepChoice: boolean): Promise<'done' | 'error' | 'invalid'> {
    const gen = ++generation
    const catalog = host.catalog()
    const embedding = host.embedding()
    const accepted = acceptBundledManifest(manifest, catalog, embedding)
    if (!accepted) return 'invalid'
    const chosen = catalog.find((model) => model.id === accepted.modelId)
    if (!chosen) return 'invalid'
    const ramGb = host.ramGb()
    const steps: SetupStep[] = accepted.files.map((file) => ({
      id: file.role === 'chat' ? chosen.id : embedding.id,
      role: file.role,
      name: file.role === 'chat' ? chosen.name : embedding.name,
      file: file.file,
      url: file.role === 'chat' ? chosen.url : embedding.url,
      sha256: file.sha256,
      sizeBytes: file.sizeBytes,
      action: 'copy',
    }))
    publish({
      ...EMPTY,
      phase: 'checking',
      modelId: chosen.id,
      modelName: chosen.name,
      ramGb: ramGb > 0 ? ramGb : null,
      localCopy: true,
    })
    const present: boolean[] = []
    for (const step of steps) present.push(await host.isInstalled(step.file, step.sizeBytes, step.sha256))
    if (gen !== generation) return 'error'
    const pendingBytes = steps.filter((_, index) => !present[index]).reduce((sum, step) => sum + step.sizeBytes, 0)
    const first = steps[0]
    if (!first) return 'invalid'
    const probe = host.spec(first)
    mkdirSync(dirname(probe.dest), { recursive: true })
    const free = pendingBytes > 0 ? await host.freeBytes(dirname(probe.dest)) : null
    let files = steps.map((step, index) => fileView(step, present[index] ? step.sizeBytes : 0, present[index] ? 'done' : 'waiting'))
    const view = (phase: SetupSnapshot['phase'], error: SetupSnapshot['error']) => ({
      phase,
      modelId: chosen.id,
      modelName: chosen.name,
      ramGb: ramGb > 0 ? ramGb : null,
      choices: [],
      files,
      done: 0,
      total: 0,
      bytesPerSecond: null as number | null,
      error,
      localCopy: true,
    })
    if (pendingBytes > 0 && free != null && Number.isFinite(free) && free < requiredFreeBytes(pendingBytes)) {
      publish(view('error', { code: 'disk', requiredBytes: requiredFreeBytes(pendingBytes), freeBytes: free }))
      return 'error'
    }
    if (pendingBytes === 0) {
      publish(view('checking', null))
      finish(chosen.id, catalog, ramGb, keepChoice)
      return 'done'
    }
    for (let index = 0; index < steps.length; index++) {
      if (gen !== generation) return 'error'
      if (present[index]) continue
      const step = steps[index]
      samples = []
      const mark = (done: number, state: SetupFileView['state']) => files.map((file) => file.id === step.id ? { ...file, done, state } : file)
      files = mark(0, 'active')
      publish(view('downloading', null))
      try {
        await host.copyBundled(step.file, step.sizeBytes, step.sha256, (done) => {
          if (gen !== generation) return
          const at = Date.now()
          samples.push({ at, bytes: done })
          if (samples.length > 6) samples.shift()
          files = mark(done, 'active')
          publish({ ...snapshot, phase: 'downloading', files, localCopy: true, bytesPerSecond: byteRate(samples), error: null })
        })
        if (gen !== generation) return 'error'
        files = mark(step.sizeBytes, 'done')
      } catch (error) {
        if (gen !== generation) return 'error'
        publish({ ...snapshot, phase: 'error', files, bytesPerSecond: null, error: errorView(error), localCopy: true })
        return 'error'
      }
    }
    if (gen !== generation) return 'error'
    publish(view('downloading', null))
    finish(chosen.id, catalog, ramGb, keepChoice)
    return 'done'
  }

  function finish(modelId: string, catalog: readonly SetupModel[], ramGb: number, keepChoice: boolean): void {
    const model = catalog.find((item) => item.id === modelId)
    if (!keepChoice) host.saveChoice(modelId)
    host.embeddingReady()
    pending = null
    publish({
      phase: 'done',
      modelId,
      modelName: model?.name || snapshot.modelName || 'Search model',
      ramGb: ramGb > 0 ? ramGb : null,
      choices: [],
      files: snapshot.files.map((file) => ({ ...file, done: file.total, state: 'done' })),
      done: snapshot.done,
      total: snapshot.total,
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

  async function begin(modelId: string, useDownloads: boolean, keepChoice = false, embeddingOnly = false): Promise<void> {
    if (snapshot.phase === 'downloading' || snapshot.phase === 'checking') return
    if (running) return
    pending = { modelId, useDownloads, keepChoice, embeddingOnly }
    const job = run()
    running = job
    try { await job } finally { if (running === job) running = null }
  }

  function launch(body: () => Promise<void>): Promise<void> {
    if (running) return running
    let job: Promise<void>
    job = body().finally(() => { if (running === job) running = null })
    running = job
    return job
  }

  async function repair(): Promise<void> {
    if (snapshot.phase === 'downloading' || snapshot.phase === 'checking') return
    return launch(async () => {
      const manifest = await host.bundled().catch(() => null)
      if (manifest) {
        const outcome = await runBundled(manifest, true)
        if (outcome !== 'invalid') return
      }
      const id = await host.installedSetupId()
      if (id) {
        pending = { modelId: id, useDownloads: false, keepChoice: true, embeddingOnly: false }
        await run()
        return
      }
      if (await host.anyChatInstalled()) {
        pending = { modelId: '', useDownloads: false, keepChoice: true, embeddingOnly: true }
        await run()
        return
      }
      await showPick()
    })
  }

  return {
    state: async () => {
      await Promise.resolve()
      if (opening) await openGate
      if (!opening && snapshot.phase === 'pick' && snapshot.choices.length === 0) await showPick()
      if (opening) await openGate
      return snapshot
    },
    start() {
      if (!opening) {
        opening = true
        openGate = new Promise((resolve) => { releaseOpen = resolve })
      }
      return launch(async () => {
        let stay = false
        try {
          const manifest = await host.bundled()
          if (manifest && !(await host.anyChatInstalled())) {
            const outcome = await runBundled(manifest, false)
            stay = outcome !== 'invalid'
          }
        } catch {
          stay = false
        } finally {
          opening = false
          releaseOpen()
        }
        if (!stay) await showPick()
      })
    },
    choose: (modelId: string) => begin(modelId, false),
    useFile: (modelId: string) => begin(modelId, true),
    repair: () => repair(),
    pause() {
      abort?.abort()
    },
    resume: () => {
      if (!pending) return showPick()
      return begin(pending.modelId, pending.useDownloads, pending.keepChoice, pending.embeddingOnly)
    },
    retry: () => {
      if (!pending) return showPick()
      return begin(pending.modelId, pending.useDownloads, pending.keepChoice, pending.embeddingOnly)
    },
  }
}

function fileView(step: SetupStep, done: number, state: SetupFileView['state']): SetupFileView {
  return { id: step.id, name: step.name, role: step.role, done, total: step.sizeBytes, state }
}
