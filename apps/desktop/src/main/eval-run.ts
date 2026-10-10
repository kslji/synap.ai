/**
 * Headless driver for the shared eval.
 * Cases go through createServices().chat.send, the same reply path as the app:
 * retrieval, the gate, prompt wrapping, tools, and the token budgeter.
 */
import { app, BrowserWindow } from 'electron'
import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { cp, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { EMBEDDINGGEMMA2_256 } from './core/embedding.js'
import { IPC, type ChatEvent, type Citation } from './core/ipc-contract.js'
import { commitInstall } from './core/pack-install.js'
import { trustedPackKeys } from './core/pack-keys.js'
import { verifyPack } from './core/pack-verify.js'
import { LlamaClient } from './core/llama-client.js'
import { LlamaServer, resolveSidecar } from './core/sidecar-manager.js'
import { surfEnv } from './core/surf-env.js'
import { repoRoot, startSearchFixture } from './core/web-selftest.js'
import { createServices } from './core/app-services.js'

interface Expect {
  exact?: string
  contains?: string[]
  contains_any?: string[]
  absent?: string[]
  numeric?: number
  tolerance?: number
  citation?: boolean
  source_contains?: string[]
  citation_prefix?: string
  injection?: boolean
  gate?: string
  budget?: boolean
  larger?: string
  truthful?: { correct: string[]; incorrect: string[] }
}

interface Turn {
  question: string
  offlineOnly?: boolean
  allowWeb?: boolean
  documents?: string[]
  expect?: Expect
}

interface PackSpec {
  src: string
  id: string
  title: string
  niche: string
  version: string
}

interface EvalCase {
  id: string
  suite: string
  weight?: number
  phase?: number
  pack?: PackSpec
  turns: Turn[]
}

interface TurnTranscript {
  question: string
  answer: string
  sources: Citation[]
  tools: { name: string; input: string; output: string }[]
  gate?: string
  budget?: Extract<ChatEvent, { type: 'done' }>['budget']
  latencyMs: number
  rssMb: number
  error?: string
}

interface CaseTranscript {
  id: string
  suite: string
  weight: number
  turns: TurnTranscript[]
  error?: string
}

interface ModelMetric {
  id: string
  file: string
  present: boolean
  latencyMs?: number
  rssMb?: number
  note?: string
}

const CHAT_MODELS: { id: string; file: string; required: boolean }[] = [
  { id: 'qwen3.5-2b', file: 'Qwen3.5-2B-Q4_K_M.gguf', required: true },
  { id: 'qwen3.5-4b', file: 'Qwen3.5-4B-Q4_K_M.gguf', required: false },
  { id: 'qwen3.5-9b', file: 'Qwen3.5-9B-Q4_K_M.gguf', required: false },
]

function must(name: string): string {
  const value = surfEnv(name)
  if (!value) throw new Error(`SURF_${name} is required`)
  return value
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function llamaRssMb(): number {
  let max = 0
  let entries: string[] = []
  try { entries = readdirSync('/proc') } catch { return 0 }
  for (const dir of entries) {
    if (!/^\d+$/.test(dir)) continue
    try {
      const comm = readFileSync(`/proc/${dir}/comm`, 'utf8').trim()
      if (comm !== 'llama-server') continue
      const status = readFileSync(`/proc/${dir}/status`, 'utf8')
      const match = status.match(/^VmHWM:\s+(\d+)/m) || status.match(/^VmRSS:\s+(\d+)/m)
      if (match) max = Math.max(max, Number(match[1]) / 1024)
    } catch { /* process exited */ }
  }
  return Math.round(max * 10) / 10
}

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { env, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error(`${cmd} ${args[0]} failed\n${stdout}\n${stderr}`))
      else resolve(String(stdout).trim())
    })
  })
}

