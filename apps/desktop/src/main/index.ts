/**
 * Surf AI desktop — main process.
 * Normal start: secure window + typed IPC.
 * SURF_SELFTEST=1: encrypted DB, safeStorage, calculator, llama-server, sandboxed renderer.
 */
import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { createMainWindow, preloadAndHtml, registerIpc } from './core/main-window'
import { openUserDb } from './core/db'
import { LlamaServer, resolveSidecar } from './core/sidecar-manager'
import { LlamaClient } from './core/llama-client'
import { Embedder, EMBEDDINGGEMMA2_256 } from './core/embedding'
import { Calculator } from './core/calculator'
import calcWorker from './core/calculator.worker?modulePath'
import { surfEnv } from './core/surf-env'
import { createServices, startUpdater } from './core/app-services'
import { IPC } from './core/ipc-contract'

app.setName('surf-ai')
app.setPath('userData', join(app.getPath('appData'), 'surf-ai'))

type Report = Record<string, { ok: boolean; detail: string; ms: number }>

async function step(r: Report, name: string, fn: () => Promise<string>): Promise<void> {
  const t0 = Date.now()
  try { r[name] = { ok: true, detail: await fn(), ms: Date.now() - t0 } }
  catch (e) { r[name] = { ok: false, detail: String((e as Error).stack ?? e), ms: Date.now() - t0 } }
}

async function selfTest(): Promise<void> {
  const r: Report = {}
  const ud = app.getPath('userData'); mkdirSync(ud, { recursive: true })
  const models = surfEnv('MODELS_DIR') ?? join(ud, 'models')
  const bin = resolveSidecar('llama-server', app.isPackaged, process.resourcesPath, app.getAppPath())
  r.env = { ok: true, ms: 0, detail: `electron ${process.versions.electron}, node ${process.versions.node}, packaged=${app.isPackaged}, ${process.platform}-${process.arch}, bin=${bin}` }

  await step(r, 'sqlite: SQLCipher user.db + sqlite-vec float[256] + FTS5', async () => {
    const p = join(ud, 'selftest-user.db'); rmSync(p, { force: true })
    const db = openUserDb(p, randomBytes(32).toString('hex'), [
      `CREATE TABLE chunks(id INTEGER PRIMARY KEY, text TEXT);
       CREATE VIRTUAL TABLE chunks_fts USING fts5(text, content='chunks', content_rowid='id');
       CREATE VIRTUAL TABLE chunk_vectors USING vec0(chunk_id INTEGER PRIMARY KEY, embedding float[256] distance_metric=cosine);`])
    const v = new Float32Array(256); v[0] = 1
    db.prepare('INSERT INTO chunks(id,text) VALUES (1, ?)').run('lube oil pressure alarm')
    db.prepare("INSERT INTO chunks_fts(chunks_fts) VALUES ('rebuild')").run()
    db.prepare('INSERT INTO chunk_vectors(chunk_id, embedding) VALUES (1, ?)').run(Buffer.from(v.buffer))
    const knn = db.prepare('SELECT chunk_id, distance FROM chunk_vectors WHERE embedding MATCH ? AND k = 1').get(Buffer.from(v.buffer)) as { chunk_id: number; distance: number }
    const fts = db.prepare("SELECT rowid FROM chunks_fts WHERE chunks_fts MATCH 'pressure'").get() as { rowid: number }
    const ver = db.prepare('SELECT vec_version() v, sqlite_version() s').get() as { v: string; s: string }
    const cipher = db.pragma('cipher', { simple: true })
    db.close()
    return `cipher=${cipher}, sqlite ${ver.s}, sqlite-vec ${ver.v}, knn id=${knn.chunk_id} dist=${knn.distance.toFixed(3)}, fts rowid=${fts.rowid}`
  })

  await step(r, 'safeStorage (OS keychain)', async () => {
    const { safeStorage } = await import('electron')
    const backend = process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : 'os'
    const avail = await safeStorage.isAsyncEncryptionAvailable()
    if (!avail || backend === 'basic_text') return `backend=${backend}, available=${avail} -> app must refuse (Linux without libsecret); real test on Mac/Windows`
    const enc = await safeStorage.encryptStringAsync('k'.repeat(64))
    const dec = await safeStorage.decryptStringAsync(enc)
    if (dec.result !== 'k'.repeat(64)) throw new Error('round-trip mismatch')
    return `backend=${backend}, round-trip ok (${enc.length} bytes)`
  })

  await step(r, 'calculator worker (mathjs, worker_threads)', async () => {
    const c = new Calculator(calcWorker)
    const a = await c.calc('23.7 * 17.5'); const b = await c.convert(14, 'knots', 'km/h'); c.close()
    if (!a.ok || !b.ok) throw new Error(JSON.stringify([a, b]))
    return `23.7*17.5=${(a as { result: string }).result}; 14 knots=${(b as { result: string }).result}`
  })

  const embGguf = join(models, EMBEDDINGGEMMA2_256.gguf)
  await step(r, 'llama-server sidecar: EmbeddingGemma 2 (256-d)', async () => {
    if (!existsSync(embGguf)) throw new Error(`missing ${embGguf}`)
    const srv = new LlamaServer({ binPath: bin, modelPath: embGguf, embeddings: true, pooling: 'mean', ctx: 2048, logFile: join(ud, 'embed.log') })
    await srv.start()
    try {
      const e = new Embedder(new LlamaClient({ baseUrl: srv.baseUrl, apiKey: srv.apiKey }))
      const [q] = await e.embedQueries(['When did SOLAS enter into force?'])
      const [d1, d2] = await e.embedDocs([{ title: 'SOLAS', text: 'SOLAS entered into force on 25 May 1980.' }, { title: null, text: 'Pizza dough needs yeast.' }])
      const cos = (a: Float32Array, b: Float32Array) => a.reduce((s, x, i) => s + x * b[i], 0)
      return `dim=${q.length}, cos(relevant)=${cos(q, d1).toFixed(3)}, cos(unrelated)=${cos(q, d2).toFixed(3)}`
    } finally { await srv.stop() }
  })

  const chatGguf = join(models, surfEnv('CHAT_GGUF') ?? 'Qwen3.5-2B-Q4_K_M.gguf')
  await step(r, 'llama-server sidecar: Qwen3.5 chat (thinking off)', async () => {
    if (!existsSync(chatGguf)) throw new Error(`missing ${chatGguf}`)
    const srv = new LlamaServer({ binPath: bin, modelPath: chatGguf, ctx: 4096, logFile: join(ud, 'chat.log') })
    await srv.start()
    try {
      const c = new LlamaClient({ baseUrl: srv.baseUrl, apiKey: srv.apiKey })
      const res = await c.chat([{ role: 'user', content: 'Reply with exactly one word: surf' }], undefined, undefined, 16)
      return `answer="${String(res.choices[0].message.content).trim()}"`
    } finally { await srv.stop() }
  })

  await step(r, 'renderer: sandboxed window, preload API, no Node', async () => {
    // The shell asks for status on load. Self-test does not start the app services, so answer with empties.
    ipcMain.removeHandler(IPC.modelsStatus)
    ipcMain.handle(IPC.modelsStatus, () => ({
      tier: 0, ramGb: 0, cpuModel: 'selftest', cores: 1, chatModelId: '', installed: [], downloading: null,
      sidecars: { chat: 'stopped', embed: 'stopped', whisper: 'stopped' }, models: [], online: false,
      offlineOnly: true, onboardingComplete: true, chatPersistence: 'session',
    }))
    ipcMain.removeHandler(IPC.settingsGet)
    ipcMain.handle(IPC.settingsGet, () => ({ offlineOnly: true, webSearchAllowed: false, telemetryOptIn: false, chatModelId: '', onboardingComplete: true }))
    ipcMain.removeHandler(IPC.conversationsList)
    ipcMain.handle(IPC.conversationsList, () => [])
    const paths = preloadAndHtml()
    const win = createMainWindow(paths.preload, paths.html)
    await new Promise<void>((res) => win.webContents.once('did-finish-load', () => res()))
    const probe = await win.webContents.executeJavaScript(
      'JSON.stringify({surf: typeof window.surf, chatSend: typeof window.surf?.chat?.send, require: typeof require, process: typeof process})')
    win.destroy()
    const p = JSON.parse(probe) as { surf: string; require: string; process: string }
    if (p.surf !== 'object' || p.require !== 'undefined' || p.process !== 'undefined') throw new Error(probe)
    return probe
  })

  const out = surfEnv('SELFTEST_OUT') ?? join(ud, 'selftest.json')
  writeFileSync(out, JSON.stringify(r, null, 2))
  console.log(JSON.stringify(r, null, 2))
  app.exit(Object.values(r).every((x) => x.ok) ? 0 : 1)
}

