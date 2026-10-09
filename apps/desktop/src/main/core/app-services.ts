/**
 * Day 1 app services: hardware, model registry, resumable downloads, and the chat orchestrator.
 * One llama-server at a time (chat or embeddings). Retrieval runs when a verified pack is open.
 * TODO(Day 3): attachments into user.db. TODO(Day 4): web search via services/api.
 * TODO(Day 5): signed pack import. TODO(Day 6): niche agents.
 */
import { app, BrowserWindow, net, dialog } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Services } from './main-window.js'
import { IPC, type ChatEvent, type GateName, type ModelStatus, type SettingsPatch, type StoredMessage } from './ipc-contract.js'
import { detectHardware, chatThreads } from './hardware.js'
import { parseRegistry, pick, type ModelEntry, type ModelRegistry } from './model-registry.js'
import { downloadVerified } from './model-download.js'
import { LlamaServer, resolveSidecar, type SidecarState } from './sidecar-manager.js'
import { LlamaClient } from './llama-client.js'
import { Embedder } from './embedding.js'
import { Calculator, calculatorTools } from './calculator.js'
import calcWorker from './calculator.worker?modulePath'
import { hybridSearch, borderlinePrompt, type Hit, type GateDecision } from './retrieval.js'
import { allocate, BUDGETS, LlamaServerTokenizer, type Turn } from './token-budget.js'
import { openUserDb } from './db.js'
import { getOrCreateDbKey } from './key-store.js'
import { SESSION_MIGRATION, SessionStore } from './session-store.js'
import { assertNetworkAllowed } from './offline-guard.js'
import { surfEnv } from './surf-env.js'
import { initAutoUpdate, installOfflineUpdate } from './updater.js'
import type { ParsedChat } from './ipc-schemas.js'

type ChatReq = ParsedChat
type Settings = Required<SettingsPatch>

const SYSTEM =
  'You are Surf AI, a calm assistant that runs entirely on this computer. ' +
  'Answer in plain language. When SOURCES are provided, use only those sources and cite them as [S1], [S2]. ' +
  'When a calculator result is provided, use that result exactly. Do not invent numbers, citations, or sources.'

const INSUFFICIENT = "I don't have enough information to answer that from the sources on this computer."

const DEFAULT_SETTINGS: Settings = {
  offlineOnly: false,
  webSearchAllowed: false,
  telemetryOptIn: false,
  chatModelId: '',
  onboardingComplete: false,
  theme: 'system',
}