async function probeModel(bin: string, modelPath: string, embeddings: boolean, logFile: string): Promise<{ latencyMs: number; rssMb: number }> {
  const server = new LlamaServer({
    binPath: bin,
    modelPath,
    embeddings,
    pooling: embeddings ? 'mean' : undefined,
    ctx: embeddings ? 2048 : 2048,
    logFile,
    startupTimeoutMs: 180_000,
  })
  await server.start()
  const started = Date.now()
  try {
    const client = new LlamaClient({
      baseUrl: server.baseUrl,
      apiKey: server.apiKey,
      sampling: { temperature: 0, top_k: 1 },
      chatTemplateKwargs: { enable_thinking: false },
    })
    if (embeddings) await client.embed(['task: search result | query: harbor ferry'])
    else {
      await client.chat([
        { role: 'user', content: 'Reply with the single word surf.' },
      ], undefined, undefined, 16)
    }
    const rssMb = server.pid ? rssOf(server.pid) : llamaRssMb()
    return { latencyMs: Date.now() - started, rssMb }
  } finally {
    await server.stop()
  }
}

function rssOf(pid: number): number {
  try {
    const status = readFileSync(`/proc/${pid}/status`, 'utf8')
    const match = status.match(/^VmHWM:\s+(\d+)/m) || status.match(/^VmRSS:\s+(\d+)/m)
    if (match) return Math.round(Number(match[1]) / 1024 * 10) / 10
  } catch { /* macOS has no /proc */ }
  return llamaRssMb()
}

async function probeModels(modelsDir: string, bin: string, logDir: string, full: boolean): Promise<ModelMetric[]> {
  const metrics: ModelMetric[] = []
  const chat = full ? CHAT_MODELS : CHAT_MODELS.filter((model) => model.required)
  for (const model of CHAT_MODELS) {
    if (!chat.includes(model) && !full) {
      const path = join(modelsDir, model.file)
      metrics.push({ id: model.id, file: model.file, present: existsSync(path), note: existsSync(path) ? 'installed; quick mode records 2B only' : 'not installed' })
      continue
    }
    const path = join(modelsDir, model.file)
    if (!existsSync(path)) {
      if (model.required) throw new Error(`missing ${path}`)
      metrics.push({ id: model.id, file: model.file, present: false, note: 'not installed' })
      continue
    }
    const sample = await probeModel(bin, path, false, join(logDir, `${model.id}.log`))
    metrics.push({ id: model.id, file: model.file, present: true, ...sample, note: 'short greedy reply, context 2048' })
  }
  const embFile = EMBEDDINGGEMMA2_256.gguf
  const embPath = join(modelsDir, embFile)
  if (!existsSync(embPath)) throw new Error(`missing ${embPath}`)
  const emb = await probeModel(bin, embPath, true, join(logDir, 'embedding.log'))
  metrics.push({ id: 'embeddinggemma-2', file: embFile, present: true, ...emb, note: 'one query embed, context 2048' })
  return metrics
}

async function signPack(spec: PackSpec, bin: string, embPath: string, logDir: string): Promise<string> {
  const root = repoRoot()
  const seed = randomBytes(32).toString('hex')
  const pub = await run('python3', ['-c', 'import os; from nacl.signing import SigningKey; print(SigningKey(bytes.fromhex(os.environ["SEED"])).verify_key.encode().hex())'], { ...process.env, SEED: seed })
  process.env.SURF_PACK_PUBKEY = `k-eval:${pub}`
  const built = join(logDir, 'packs', spec.id, spec.version)
  mkdirSync(built, { recursive: true })
  const server = new LlamaServer({
    binPath: bin,
    modelPath: embPath,
    embeddings: true,
    pooling: 'mean',
    ctx: 2048,
    logFile: join(logDir, 'pack-embed.log'),
    startupTimeoutMs: 180_000,
  })
  await server.start()
  try {
    await run('python3', [
      join(root, 'services', 'packs', 'build_pack.py'),
      '--src', join(root, spec.src),
      '--out', built,
      '--id', spec.id,
      '--title', spec.title,
      '--niche', spec.niche,
      '--version', spec.version,
      '--key-hex', seed,
      '--key-id', 'k-eval',
      '--embed-url', `${server.baseUrl}/v1/embeddings`,
      '--api-key', server.apiKey,
    ], process.env)
  } finally {
    await server.stop()
  }
  return built
}