async function captureShots(win: BrowserWindow, dir: string): Promise<void> {
  mkdirSync(dir, { recursive: true })
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
  for (let i = 0; i < 50; i++) {
    const ready = await win.webContents.executeJavaScript(`document.querySelector('[data-ready="yes"]') ? 'yes' : ''`)
    if (ready === 'yes') break
    await sleep(200)
  }
  const shot = async (name: string) => {
    const image = await win.webContents.capturePage()
    writeFileSync(join(dir, `${name}.png`), image.toPNG())
  }
  const go = async (view: string) => {
    await win.webContents.executeJavaScript(`window.__surfNav && window.__surfNav(${JSON.stringify(view)})`)
    await sleep(400)
  }
  for (const theme of ['light', 'dark'] as const) {
    win.setBackgroundColor(theme === 'dark' ? '#0a0a0a' : '#fafafa')
    await win.webContents.executeJavaScript(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`)
    await sleep(250)
    await go('onboarding')
    await shot(`onboarding-${theme}`)
    await go('chat')
    await shot(`chat-${theme}`)
    await go('models')
    await shot(`models-${theme}`)
    await go('settings')
    await shot(`settings-${theme}`)
  }
  console.log('[surf] screenshots in', dir)
}

app.enableSandbox()
if (!app.requestSingleInstanceLock()) app.quit()
app.on('window-all-closed', () => { if (process.platform !== 'darwin' && !surfEnv('SELFTEST')) app.quit() })
void app.whenReady().then(async () => {
  if (surfEnv('SELFTEST')) return selfTest()
  const services = await createServices()
  const paths = preloadAndHtml()
  const win: BrowserWindow = createMainWindow(paths.preload, paths.html)
  registerIpc(win, services)
  startUpdater(win, services)
  const shots = surfEnv('CAPTURE_DIR')
  if (shots) win.webContents.once('did-finish-load', () => { void captureShots(win, shots) })
})