export async function createServices(): Promise<Services> {
  const hw = await detectHardware()
  let offlineOnly = false
  const store = await openStore()
  const calc = new Calculator(calcWorker)
  const inflight = new Map<string, AbortController>()
  let downloading: { id: string; done: number; total: number } | null = null
  let active: { role: 'chat' | 'embed'; modelId: string; server: LlamaServer } | null = null
  const sidecars: ModelStatus['sidecars'] = { chat: 'stopped', embed: 'stopped', whisper: 'stopped' }

  const settingsPath = () => join(app.getPath('userData'), 'settings.json')
  const modelsDir = () => surfEnv('MODELS_DIR') ?? join(app.getPath('userData'), 'models')

  function readSettings(): Settings {
    try {
      const raw = JSON.parse(readFileSync(settingsPath(), 'utf8')) as SettingsPatch
      const merged = { ...DEFAULT_SETTINGS, ...raw }
      offlineOnly = merged.offlineOnly
      return merged
    } catch {
      offlineOnly = DEFAULT_SETTINGS.offlineOnly
      return { ...DEFAULT_SETTINGS }
    }
  }

  function writeSettings(next: Settings): void {
    mkdirSync(app.getPath('userData'), { recursive: true })
    writeFileSync(settingsPath(), JSON.stringify(next, null, 2))
    offlineOnly = next.offlineOnly
  }

  function registryPath(): string {
    const packaged = join(process.resourcesPath, 'models.registry.json')
    if (app.isPackaged && existsSync(packaged)) return packaged
    return join(app.getAppPath(), 'resources', 'models.registry.json')
  }

  function registry(): ModelRegistry {
    return parseRegistry(JSON.parse(readFileSync(registryPath(), 'utf8')))
  }

  async function installed(file: string, size: number): Promise<boolean> {
    const p = join(modelsDir(), file)
    if (!existsSync(p)) return false
    return (await stat(p)).size === size
  }

  function fits(m: ModelEntry): boolean {
    return m.tiers.includes(hw.tier) || m.min_ram_gb <= hw.totalRamGb + 0.8
  }

  async function status(): Promise<ModelStatus> {
    const reg = registry()
    const settings = readSettings()
    const recommended = pick(reg, 'chat', hw.tier)
    const models = await Promise.all(reg.models.map(async (m) => ({
      id: m.id,
      role: m.role,
      label: labelFor(m),
      paramsB: m.params_b ?? null,
      sizeBytes: m.size_bytes,
      minRamGb: m.min_ram_gb,
      tiers: m.tiers,
      installed: await installed(m.file, m.size_bytes),
      recommended: m.id === recommended.id,
      fitsRam: m.role === 'embedding' || m.role === 'vad' || fits(m),
    })))
    const chosen = await chooseChat(reg, settings.chatModelId)
    return {
      tier: hw.tier,
      ramGb: hw.totalRamGb,
      cpuModel: hw.cpuModel,
      cores: hw.physicalCores,
      chatModelId: chosen?.id ?? recommended.id,
      installed: models.filter((m) => m.installed).map((m) => m.id),
      downloading,
      sidecars: { ...sidecars },
      models,
      online: isOnline() && !settings.offlineOnly,
      offlineOnly: settings.offlineOnly,
      onboardingComplete: settings.onboardingComplete,
      chatPersistence: store.mode,
    }
  }

  async function chooseChat(reg: ModelRegistry, preferredId: string): Promise<ModelEntry | null> {
    const chats = reg.models.filter((m) => m.role === 'chat')
    const ready = async (m: ModelEntry) => installed(m.file, m.size_bytes)
    if (preferredId) {
      const pref = chats.find((m) => m.id === preferredId)
      if (pref && await ready(pref)) return pref
    }
    const recommended = pick(reg, 'chat', hw.tier)
    if (await ready(recommended)) return recommended
    const have: ModelEntry[] = []
    for (const m of chats) if (await ready(m) && fits(m)) have.push(m)
    have.sort((a, b) => (b.params_b ?? 0) - (a.params_b ?? 0))
    return have[0] ?? null
  }

  async function stopActive(): Promise<void> {
    const current = active
    active = null
    if (!current) return
    sidecars[current.role] = 'stopped'
    await current.server.stop()
  }

  async function ensure(role: 'chat' | 'embed', model: ModelEntry, ctx: number): Promise<LlamaServer> {
    if (active && active.role === role && active.modelId === model.id && active.server.state === 'ready') return active.server
    await stopActive()
    const bin = resolveSidecar('llama-server', app.isPackaged, process.resourcesPath, app.getAppPath())
    const server = new LlamaServer({
      binPath: bin,
      modelPath: join(modelsDir(), model.file),
      embeddings: role === 'embed',
      pooling: 'mean',
      ctx,
      threads: chatThreads(hw),
      startupTimeoutMs: 180_000,
    })
    sidecars[role] = 'starting'
    server.on('state', (st: SidecarState) => { sidecars[role] = st === 'starting' || st === 'ready' || st === 'crashed' || st === 'stopped' ? st : 'stopped' })
    await server.start()
    active = { role, modelId: model.id, server }
    sidecars[role] = 'ready'
    return server
  }

  async function download(modelId: string, win: BrowserWindow): Promise<void> {
    const settings = readSettings()
    assertNetworkAllowed(settings.offlineOnly)
    if (downloading) throw new Error('A download is already running.')
    const model = registry().models.find((m) => m.id === modelId)
    if (!model) throw new Error('Unknown model.')
    if (model.role === 'asr') throw new Error('Speech models land in week 2.')
    mkdirSync(modelsDir(), { recursive: true })
    const dest = join(modelsDir(), model.file)
    downloading = { id: model.id, done: 0, total: model.size_bytes }
    const send = (state: string, done: number, error?: string) => {
      if (!win.isDestroyed()) win.webContents.send(IPC.modelsEvent, { id: model.id, done, total: model.size_bytes, state, error })
    }
    try {
      await downloadVerified({ url: model.url, dest, size: model.size_bytes, sha256: model.sha256 }, (done) => {
        downloading = { id: model.id, done, total: model.size_bytes }
        send('progress', done)
      })
      send('done', model.size_bytes)
    } catch (e) {
      const message = (e as Error).message
      send('error', downloading?.done ?? 0, message)
      throw e
    } finally {
      downloading = null
    }
  }

  function sendEvent(win: BrowserWindow, event: ChatEvent): void {
    if (!win.isDestroyed()) win.webContents.send(IPC.chatEvent, event)
  }

  async function emitText(win: BrowserWindow, messageId: string, text: string): Promise<void> {
    const size = 32
    for (let i = 0; i < text.length; i += size) {
      sendEvent(win, { type: 'token', messageId, text: text.slice(i, i + size) })
      await new Promise((r) => setTimeout(r, 16))
    }
  }

  async function reply(req: ChatReq, conversationId: string, messageId: string, userMessageId: string, win: BrowserWindow, signal: AbortSignal): Promise<void> {
    const settings = readSettings()
    const reg = registry()
    const text = req.text
    const direct = await tryDirectTool(calc, text)
    if (direct) {
      sendEvent(win, { type: 'tool', messageId, name: direct.name, input: direct.input, output: direct.output })
      await emitText(win, messageId, direct.answer)
      finish(conversationId, messageId, userMessageId, win, direct.answer, [], 'answer')
      return
    }

    // TODO(Day 5): open packs only after pack-verify.ts. An empty library is not a failed gate.
    const packs: Record<string, import('./db.js').DB> = {}
    let hits: Hit[] = []
    let decision: GateDecision | 'skip' = 'skip'
    if (Object.keys(packs).length > 0) {
      const emb = reg.models.find((m) => m.role === 'embedding')
      if (!emb || !(await installed(emb.file, emb.size_bytes))) {
        throw new Error('Download EmbeddingGemma 2 before searching packs.')
      }
      const embedServer = await ensure('embed', emb, 2048)
      const embedder = new Embedder(new LlamaClient({ baseUrl: embedServer.baseUrl, apiKey: embedServer.apiKey }))
      const [qvec] = await embedder.embedQueries([text])
      const found = hybridSearch(packs, text, qvec)
      hits = found.top
      decision = found.decision
      await stopActive()
      if (decision === 'insufficient') {
        const allowWeb = !settings.offlineOnly && settings.webSearchAllowed && req.allowWeb !== false && isOnline()
        // TODO(Day 4): call services/api POST /v1/search, then fetch and clean pages on device.
        const message = allowWeb
          ? `${INSUFFICIENT} Web search is not connected yet.`
          : INSUFFICIENT
        await emitText(win, messageId, message)
        finish(conversationId, messageId, userMessageId, win, message, [], allowWeb ? 'web' : 'insufficient')
        return
      }
    }

    const chatModel = await chooseChat(reg, settings.chatModelId)
    if (!chatModel) {
      const suggested = pick(reg, 'chat', hw.tier)
      throw new Error(`Download ${labelFor(suggested)} in Models before chatting.`)
    }
    const profile = hw.tier >= 2 ? BUDGETS.tier2 : hw.tier === 1 ? BUDGETS.tier1 : BUDGETS.tier0
    const server = await ensure('chat', chatModel, profile.serverCtx)
    const client = new LlamaClient({
      baseUrl: server.baseUrl,
      apiKey: server.apiKey,
      sampling: chatModel.sampling,
      chatTemplateKwargs: chatModel.chat_template_kwargs,
    })

    if (decision === 'borderline') {
      const check = await client.chat([{ role: 'user', content: borderlinePrompt(text, hits) }], undefined, signal, 8)
      const yn = String(check.choices[0]?.message?.content ?? '').trim().toUpperCase()
      if (yn.startsWith('NO')) {
        await emitText(win, messageId, INSUFFICIENT)
        finish(conversationId, messageId, userMessageId, win, INSUFFICIENT, [], 'insufficient')
        return
      }
      decision = 'answer'
    }

    const prior = store.open(conversationId).messages.filter((m) => m.id !== userMessageId)
    const history: Turn[] = []
    for (let i = 0; i < prior.length; i++) {
      const next = prior[i + 1]
      if (prior[i].role === 'user' && next?.role === 'assistant') {
        history.push({ user: prior[i].text, assistant: next.text })
        i++
      }
    }
    const useTools = needsCalculator(text)
    const sources = hits.map((h) => ({ title: h.title || h.pack, url: h.url || '', pack: h.pack }))
    if (sources.length) sendEvent(win, { type: 'sources', messageId, sources })
    const budget = await allocate(new LlamaServerTokenizer(server.baseUrl, server.apiKey), profile, {
      system: SYSTEM,
      tools: useTools ? calculatorTools : undefined,
      chunks: hits.map((h) => ({ id: String(h.chunkId), text: h.text, title: h.title || h.pack, score: h.cosine })),
      history,
      question: text,
    })

    let answer = ''
    if (useTools) {
      const ran = await client.runWithTools(budget.messages, calculatorTools, toolHandlers(calc), 4, signal)
      for (const call of ran.toolCalls) {
        const out = ran.messages.find((m) => m.role === 'tool' && m.tool_call_id === call.id)
        sendEvent(win, { type: 'tool', messageId, name: call.function.name, input: call.function.arguments, output: String(out?.content ?? '') })
      }
      answer = ran.answer
      await emitText(win, messageId, answer)
    } else {
      for await (const piece of client.chatStream(budget.messages, undefined, signal, budget.maxTokens)) {
        if (signal.aborted) return
        answer += piece
        sendEvent(win, { type: 'token', messageId, text: piece })
      }
    }
    const gate: GateName = decision === 'skip' ? 'answer' : decision
    finish(conversationId, messageId, userMessageId, win, answer, sources, gate)
  }

  function finish(conversationId: string, messageId: string, _userMessageId: string, win: BrowserWindow, text: string, sources: StoredMessage['sources'], gate: GateName): void {
    store.append(conversationId, { id: randomUUID(), role: 'assistant', text, sources, gate })
    sendEvent(win, { type: 'done', messageId, gate })
  }

  readSettings()

  const services: Services = {
    chat: {
      async send(req, win) {
        const messageId = randomUUID()
        const userMessageId = randomUUID()
        const conversationId = store.ensure(req.conversationId, req.text, req.agentId)
        store.append(conversationId, { id: userMessageId, role: 'user', text: req.text, sources: [] })
        const ac = new AbortController()
        inflight.set(messageId, ac)
        void reply(req, conversationId, messageId, userMessageId, win, ac.signal)
          .catch((e: unknown) => {
            if (ac.signal.aborted) return
            sendEvent(win, { type: 'error', messageId, message: (e as Error).message })
          })
          .finally(() => inflight.delete(messageId))
        return { conversationId, messageId }
      },
      cancel(id) { inflight.get(id)?.abort() },
    },
    models: { status, download },
    conversations: {
      list: async () => store.list(),
      open: async (id) => store.open(id),
    },
    packs: {
      list: async () => [],
      importFromFile: async () => {
        await dialog.showMessageBox({
          type: 'info',
          message: 'Pack import lands on Day 5.',
          detail: 'Signed knowledge packs (marine, construction, aviation) are not in this build yet.',
        })
        return null
      },
    },
    settings: {
      get: async () => readSettings(),
      set: async (p) => { writeSettings({ ...readSettings(), ...p }) },
      isOfflineOnly: () => offlineOnly,
    },
    updates: {
      check: async () => null,
      installOffline: async (win) => {
        const key = surfEnv('RELEASE_PUBKEY_HEX')
        if (!key) throw new Error('Offline installer checks land on Day 7, when the release signing key is added.')
        return installOfflineUpdate(win, key)
      },
    },
  }
  return services
}

