/**
 * App services: hardware, model registry, chat, and the document index.
 * One llama-server at a time (chat or embeddings). Indexing never blocks the chat IPC.
 * TODO(Day 5): signed pack import. TODO(Day 6): niche agents.
 * TODO: download Qwen3.5 mmproj and expose "Describe image" (vision.ts). OCR is the image path for now.
 */
import { app, BrowserWindow, net, dialog, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { copyFile, mkdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Services } from './main-window.js'
import { IPC, type AuthStatus, type ChatEvent, type Citation, type GateName, type LibraryFile, type ModelStatus, type PackRow, type SettingsPatch, type StoredMessage } from './ipc-contract.js'
import { detectHardware, chatThreads } from './hardware.js'
import { parseRegistry, pick, type ModelEntry, type ModelRegistry } from './model-registry.js'
import { downloadVerified } from './model-download.js'
import { LlamaServer, resolveSidecar, type SidecarState } from './sidecar-manager.js'
import { LlamaClient } from './llama-client.js'
import { Embedder, EMBEDDINGGEMMA2_256 } from './embedding.js'
import { Calculator, calculatorTools } from './calculator.js'
import calcWorker from './calculator.worker?modulePath'
import { hybridSearch, borderlinePrompt, mergeLocal, type Hit, type GateDecision } from './retrieval.js'
import { allocate, BUDGETS, LlamaServerTokenizer, type Turn } from './token-budget.js'
import { openPackDb, openUserDb, type DB } from './db.js'
import { getOrCreateDbKey } from './key-store.js'
import { SESSION_MIGRATION, SessionStore } from './session-store.js'
import { LIBRARY_MIGRATION } from './library-schema.js'
import { assertNetworkAllowed, OfflineOnlyError } from './offline-guard.js'
import { surfEnv } from './surf-env.js'
import { initAutoUpdate, installOfflineUpdate } from './updater.js'
import type { ParsedChat } from './ipc-schemas.js'
import { AttachmentQueue } from './attachment-queue.js'
import type { IngestDeps } from './ingest.js'
import { mimeForName, readAttachment } from './convert.js'
import { addBytes, countsFor, deleteAttachment, listFiles, markCancelled, previewAttachment, previewChunk, retryJob } from './library-store.js'
import { searchUser, type UserHit } from './user-search.js'
import { captionImage, mmprojReady } from './vision.js'
import { chunkBlocks } from './chunker.js'
import { describeReach } from './reach.js'
import { fetchPages, probeHealth, searchWeb } from './web-client.js'
import { commitInstall, readInstalled, removePack } from './pack-install.js'
import { downloadFile, fetchCatalog, shouldSync, type RemotePack } from './pack-sync.js'
import { verifyPack } from './pack-verify.js'
import { trustedPackKeys } from './pack-keys.js'
import {
  fetchDevices,
  freshAccess,
  loadSession,
  logoutSession,
  revokeDeviceRemote,
  startOtp,
  verifyOtp,
} from './auth-session.js'
import {
  HINT_FAILED,
  HINT_OFFLINE,
  decideWeb,
  domainOf,
  formatWebCitation,
  parseSearchQueries,
  prettyDate,
  rankPassages,
  refusalMessage,
  rewritePrompt,
  wantsFresh,
} from './web-decision.js'

type ChatReq = ParsedChat
type Settings = Required<SettingsPatch>

interface WebPiece {
  text: string
  title: string
  url: string
  published: string | null
  cosine: number
}

const WEB_FLOOR = 0.42

const SYSTEM =
  'You are Surf AI, a calm assistant that runs entirely on this computer. ' +
  'Answer in plain language. When SOURCES are provided, use only those sources and cite them as [S1], [S2]. ' +
  'When a calculator result is provided, use that result exactly. Do not invent numbers, citations, or sources.'

const INSUFFICIENT = "I don't have enough information to answer that from the sources on this computer."
const DOC_REFUSAL = "I don't have enough information in your documents."
const STILL_READING = "I'm still reading your files. Ask again when they finish."

export const DEFAULT_API_BASE = 'https://api.synap.surf'

const DEFAULT_SETTINGS: Settings = {
  offlineOnly: false,
  webSearchAllowed: false,
  telemetryOptIn: false,
  chatModelId: '',
  onboardingComplete: false,
  theme: 'system',
  apiBaseUrl: DEFAULT_API_BASE,
  packSyncHours: 6,
}

export async function createServices(): Promise<Services> {
  const hw = await detectHardware()
  let offlineOnly = false
  const store = await openStore()
  const calc = new Calculator(calcWorker)
  const inflight = new Map<string, AbortController>()
  let downloading: { id: string; done: number; total: number } | null = null
  let active: { role: 'chat' | 'embed'; modelId: string; mmproj: string; server: LlamaServer } | null = null
  let modelTail: Promise<void> = Promise.resolve()
  let ui: BrowserWindow | null = null
  let osOnline = isOnline()
  let catalogCache: RemotePack[] = []
  let syncing = false
  let lastSyncAt = readStamp(join(app.getPath('userData'), 'pack-sync.json'))
  const packState = new Map<string, { progress: number | null; error: string | null }>()
  let stableOnline = osOnline
  let apiReachable = false
  let checking = true
  const sidecars: ModelStatus['sidecars'] = { chat: 'stopped', embed: 'stopped', whisper: 'stopped' }

  const settingsPath = () => join(app.getPath('userData'), 'settings.json')
  const modelsDir = () => surfEnv('MODELS_DIR') ?? join(app.getPath('userData'), 'models')

  function tessdataPath(): string {
    const packaged = join(process.resourcesPath, 'tessdata')
    if (app.isPackaged && existsSync(packaged)) return packaged
    return join(app.getAppPath(), 'resources', 'tessdata')
  }

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
      ...reachNow(settings.offlineOnly),
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

  function withModel<T>(fn: () => Promise<T>): Promise<T> {
    const run = modelTail.then(fn, fn)
    modelTail = run.then(() => undefined, () => undefined)
    return run
  }

  async function ensure(role: 'chat' | 'embed', model: ModelEntry, ctx: number, mmproj = ''): Promise<LlamaServer> {
    if (active && active.role === role && active.modelId === model.id && active.mmproj === mmproj && active.server.state === 'ready') return active.server
    await stopActive()
    const bin = resolveSidecar('llama-server', app.isPackaged, process.resourcesPath, app.getAppPath())
    const server = new LlamaServer({
      binPath: bin,
      modelPath: join(modelsDir(), model.file),
      mmprojPath: mmproj || undefined,
      embeddings: role === 'embed',
      pooling: 'mean',
      ctx,
      threads: chatThreads(hw),
      startupTimeoutMs: 180_000,
    })
    sidecars[role] = 'starting'
    server.on('state', (st: SidecarState) => { sidecars[role] = st === 'starting' || st === 'ready' || st === 'crashed' || st === 'stopped' ? st : 'stopped' })
    await server.start()
    active = { role, modelId: model.id, mmproj, server }
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

  function noteFile(file: LibraryFile): void {
    if (ui && !ui.isDestroyed()) ui.webContents.send(IPC.libraryEvent, { type: 'upsert', file })
  }

  function requireLibrary(): { queue: AttachmentQueue; deps: IngestDeps } {
    if (!docs) throw new Error("Encrypted storage isn't available on this computer, so documents can't be indexed.")
    return docs
  }

  const docs: { queue: AttachmentQueue; deps: IngestDeps } | null = store.db ? (() => {
    const root = join(app.getPath('userData'), 'attachments')
    mkdirSync(root, { recursive: true })
    const deps: IngestDeps = {
      db: store.db,
      root,
      tessdataDir: tessdataPath(),
      tessCacheDir: join(app.getPath('userData'), 'tess-cache'),
      onFile: noteFile,
      embed: (rows) => withModel(async () => {
        const emb = registry().models.find((m) => m.role === 'embedding')
        if (!emb || !(await installed(emb.file, emb.size_bytes))) throw new Error('Download EmbeddingGemma 2 in Models before indexing documents.')
        const server = await ensure('embed', emb, 2048)
        return new Embedder(new LlamaClient({ baseUrl: server.baseUrl, apiKey: server.apiKey })).embedDocs(rows)
      }),
      caption: async (png) => withModel(async () => {
        const chat = await chooseChat(registry(), readSettings().chatModelId)
        const file = chat?.mmproj?.file
        const path = file ? join(modelsDir(), file) : ''
        if (!chat || !mmprojReady(path)) return null
        const profile = hw.tier >= 2 ? BUDGETS.tier2 : hw.tier === 1 ? BUDGETS.tier1 : BUDGETS.tier0
        const server = await ensure('chat', chat, profile.serverCtx, path)
        const client = new LlamaClient({
          baseUrl: server.baseUrl,
          apiKey: server.apiKey,
          sampling: chat.sampling,
          chatTemplateKwargs: chat.chat_template_kwargs,
        })
        try { return await captionImage(client, png) }
        catch (error) { console.warn('[surf] image caption skipped:', (error as Error).message); return null }
      }),
    }
    const queue = new AttachmentQueue(deps)
    queue.kick()
    return { queue, deps }
  })() : null

  async function collectWeb(question: string, signal: AbortSignal, chatModel: ModelEntry, ctx: number, win: BrowserWindow, messageId: string): Promise<WebPiece[]> {
    const current = readSettings()
    assertNetworkAllowed(current.offlineOnly)
    const server = await ensure('chat', chatModel, ctx)
    const client = new LlamaClient({
      baseUrl: server.baseUrl,
      apiKey: server.apiKey,
      sampling: chatModel.sampling,
      chatTemplateKwargs: chatModel.chat_template_kwargs,
    })
    let raw = ''
    try {
      const rewritten = await client.chat([{ role: 'user', content: rewritePrompt(question) }], undefined, signal, 120)
      raw = String(rewritten.choices[0]?.message?.content ?? '')
    } catch (error) {
      if (signal.aborted) throw error
      raw = ''
    }
    const queries = parseSearchQueries(raw, question)
    const base = apiBase(readSettings())
    assertNetworkAllowed(readSettings().offlineOnly)
    const deviceToken = await freshAccess({ base, offlineOnly: readSettings().offlineOnly })
    if (!deviceToken) throw new Error('Sign in to search the web.')
    const picked = new Map<string, { title: string; published: string | null }>()
    for (const query of queries) {
      if (signal.aborted) return []
      assertNetworkAllowed(readSettings().offlineOnly)
      const rows = await searchWeb({ base, token: deviceToken, offlineOnly: readSettings().offlineOnly, query, k: 4, signal })
      for (const row of rows) {
        if (!picked.has(row.url)) picked.set(row.url, { title: row.title, published: row.published })
      }
    }
    const urls = [...picked.keys()].slice(0, 3)
    if (!urls.length) return []
    sendEvent(win, { type: 'status', messageId, phase: 'reading' })
    assertNetworkAllowed(readSettings().offlineOnly)
    const pages = await fetchPages({ base, token: deviceToken, offlineOnly: readSettings().offlineOnly, urls, signal })
    const pieces = pages.flatMap((page) => chunkBlocks([{ text: page.text, heading: page.title }]).slice(0, 2).map((chunk) => ({
      text: chunk.text,
      title: page.title || picked.get(page.url)?.title || domainOf(page.url),
      url: page.url,
      published: page.published ?? picked.get(page.url)?.published ?? null,
    })))
    if (!pieces.length) return []
    const emb = registry().models.find((m) => m.role === 'embedding')
    if (!emb || !(await installed(emb.file, emb.size_bytes))) throw new Error('Download EmbeddingGemma 2 in Models before searching the web.')
    const embedServer = await ensure('embed', emb, 2048)
    const embedder = new Embedder(new LlamaClient({ baseUrl: embedServer.baseUrl, apiKey: embedServer.apiKey }))
    const vectors = await embedder.embedDocs(pieces.map((piece) => ({ title: piece.title, text: piece.text })))
    const [qvec] = await embedder.embedQueries([question])
    return rankPassages(qvec, pieces.map((piece, i) => ({ ...piece, vec: vectors[i] })), 4)
      .filter((piece) => piece.cosine >= WEB_FLOOR)
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

    const scopeId = req.docScope === 'all' ? null : conversationId
    const docCounts = store.db ? countsFor(store.db, scopeId) : { ready: 0, pending: 0 }
    if (docCounts.ready === 0 && docCounts.pending > 0) {
      await emitText(win, messageId, STILL_READING)
      finish(conversationId, messageId, userMessageId, win, STILL_READING, [], 'insufficient')
      return
    }

    await withModel(async () => {
      let hits: Array<Hit | UserHit> = []
      let decision: GateDecision | 'skip' = 'skip'
      let fromDocs = false
      const versions = new Map<string, string>()
      const opened: DB[] = []
      try {
        const packDbs: Record<string, DB> = {}
        for (const row of await readInstalled(packsRoot())) {
          const dbPath = join(packsRoot(), row.id, row.version, 'pack.sqlite')
          if (!existsSync(dbPath)) continue
          try {
            const db = openPackDb(dbPath)
            const label = `${row.title} · ${row.version}`
            packDbs[label] = db
            versions.set(label, row.version)
            opened.push(db)
          } catch (error) {
            console.warn('[surf] pack skipped:', (error as Error).message)
          }
        }
        const wantDocs = docCounts.ready > 0 && Boolean(store.db)
        const wantPacks = opened.length > 0
        if (wantDocs || wantPacks) {
          const emb = reg.models.find((m) => m.role === 'embedding')
          if (!emb || !(await installed(emb.file, emb.size_bytes))) {
            throw new Error('Download EmbeddingGemma 2 in Models before searching documents or packs.')
          }
          const embedServer = await ensure('embed', emb, 2048)
          const embedder = new Embedder(new LlamaClient({ baseUrl: embedServer.baseUrl, apiKey: embedServer.apiKey }))
          const [qvec] = await embedder.embedQueries([text])
          const docFound = wantDocs && store.db
            ? searchUser(store.db, text, qvec, scopeId, 5)
            : { top: [] as UserHit[], decision: 'skip' as const }
          const packFound = wantPacks ? hybridSearch(packDbs, text, qvec) : { top: [] as Hit[], decision: 'skip' as const }
          const merged = mergeLocal(
            { hits: docFound.top, decision: wantDocs ? docFound.decision : 'skip' },
            { hits: packFound.top, decision: wantPacks ? packFound.decision : 'skip' },
          )
          hits = merged.hits
          decision = merged.decision
          fromDocs = merged.fromDocs && hits.some((hit) => Boolean((hit as UserHit).fileName))
        }
      } finally {
        for (const db of opened) db.close()
      }

      const fresh = wantsFresh(text)
      const signedIn = Boolean(await loadSession())
      const webAllowed = settings.webSearchAllowed && req.allowWeb !== false && signedIn
      const connected = reachNow(settings.offlineOnly)
      const plan = decideWeb({
        local: decision,
        fresh,
        online: connected.online,
        offlineOnly: settings.offlineOnly,
        webAllowed,
      })
      if (plan.branch === 'refuse') {
        const needsSignIn = settings.webSearchAllowed && req.allowWeb !== false && !signedIn && connected.online && !settings.offlineOnly && (fresh || decision === 'insufficient' || decision === 'skip')
        const message = needsSignIn ? 'Sign in to search the web, or add a document.' : refusalMessage(plan.hint ?? HINT_FAILED)
        await emitText(win, messageId, message)
        finish(conversationId, messageId, userMessageId, win, message, [], 'insufficient')
        return
      }

      const chatModel = await chooseChat(reg, settings.chatModelId)
      if (!chatModel) {
        const suggested = pick(reg, 'chat', hw.tier)
        throw new Error(`Download ${labelFor(suggested)} in Models before chatting.`)
      }
      const profile = hw.tier >= 2 ? BUDGETS.tier2 : hw.tier === 1 ? BUDGETS.tier1 : BUDGETS.tier0
      let webHits: WebPiece[] = []
      if (plan.branch === 'web' || plan.branch === 'blend') {
        sendEvent(win, { type: 'status', messageId, phase: 'searching' })
        try {
          webHits = await collectWeb(text, signal, chatModel, profile.serverCtx, win, messageId)
        } catch (error) {
          if (signal.aborted) return
          if (plan.branch === 'web' || error instanceof OfflineOnlyError) {
            const message = refusalMessage(error instanceof OfflineOnlyError ? HINT_OFFLINE : HINT_FAILED)
            await emitText(win, messageId, message)
            finish(conversationId, messageId, userMessageId, win, message, [], 'insufficient')
            return
          }
          webHits = []
        }
        if (plan.branch === 'web' && webHits.length === 0) {
          const message = refusalMessage(HINT_FAILED)
          await emitText(win, messageId, message)
          finish(conversationId, messageId, userMessageId, win, message, [], 'insufficient')
          return
        }
      }
      const server = await ensure('chat', chatModel, profile.serverCtx)
      const client = new LlamaClient({
        baseUrl: server.baseUrl,
        apiKey: server.apiKey,
        sampling: chatModel.sampling,
        chatTemplateKwargs: chatModel.chat_template_kwargs,
      })
      const stayingLocal = webHits.length === 0
      const refusal = fromDocs ? DOC_REFUSAL : INSUFFICIENT
      if (stayingLocal && decision === 'borderline') {
        const check = await client.chat([{ role: 'user', content: borderlinePrompt(text, hits) }], undefined, signal, 8)
        const yn = String(check.choices[0]?.message?.content ?? '').trim().toUpperCase()
        if (yn.startsWith('NO')) {
          await emitText(win, messageId, refusal)
          finish(conversationId, messageId, userMessageId, win, refusal, [], 'insufficient')
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
      const useTools = needsCalculator(text) && !fromDocs && stayingLocal
      const localSources = plan.branch === 'web' ? [] : citationsOf(hits, versions)
      const webSources: Citation[] = webHits.map((hit) => ({
        kind: 'web' as const,
        title: hit.title,
        url: hit.url,
        domain: domainOf(hit.url),
        published: prettyDate(hit.published) || null,
        pack: 'web',
        excerpt: formatWebCitation({ title: hit.title, url: hit.url, published: hit.published }),
      }))
      const sources = [...localSources, ...webSources]
      if (sources.length) sendEvent(win, { type: 'sources', messageId, sources })
      const localChunks = plan.branch === 'web' ? [] : hits.slice(0, 4).map((h) => ({ id: String(h.chunkId), text: h.text, title: h.title || h.pack, score: h.cosine }))
      const webChunks = webHits.map((hit, i) => ({ id: `web-${i + 1}`, text: hit.text, title: formatWebCitation(hit), score: hit.cosine }))
      const budget = await allocate(new LlamaServerTokenizer(server.baseUrl, server.apiKey), profile, {
        system: SYSTEM,
        tools: useTools ? calculatorTools : undefined,
        chunks: [...localChunks, ...webChunks].slice(0, 5),
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
      const gate: GateName = webHits.length ? 'web' : decision === 'skip' ? 'answer' : decision
      finish(conversationId, messageId, userMessageId, win, answer, sources, gate)
    })
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
        ui = win
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
      list: () => listPacks(),
      sync: async () => {
        await syncPacks(true)
        return listPacks()
      },
      remove: async (packId) => {
        await removePack(packsRoot(), packId)
        packState.delete(packId)
      },
      importFromFile: async (win) => {
        const picked = await dialog.showOpenDialog(win, { title: 'Install a signed pack', properties: ['openDirectory'] })
        if (picked.canceled || !picked.filePaths[0]) return null
        const dir = picked.filePaths[0]
        const manifest = await verifyPack(dir, { trustedKeys: trustedPackKeys(), expectedEmbedding: EMBEDDINGGEMMA2_256 })
        const staging = join(packsRoot(), '.staging', manifest.pack_id)
        await rm(staging, { recursive: true, force: true })
        await mkdir(staging, { recursive: true })
        const { cp } = await import('node:fs/promises')
        await cp(dir, staging, { recursive: true })
        await commitInstall(staging, packsRoot(), manifest, String((manifest as { title?: string }).title || manifest.pack_id))
        return manifest.pack_id
      },
    },
    auth: {
      status: async () => authStatus(),
      start: async (email) => {
        const settings = readSettings()
        await startOtp(apiBase(settings), email, settings.offlineOnly)
      },
      verify: async (email, code) => {
        const settings = readSettings()
        await verifyOtp(apiBase(settings), email, code, settings.offlineOnly)
        void syncPacks(true).catch((error: unknown) => console.warn('[surf] pack sync:', (error as Error).message))
        return authStatus()
      },
      signOut: async () => {
        const settings = readSettings()
        await logoutSession(apiBase(settings), settings.offlineOnly)
      },
      devices: async () => {
        const settings = readSettings()
        return fetchDevices(apiBase(settings), settings.offlineOnly)
      },
      revoke: async (deviceId) => {
        const settings = readSettings()
        await revokeDeviceRemote(apiBase(settings), deviceId, settings.offlineOnly)
      },
    },
    settings: {
      get: async () => readSettings(),
      set: async (p) => {
        const next = { ...readSettings(), ...p }
        writeSettings(next)
        if (next.offlineOnly) {
          apiReachable = false
          checking = false
        } else if (p.offlineOnly === false || p.apiBaseUrl) {
          checking = true
          void probeApi()
        }
      },
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
    library: {
      add: ingestPaths,
      pick: async (conversationId, createConversation, win) => {
        const picked = await dialog.showOpenDialog(win, {
          title: 'Add documents',
          properties: ['openFile', 'multiSelections'],
          filters: [{ name: 'Documents', extensions: ['pdf', 'docx', 'pptx', 'xlsx', 'csv', 'txt', 'md', 'html', 'htm', 'png', 'jpg', 'jpeg'] }],
        })
        if (picked.canceled || picked.filePaths.length === 0) return { conversationId, files: [] }
        return ingestPaths(picked.filePaths, conversationId, createConversation, win)
      },
      list: async () => {
        if (!store.db) return []
        return listFiles(store.db)
      },
      retry: async (jobId) => {
        const { queue } = requireLibrary()
        if (!retryJob(store.db!, jobId)) throw new Error('That file is not waiting to be retried.')
        queue.kick()
      },
      cancel: async (jobId) => {
        requireLibrary()
        markCancelled(store.db!, jobId)
        const row = listFiles(store.db!).find((file) => file.jobId === jobId)
        if (row) noteFile(row)
      },
      remove: async (attachmentId) => {
        const { deps } = requireLibrary()
        deleteAttachment(deps.db, attachmentId, deps.root)
      },
      preview: async (ref) => {
        if (!store.db) return null
        if (ref.chunkId) return previewChunk(store.db, ref.chunkId)
        if (ref.attachmentId) return previewAttachment(store.db, ref.attachmentId)
        return null
      },
    },
    links: {
      open: async (url) => { await shell.openExternal(url) },
    },
  }
  function reachNow(offlineOnly: boolean): { online: boolean; onlineReason: string } {
    const described = describeReach({ osOnline: stableOnline, apiReachable, offlineOnly, checking: offlineOnly ? false : checking })
    return { online: described.online, onlineReason: described.reason }
  }

  function watchNetwork(): void {
    setInterval(() => {
      const now = isOnline()
      if (now === osOnline) return
      osOnline = now
      checking = true
      setTimeout(() => {
        stableOnline = osOnline
        void probeApi()
      }, 1500)
    }, 500)
    setInterval(() => { void probeApi() }, 15_000)
    void probeApi()
  }

  async function probeApi(): Promise<void> {
    const settings = readSettings()
    stableOnline = isOnline()
    osOnline = stableOnline
    if (settings.offlineOnly || !stableOnline) {
      apiReachable = false
      checking = false
      return
    }
    apiReachable = await probeHealth(apiBase(settings), 3000)
    checking = false
  }

  watchNetwork()
  const syncTimer = setInterval(() => { void syncPacks(false).catch((error: unknown) => console.warn('[surf] pack sync:', (error as Error).message)) }, 15 * 60 * 1000)
  syncTimer.unref?.()
  setTimeout(() => { void syncPacks(false).catch((error: unknown) => console.warn('[surf] pack sync:', (error as Error).message)) }, 4000)
  return services

  async function authStatus(): Promise<AuthStatus> {
    const session = await loadSession()
    if (!session) return { signedIn: false, email: null, deviceId: null }
    return { signedIn: true, email: session.email, deviceId: session.deviceId }
  }

  async function listPacks(): Promise<PackRow[]> {
    const installed = await readInstalled(packsRoot())
    const byId = new Map(installed.map((row) => [row.id, row]))
    const ids = new Set<string>([...byId.keys(), ...catalogCache.map((pack) => pack.id)])
    return [...ids].map((id) => {
      const local = byId.get(id)
      const remote = catalogCache.find((pack) => pack.id === id)
      const state = packState.get(id)
      const latest = remote?.latest.version ?? null
      return {
        id,
        title: local?.title || remote?.title || id,
        niche: local?.niche || remote?.niche || 'general',
        version: local?.version ?? null,
        latestVersion: latest ?? local?.version ?? null,
        installed: Boolean(local),
        updateAvailable: Boolean(remote && local && latest !== local.version),
        syncedAt: local?.syncedAt ?? null,
        progress: state?.progress ?? null,
        error: state?.error ?? null,
      }
    })
  }

  async function installRemote(pack: RemotePack, previous: string | null): Promise<void> {
    const staging = join(packsRoot(), '.staging', pack.id)
    await rm(staging, { recursive: true, force: true })
    await mkdir(staging, { recursive: true })
    const changed = new Set(pack.changed_files)
    const files = pack.latest.files
    packState.set(pack.id, { progress: 0, error: null })
    try {
      for (let i = 0; i < files.length; i++) {
        if (inflight.size > 0) {
          await rm(staging, { recursive: true, force: true })
          packState.set(pack.id, { progress: null, error: null })
          return
        }
        const file = files[i]
        const dest = join(staging, file.name)
        const prevPath = previous ? join(packsRoot(), pack.id, previous, file.name) : ''
        if (previous && !changed.has(file.name) && existsSync(prevPath)) await copyFile(prevPath, dest)
        else await downloadFile(file.url, dest, {})
        packState.set(pack.id, { progress: (i + 1) / files.length, error: null })
      }
      const manifest = await verifyPack(staging, {
        trustedKeys: trustedPackKeys(),
        expectedEmbedding: EMBEDDINGGEMMA2_256,
        installedVersion: previous ?? undefined,
      })
      await commitInstall(staging, packsRoot(), manifest, pack.title || manifest.pack_id)
      packState.set(pack.id, { progress: null, error: null })
    } catch (error) {
      await rm(staging, { recursive: true, force: true })
      packState.set(pack.id, { progress: null, error: (error as Error).message })
      throw error
    }
  }

  async function syncPacks(force: boolean): Promise<void> {
    if (syncing) return
    const settings = readSettings()
    const session = await loadSession()
    const online = reachNow(settings.offlineOnly).online
    const allowed = shouldSync({
      now: Date.now(),
      lastSyncAt: lastSyncAt,
      intervalMs: Math.max(1, settings.packSyncHours) * 60 * 60 * 1000,
      online,
      signedIn: Boolean(session),
      chatBusy: inflight.size > 0,
      offlineOnly: settings.offlineOnly,
      metered: await isMetered(),
      force,
    })
    if (!allowed) {
      if (!force) return
      if (!session) throw new Error('Sign in to sync knowledge packs.')
      if (settings.offlineOnly || !online) throw new Error('Pack sync waits until you are online.')
      if (inflight.size > 0) throw new Error('Pack sync waits until the current chat finishes.')
      throw new Error('Pack sync is paused on a metered connection.')
    }
    syncing = true
    try {
      const token = await freshAccess({ base: apiBase(settings), offlineOnly: settings.offlineOnly })
      if (!token) throw new Error('Sign in to sync knowledge packs.')
      const installed = await readInstalled(packsRoot())
      catalogCache = await fetchCatalog(apiBase(settings), token, installed.map((row) => `${row.id}@${row.version}`).join(','))
      for (const pack of catalogCache) {
        if (inflight.size > 0) return
        const local = installed.find((row) => row.id === pack.id)
        if (local && local.version === pack.latest.version) continue
        await installRemote(pack, local?.version ?? null)
      }
      lastSyncAt = Date.now()
      writeFileSync(join(app.getPath('userData'), 'pack-sync.json'), JSON.stringify({ at: lastSyncAt }))
    } finally {
      syncing = false
    }
  }

  async function ingestPaths(paths: string[], conversationId: string | null, createConversation: boolean, win: BrowserWindow) {
    ui = win
    const { deps, queue } = requireLibrary()
    let cid = conversationId
    if (!cid && createConversation) cid = store.ensure(null, 'New chat', 'general')
    const files: LibraryFile[] = []
    for (const filePath of paths) {
      const { bytes, name } = await readAttachment(filePath)
      const mime = mimeForName(name)
      if (!mime) throw new Error('Unsupported file.')
      const added = addBytes(deps.db, deps.root, name, mime, bytes, cid)
      const file = listFiles(deps.db).find((row) => row.id === added.attachmentId)
      if (file) {
        files.push(file)
        noteFile(file)
      }
    }
    queue.kick()
    return { conversationId: cid, files }
  }
}

export function startUpdater(win: BrowserWindow, services: Services): void {
  initAutoUpdate(win, () => services.settings.isOfflineOnly())
}

async function openStore(): Promise<SessionStore> {
  try {
    const key = await getOrCreateDbKey()
    const db = openUserDb(join(app.getPath('userData'), 'chat.db'), key, [SESSION_MIGRATION, LIBRARY_MIGRATION])
    return new SessionStore(db)
  } catch (e) {
    console.warn('[surf] encrypted chat store unavailable:', (e as Error).message)
    return new SessionStore(null)
  }
}

function citationsOf(hits: Array<Hit | UserHit>, versions: Map<string, string>): Citation[] {
  return hits.map((hit) => {
    const user = hit as UserHit
    const version = versions.get(hit.pack)
    const library = Boolean(user.fileName)
    return {
      kind: 'document' as const,
      title: hit.title || hit.pack,
      url: hit.url || '',
      pack: hit.pack,
      version,
      chunkId: library ? hit.chunkId : undefined,
      fileName: user.fileName,
      locator: user.locator,
      excerpt: user.excerpt || (version ? hit.text.slice(0, 240) : undefined),
    }
  })
}

function packsRoot(): string {
  return join(app.getPath('userData'), 'packs')
}

function readStamp(path: string): number | null {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { at?: number }
    return typeof raw.at === 'number' ? raw.at : null
  } catch {
    return null
  }
}

function isMetered(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('nmcli', ['-t', '-f', 'GENERAL.METERED', 'dev', 'show'], { timeout: 1500 }, (error, stdout) => {
      if (error) { resolve(false); return }
      resolve(/\b(yes|true)\b/i.test(stdout))
    })
  })
}

function labelFor(m: ModelEntry): string {
  if (m.role === 'embedding') return 'EmbeddingGemma 2'
  if (m.role === 'chat') return `Qwen3.5 ${m.params_b ?? ''}B`.replace(' B', 'B')
  if (m.role === 'asr') return m.id
  return m.id
}

function apiBase(settings: Settings): string {
  return (surfEnv('API_BASE') || settings.apiBaseUrl || DEFAULT_API_BASE).replace(/\/$/, '')
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