function watch(win: BrowserWindow): (messageId: string, timeoutMs: number) => Promise<TurnTranscript> {
  const slots = new Map<string, TurnTranscript & { done: boolean; waiters: Array<() => void> }>()
  const ensure = (messageId: string) => {
    let slot = slots.get(messageId)
    if (!slot) {
      slot = { question: '', answer: '', sources: [], tools: [], latencyMs: 0, rssMb: 0, done: false, waiters: [] }
      slots.set(messageId, slot)
    }
    return slot
  }
  const orig = win.webContents.send.bind(win.webContents)
  win.webContents.send = ((channel: string, ...args: unknown[]) => {
    if (channel === IPC.chatEvent) {
      const event = args[0] as ChatEvent
      const slot = ensure(event.messageId)
      if (event.type === 'token') slot.answer += event.text
      if (event.type === 'sources') slot.sources = event.sources
      if (event.type === 'tool') slot.tools.push({ name: event.name, input: event.input, output: event.output })
      if (event.type === 'done') {
        if (event.text) slot.answer = event.text
        slot.gate = event.gate
        slot.budget = event.budget
        slot.done = true
        slot.waiters.splice(0).forEach((wake) => wake())
      }
      if (event.type === 'error') {
        slot.error = event.message
        slot.done = true
        slot.waiters.splice(0).forEach((wake) => wake())
      }
    }
    return orig(channel, ...args)
  }) as typeof win.webContents.send

  return (messageId, timeoutMs) => new Promise((resolve, reject) => {
    const slot = ensure(messageId)
    const timer = setTimeout(() => reject(new Error(`turn timed out after ${timeoutMs}ms`)), timeoutMs)
    const finish = () => {
      clearTimeout(timer)
      resolve(slot)
    }
    if (slot.done) finish()
    else slot.waiters.push(finish)
  })
}