export function startUpdater(win: BrowserWindow, services: Services): void {
  initAutoUpdate(win, () => services.settings.isOfflineOnly())
}

async function openStore(): Promise<SessionStore> {
  try {
    const key = await getOrCreateDbKey()
    const db = openUserDb(join(app.getPath('userData'), 'chat.db'), key, [SESSION_MIGRATION])
    return new SessionStore(db)
  } catch (e) {
    console.warn('[surf] encrypted chat store unavailable:', (e as Error).message)
    return new SessionStore(null)
  }
}

function labelFor(m: ModelEntry): string {
  if (m.role === 'embedding') return 'EmbeddingGemma 2'
  if (m.role === 'chat') return `Qwen3.5 ${m.params_b ?? ''}B`.replace(' B', 'B')
  if (m.role === 'asr') return m.id
  return m.id
}

function isOnline(): boolean {
  const probe = net as { isOnline?: () => boolean; online?: boolean }
  if (typeof probe.isOnline === 'function') return probe.isOnline()
  if (typeof probe.online === 'boolean') return probe.online
  return true
}

function toolHandlers(calc: Calculator) {
  return {
    calculator: async (args: Record<string, unknown>) => {
      const r = await calc.calc(String(args.expression ?? ''))
      if (!r.ok) return `error: ${r.error}`
      return r.result
    },
    unit_convert: async (args: Record<string, unknown>) => {
      const r = await calc.convert(Number(args.value), String(args.from ?? ''), String(args.to ?? ''))
      if (!r.ok) return `error: ${r.error}`
      return r.result
    },
  }
}