export async function runEval(): Promise<void> {
  const cases = JSON.parse(readFileSync(must('EVAL_CASES'), 'utf8')) as EvalCase[]
  const outPath = must('EVAL_OUT')
  const fixtures = must('EVAL_FIXTURES')
  const modelsDir = surfEnv('MODELS_DIR') ?? join(app.getPath('userData'), 'models')
  const full = surfEnv('EVAL_METRICS') === 'full'
  const bin = resolveSidecar('llama-server', app.isPackaged, process.resourcesPath, app.getAppPath())
  const logDir = app.getPath('userData')
  mkdirSync(logDir, { recursive: true })
  const results: CaseTranscript[] = []
  let models: ModelMetric[] = []
  let fixture: { base: string; stop: () => Promise<void> } | null = null

  const write = (error?: string) => {
    writeFileSync(outPath, JSON.stringify({ ok: !error && results.every((row) => !row.error), error, models, cases: results }, null, 2))
  }

  try {
    if (surfEnv('EVAL_SKIP_METRICS') !== '1') models = await probeModels(modelsDir, bin, logDir, full)
    const needsWeb = cases.some((item) => item.turns.some((turn) => turn.allowWeb))
    const built = new Map<string, string>()
    for (const item of cases) {
      if (!item.pack) continue
      built.set(item.id, await signPack(item.pack, bin, join(modelsDir, EMBEDDINGGEMMA2_256.gguf), logDir))
    }
    if (needsWeb) {
      fixture = await startSearchFixture()
      process.env.SURF_API_BASE = fixture.base
    }
    writeFileSync(join(logDir, 'settings.json'), JSON.stringify({
      offlineOnly: true,
      webSearchAllowed: true,
      telemetryOptIn: false,
      chatModelId: surfEnv('EVAL_CHAT_MODEL') || 'qwen3.5-2b-q4_k_m',
      onboardingComplete: true,
      theme: 'system',
      apiBaseUrl: process.env.SURF_API_BASE || 'http://127.0.0.1:9',
      packSyncHours: 168,
    }, null, 2))

    const services = await createServices()
    const status = await services.models.status()
    if (status.chatPersistence !== 'encrypted') throw new Error('eval database did not open; SURF_EVAL_DB_KEY was not used')
    const win = new BrowserWindow({
      show: false,
      width: 800,
      height: 600,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    })
    await win.loadURL('about:blank')
    const waitTurn = watch(win)

    for (const [id, dir] of built) {
      const spec = cases.find((item) => item.id === id)?.pack
      if (!spec) continue
      const staging = join(logDir, 'staging', spec.id)
      await rm(staging, { recursive: true, force: true })
      await mkdir(staging, { recursive: true })
      await cp(dir, staging, { recursive: true })
      const manifest = await verifyPack(staging, { trustedKeys: trustedPackKeys(), expectedEmbedding: EMBEDDINGGEMMA2_256 })
      await commitInstall(staging, join(app.getPath('userData'), 'packs'), manifest, spec.title)
    }

    if (needsWeb && fixture) {
      await services.settings.set({ offlineOnly: false, webSearchAllowed: true })
      const email = 'eval-harness@example.com'
      const start = await fetch(`${fixture.base}/v1/auth/otp/start`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const started = await start.json() as { dev_code?: string; error?: { message?: string } }
      if (!start.ok || !started.dev_code) throw new Error(started.error?.message || 'dev OTP missing')
      await services.auth.verify(email, started.dev_code)
    }

    for (const item of cases) {
      const transcript: CaseTranscript = { id: item.id, suite: item.suite, weight: item.weight ?? 1, turns: [] }
      results.push(transcript)
      let conversationId: string | null = null
      try {
        for (const turn of item.turns) {
          if (turn.documents?.length) {
            const paths = turn.documents.map((name) => name.startsWith('/') ? name : join(fixtures, name))
            for (const filePath of paths) if (!existsSync(filePath)) throw new Error(`missing fixture ${filePath}`)
            const added = await services.library.add(paths, conversationId, conversationId == null, win)
            conversationId = added.conversationId
            const ids = added.files.map((file) => file.id)
            const deadline = Date.now() + 180_000
            for (;;) {
              const files = await services.library.list()
              const mine = files.filter((file) => ids.includes(file.id))
              const failed = mine.find((file) => file.status === 'failed')
              if (failed) throw new Error(failed.error || `${failed.name} failed to index`)
              if (mine.length === ids.length && mine.every((file) => file.status === 'done')) break
              if (Date.now() > deadline) throw new Error('ingest timed out')
              await sleep(300)
            }
          }
          await services.settings.set({
            offlineOnly: turn.offlineOnly !== false,
            webSearchAllowed: turn.allowWeb === true,
          })
          if (turn.allowWeb) {
            const onlineDeadline = Date.now() + 15_000
            let online = false
            while (Date.now() < onlineDeadline) {
              const now = await services.models.status()
              if (now.online) { online = true; break }
              await sleep(200)
            }
            if (!online) throw new Error(`search service stayed offline: ${(await services.models.status()).onlineReason}`)
          }
          const started = Date.now()
          const sent = await services.chat.send({
            conversationId,
            text: turn.question,
            agentId: 'general',
            images: [],
            allowWeb: turn.allowWeb === true,
            docScope: 'chat',
          }, win)
          conversationId = sent.conversationId
          let recorded: TurnTranscript
          try {
            recorded = await waitTurn(sent.messageId, 240_000)
          } catch (error) {
            services.chat.cancel(sent.messageId)
            throw error
          }
          recorded.question = turn.question
          recorded.latencyMs = Date.now() - started
          recorded.rssMb = llamaRssMb()
          transcript.turns.push(recorded)
          if (recorded.error) throw new Error(recorded.error)
        }
      } catch (error) {
        transcript.error = (error as Error).message
      }
      write()
    }
    write()
  } catch (error) {
    write((error as Error).stack || (error as Error).message)
    throw error
  } finally {
    if (fixture) await fixture.stop().catch(() => undefined)
    killLlama()
  }
}

function killLlama(): void {
  let entries: string[] = []
  try { entries = readdirSync('/proc') } catch { return }
  for (const dir of entries) {
    if (!/^\d+$/.test(dir)) continue
    const pid = Number(dir)
    try {
      const comm = readFileSync(`/proc/${dir}/comm`, 'utf8').trim()
      if (comm !== 'llama-server' || !ancestorIsMe(pid)) continue
      process.kill(pid, 'SIGKILL')
    } catch { /* already gone */ }
  }
}

function ancestorIsMe(pid: number): boolean {
  let current = pid
  for (let i = 0; i < 8; i++) {
    if (current === process.pid) return true
    try {
      const status = readFileSync(`/proc/${current}/status`, 'utf8')
      const match = status.match(/^PPid:\s+(\d+)/m)
      if (!match) return false
      const parent = Number(match[1])
      if (parent <= 1) return false
      current = parent
    } catch { return false }
  }
  return false
}