async function tryDirectTool(calc: Calculator, text: string): Promise<{ name: string; input: string; output: string; answer: string } | null> {
  const expr = pureExpression(text)
  if (expr) {
    const r = await calc.calc(expr)
    if (!r.ok) return null
    return { name: 'calculator', input: expr, output: r.result, answer: r.result }
  }
  const unit = text.match(/(-?\d+(?:\.\d+)?)\s*([a-zA-Z°/%]+)\s+(?:to|in|into)\s+([a-zA-Z°/%]+)/i)
  if (!unit) return null
  const r = await calc.convert(Number(unit[1]), unit[2], unit[3])
  if (!r.ok) return null
  return { name: 'unit_convert', input: `${unit[1]} ${unit[2]} -> ${unit[3]}`, output: r.result, answer: `${unit[1]} ${unit[2]} = ${r.result}` }
}

function pureExpression(text: string): string | null {
  const t = text.trim().replace(/^(what is|calculate|compute)\s+/i, '').replace(/\?$/, '').trim()
  if (!t || t.length > 180) return null
  if (!/^[\d\s.+\-*/%^()]+$/.test(t)) return null
  if (!/\d/.test(t) || !/[+\-*/%^]/.test(t)) return null
  return t
}

export function needsCalculator(text: string): boolean {
  return /\d/.test(text) && /[+\-*/%=]|percent|calculate|convert|how many|times|divided|multipl|knot|km\/h|\bkg\b|\blb\b|feet|metre|meter|celsius|fahrenheit/i.test(text)
}
