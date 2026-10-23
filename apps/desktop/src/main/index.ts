/**
 * Surf AI desktop — main process.
 * Normal start: secure window + typed IPC.
 * SURF_SELFTEST=1: encrypted DB, safeStorage, calculator, llama-server, sandboxed renderer.
 */
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync, rmSync } from 'node:fs'
import { createMainWindow, preloadAndHtml, registerIpc } from './core/main-window'
import { openUserDb } from './core/db'
import { LlamaServer, resolveSidecar } from './core/sidecar-manager'
import { LlamaClient } from './core/llama-client'
import { Embedder, EMBEDDINGGEMMA2_256 } from './core/embedding'
import { indexFile } from './core/ingest'
import { shutdownOcr } from './core/ocr'
import { LIBRARY_MIGRATION } from './core/library-schema'
import { SESSION_MIGRATION } from './core/session-store'
import { DOC_TAU } from './core/retrieval'
import { provePack } from './core/pack-selftest'
import { searchUser } from './core/user-search'
import { makeDocx, makePdf, makePng } from './core/samples'
import { Calculator } from './core/calculator'
import calcWorker from './core/calculator.worker?modulePath'
import { surfEnv } from './core/surf-env'
import { createServices, startUpdater } from './core/app-services'
import { IPC } from './core/ipc-contract'
import { installMainLog, installProcessGuards } from './core/main-log'

app.setName('surf-ai')
if (surfEnv('EVAL')) app.setPath('userData', surfEnv('EVAL_DIR') || join(app.getPath('temp'), 'surf-eval'))
else if (surfEnv('E2E_DIR')) app.setPath('userData', surfEnv('E2E_DIR')!)
else app.setPath('userData', join(app.getPath('appData'), 'surf-ai'))

const mainLog = installMainLog(join(app.getPath('userData'), 'logs'))
installProcessGuards(mainLog, (message) => {
  // A native error dialog blocks the main thread. Tests and eval never have a
  // person to dismiss it, so a background failure would leave the window uncreated.
  if (surfEnv('E2E_DIR') || surfEnv('SMOKE') || surfEnv('EVAL') || surfEnv('SELFTEST')) {
    console.error(message)
    return
  }
  dialog.showErrorBox('Synap.surf', message)
})

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
  let ferrySource: { title: string; text: string } | null = null
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

  await step(r, 'rag: ingest PDF, DOCX, and image, then cite', async () => {
    if (!existsSync(embGguf)) throw new Error(`missing ${embGguf}`)
    const docs = join(ud, 'selftest-docs')
    mkdirSync(docs, { recursive: true })
    const pdfPath = join(docs, 'harbor-ferry.pdf')
    const docxPath = join(docs, 'northwind-invoice.docx')
    const pngPath = join(docs, 'shelf.png')
    writeFileSync(pdfPath, makePdf(['The harbor ferry leaves Pier 4 at 06:40.', 'Tickets cost 120 rupees.']))
    writeFileSync(docxPath, await makeDocx([
      { heading: true, text: 'Northwind invoice' },
      { text: 'Invoice INV-441 is due on 18 April 2026 for 408.50 USD.' },
    ]))
    writeFileSync(pngPath, makePng('Warehouse shelf B7 holds 40 coils of rope.'))
    const dbPath = join(ud, 'selftest-rag.db')
    rmSync(dbPath, { force: true })
    const db = openUserDb(dbPath, randomBytes(32).toString('hex'), [SESSION_MIGRATION, LIBRARY_MIGRATION])
    const root = join(ud, 'selftest-attachments')
    const tessdataDir = join(app.getAppPath(), 'resources', 'tessdata')
    const embedSrv = new LlamaServer({ binPath: bin, modelPath: embGguf, embeddings: true, pooling: 'mean', ctx: 2048, logFile: join(ud, 'rag-embed.log'), startupTimeoutMs: 180_000 })
    await embedSrv.start()
    let summary = ''
    try {
      const embedder = new Embedder(new LlamaClient({ baseUrl: embedSrv.baseUrl, apiKey: embedSrv.apiKey }))
      const deps = {
        db, root, tessdataDir, tessCacheDir: join(ud, 'tess-cache'),
        embed: (rows: { title?: string | null; text: string }[]) => embedder.embedDocs(rows),
      }
      await indexFile(deps, pdfPath, null)
      await indexFile(deps, docxPath, null)
      const image = await indexFile(deps, pngPath, null)
      const [qFerry, qHindi, qPizza, qInvoice] = await embedder.embedQueries([
        'What time does the harbor ferry leave?',
        'नौका किस घाट से निकलती है?',
        'best pizza recipe with pineapple',
        'How much is invoice INV-441?',
      ])
      const ferry = searchUser(db, 'What time does the harbor ferry leave?', qFerry, null)
      const hindi = searchUser(db, 'नौका किस घाट से निकलती है?', qHindi, null)
      const pizza = searchUser(db, 'best pizza recipe with pineapple', qPizza, null)
      const invoice = searchUser(db, 'How much is invoice INV-441?', qInvoice, null)
      const top = ferry.top[0]
      if (!top || !top.fileName.endsWith('.pdf')) throw new Error(`ferry hit ${top?.fileName} decision=${ferry.decision}`)
      if (ferry.decision === 'insufficient') throw new Error(`ferry gate insufficient cos=${top.cosine.toFixed(3)} tau=${DOC_TAU.latinCos}`)
      ferrySource = { title: top.title, text: top.text }
      if (invoice.top[0]?.fileName.endsWith('.docx') !== true && invoice.decision === 'insufficient') {
        throw new Error(`invoice miss decision=${invoice.decision} top=${invoice.top[0]?.fileName}`)
      }
      const hindiCos = hindi.top[0]?.cosine ?? 0
      const pizzaCos = pizza.top[0]?.cosine ?? 0
      if (hindiCos + 0.02 < pizzaCos) throw new Error(`hindi cosine ${hindiCos.toFixed(3)} did not beat unrelated ${pizzaCos.toFixed(3)}`)
      if (hindiCos >= DOC_TAU.hindiCos && hindi.decision === 'insufficient') {
        throw new Error(`hindi gate too strict cos=${hindiCos.toFixed(3)} decision=${hindi.decision}`)
      }
      const imageText = (db.prepare(
        `SELECT c.text AS text FROM chunks c JOIN documents d ON d.id = c.document_id JOIN attachments a ON a.id = d.attachment_id WHERE a.original_name = ?`,
      ).all('shelf.png') as { text: string }[]).map((row) => row.text).join(' ')
      if (!/B7|rope/i.test(imageText)) throw new Error(`image OCR did not read the shelf label: ${imageText.slice(0, 180)}`)
      summary = `ferry ${top.fileName} ${top.locator} cos=${top.cosine.toFixed(3)} gate=${ferry.decision}; hindi cos=${hindiCos.toFixed(3)} gate=${hindi.decision}; unrelated cos=${pizzaCos.toFixed(3)} gate=${pizza.decision}; invoice ${invoice.top[0]?.fileName ?? 'none'} gate=${invoice.decision}; image="${imageText.slice(0, 80)}" chunks=${image.chunkCount}; tau latin ${DOC_TAU.latinCos}/${DOC_TAU.latinCov} strong ${DOC_TAU.latinStrong} hindi ${DOC_TAU.hindiCos}`
    } finally {
      await shutdownOcr()
      db.close()
      await embedSrv.stop()
    }
    return summary
  })

  const chatGguf = join(models, surfEnv('CHAT_GGUF') ?? 'Qwen3.5-2B-Q4_K_M.gguf')
  await step(r, 'llama-server sidecar: Qwen3.5 chat (thinking off)', async () => {
    if (!existsSync(chatGguf)) throw new Error(`missing ${chatGguf}`)
    const srv = new LlamaServer({ binPath: bin, modelPath: chatGguf, ctx: 4096, logFile: join(ud, 'chat.log'), startupTimeoutMs: 180_000 })
    await srv.start()
    try {
      const c = new LlamaClient({ baseUrl: srv.baseUrl, apiKey: srv.apiKey })
      const res = await c.chat([{ role: 'user', content: 'Reply with exactly one word: surf' }], undefined, undefined, 16)
      const word = String(res.choices[0].message.content).trim()
      if (!ferrySource) return `answer="${word}" (no document fixture)`
      const grounded = await c.chat([{
        role: 'system',
        content: 'Answer using only the sources. Cite the source as [S1]. Do not invent times or citations.',
      }, {
        role: 'user',
        content: `SOURCES:\n[S1] ${ferrySource.title}\n${ferrySource.text}\n\nQuestion: What time does the harbor ferry leave?`,
      }], undefined, undefined, 120)
      const answer = String(grounded.choices[0].message.content ?? '').trim()
      if (!/06:40|6:40|0640/.test(answer)) throw new Error(`grounded answer missing 06:40: ${answer}`)
      if (!/\[S1\]/.test(answer)) throw new Error(`grounded answer missing citation: ${answer}`)
      return `answer="${word}"; grounded="${answer.replace(/\s+/g, ' ')}"`
    } finally { await srv.stop() }
  })

  await step(r, 'packs: OTP login, signed install, citation online and offline', async () => {
    if (!existsSync(embGguf) || !existsSync(chatGguf)) throw new Error(`missing model under ${models}`)
    return provePack({ bin, embGguf, chatGguf, logDir: ud })
  })

  await step(r, 'renderer: sandboxed window, preload API, no Node', async () => {
    // The shell asks for status on load. Self-test does not start the app services, so answer with empties.
    ipcMain.removeHandler(IPC.modelsStatus)
    ipcMain.handle(IPC.modelsStatus, () => ({
      tier: 0, ramGb: 0, cpuModel: 'selftest', cores: 1, chatModelId: '', codeModelId: '', arch: process.arch, platform: process.platform, installed: [], downloading: null,
      sidecars: { chat: 'stopped', embed: 'stopped', whisper: 'stopped' }, speechModelId: '', models: [], online: false,
      onlineReason: 'Offline only is on',
      offlineOnly: true, onboardingComplete: true, chatPersistence: 'session',
    }))
    ipcMain.removeHandler(IPC.settingsGet)
    ipcMain.handle(IPC.settingsGet, () => ({ offlineOnly: true, networkMode: 'offline' as const, telemetryOptIn: false, chatModelId: '', codeModelId: '', onboardingComplete: true, theme: 'light' as const, apiBaseUrl: 'https://api.synap.surf', packSyncHours: 6, updateChannel: 'stable' as const, codeAgentMode: 'ask' as const, codeAgentAllowlist: [], codeAgentAutoConfirmed: false, tabSuggestions: false, tabSuggestionsOff: [] as string[], keepWarm: true, idleUnloadMinutes: 15, speculativeDecoding: false, mascotName: 'Surf', mascotColor: '#f2740f', accent: 'orange' as const, density: 'comfortable' as const, animateMascot: false }))
    ipcMain.removeHandler(IPC.conversationsList)
    ipcMain.handle(IPC.conversationsList, () => [])
    ipcMain.removeHandler(IPC.authStatus)
    ipcMain.handle(IPC.authStatus, () => ({ signedIn: false, email: null, deviceId: null }))
    ipcMain.removeHandler(IPC.authDevices)
    ipcMain.handle(IPC.authDevices, () => [])
    ipcMain.removeHandler(IPC.packsList)
    ipcMain.handle(IPC.packsList, () => [])
    ipcMain.removeHandler(IPC.licenceStatus)
    ipcMain.handle(IPC.licenceStatus, () => ({
      state: 'dev', message: '', plan: null, email: null, refreshBy: null, expiresAt: null,
      subscriptionEndsAt: null, termMonths: null, subscriptionWarning: false, features: [],
      deviceIdHash: null, buyUrl: 'https://synap.surf/buy', licenceId: null,
    }))
    ipcMain.removeHandler(IPC.licenceDevices)
    ipcMain.handle(IPC.licenceDevices, () => [])
    ipcMain.removeHandler(IPC.libraryList)
    ipcMain.handle(IPC.libraryList, () => [])
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
    // Set the saved theme. Clicking [data-theme-choice] is wrong: the sidebar
    // control toggles, and writing the document attribute alone leaves the
    // switch highlighting the previous setting.
    await win.webContents.executeJavaScript(`
      new Promise((resolve) => {
        const theme = ${JSON.stringify(theme)};
        if (typeof window.__surfTheme === 'function') window.__surfTheme(theme);
        else document.documentElement.dataset.theme = theme;
        const start = Date.now();
        (function check() {
          if (document.documentElement.dataset.theme === theme || Date.now() - start > 2000) resolve(document.documentElement.dataset.theme || '');
          else setTimeout(check, 20);
        })();
      })
    `)
    await sleep(250)
    await go('onboarding')
    await shot(`onboarding-${theme}`)
    await shot(`first-launch-${theme}`)
    await go('home')
    await shot(`home-${theme}`)
    await go('chat')
    await shot(`chat-${theme}`)
    await go('models')
    await shot(`models-${theme}`)
    await go('settings')
    await shot(`settings-${theme}`)
    await shot(`settings-models-${theme}`)
    const demo = async (scene: string, name: string) => {
      await win.webContents.executeJavaScript(`window.__surfDemo && window.__surfDemo(${JSON.stringify(scene)})`)
      await sleep(350)
      await shot(`${name}-${theme}`)
    }
    await demo('setup-pick', 'setup-pick')
    await demo('setup-progress', 'setup-progress')
    await demo('setup-paused', 'setup-paused')
    await demo('setup-offline', 'setup-offline')
    await demo('setup-disk', 'setup-disk')
    await demo('setup-checksum', 'setup-checksum')
    await demo('home', 'home-agents')
    await demo('agent-general', 'chat-general')
    await demo('agent-code', 'chat-code')
    await demo('agent-assistant', 'chat-assistant')
    await demo('upload', 'upload')
    await demo('processing', 'processing')
    await demo('citation', 'citation')
    await demo('library', 'library')
    await demo('convert', 'convert')
    await demo('fill', 'fill')
    await demo('searching', 'searching')
    await demo('signin', 'signin')
    await demo('account', 'account')
    await demo('packs', 'packs')
    await demo('packcite', 'packcite')
    await demo('update', 'update')
    await go('settings')
    const modeBefore = await win.webContents.executeJavaScript(`document.querySelector('[data-sync-chip]')?.getAttribute('data-network-mode') || ''`)
    if (modeBefore !== 'offline') {
      await win.webContents.executeJavaScript(`document.querySelector('[data-network-settings] [data-network-mode="offline"]')?.click()`)
      await sleep(700)
    }
    await demo('refusal', 'refusal')
    if (modeBefore && modeBefore !== 'offline') {
      await go('settings')
      await win.webContents.executeJavaScript(`document.querySelector('[data-network-settings] [data-network-mode=${JSON.stringify(modeBefore)}]')?.click()`)
      await sleep(400)
    }
  }
  console.log('[surf] screenshots in', dir)
  app.exit(0)
}

function hasMatch(dir: string, pred: (name: string) => boolean, depth = 0): boolean {
  if (depth > 6 || !existsSync(dir)) return false
  for (const name of readdirSync(dir)) {
    if (pred(name)) return true
    const path = join(dir, name)
    try {
      if (statSync(path).isDirectory() && hasMatch(path, pred, depth + 1)) return true
    } catch { /* unreadable entry */ }
  }
  return false
}

async function smoke(): Promise<void> {
  try {
    const ud = app.getPath('userData')
    mkdirSync(ud, { recursive: true })
    const dbPath = join(ud, 'smoke.db')
    rmSync(dbPath, { force: true })
    const db = openUserDb(dbPath, randomBytes(32).toString('hex'), ['CREATE TABLE smoke(id INTEGER PRIMARY KEY);'])
    db.prepare('INSERT INTO smoke(id) VALUES (1)').run()
    const row = db.prepare('SELECT id FROM smoke').get() as { id: number }
    db.close()
    if (row.id !== 1) throw new Error('database did not open')
    const bin = resolveSidecar('llama-server', app.isPackaged, process.resourcesPath, app.getAppPath())
    if (!existsSync(bin)) throw new Error(`missing sidecar ${bin}`)
    if (app.isPackaged) {
      const tess = join(process.resourcesPath, 'tessdata', 'eng.traineddata')
      if (!existsSync(tess)) throw new Error(`missing ${tess}`)
      const unpacked = join(process.resourcesPath, 'app.asar.unpacked')
      if (!hasMatch(unpacked, (name) => name.endsWith('.node'))) throw new Error('no unpacked native addon')
      if (!hasMatch(unpacked, (name) => name === 'pdfjs-dist')) throw new Error('pdfjs was not unpacked')
      if (!hasMatch(unpacked, (name) => name.includes('tesseract'))) throw new Error('tesseract was not unpacked')
    }
    await new Promise<void>((resolve, reject) => {
      const child = spawn(bin, ['--version'], { stdio: 'ignore' })
      const timer = setTimeout(() => { child.kill(); reject(new Error('sidecar timed out')) }, 20_000)
      child.on('error', (error) => { clearTimeout(timer); reject(error) })
      child.on('exit', (code) => {
        clearTimeout(timer)
        if (code === 0) resolve()
        else reject(new Error(`sidecar exit ${code}`))
      })
    })
    console.log('[surf] smoke ok')
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
}

if (surfEnv('SMOKE') || surfEnv('E2E_DIR')) app.disableHardwareAcceleration()
// The smoke process only opens a database and a sidecar. The Chromium sandbox
// deadlocks an x64 build under Rosetta, so the packaged app still sandboxes
// and the smoke launch does not.
if (!surfEnv('SMOKE')) app.enableSandbox()
if (!app.requestSingleInstanceLock()) app.quit()

let queuedSetup = process.argv.find((arg) => arg.startsWith('synap:')) ?? null
let setupSink: { applySetupLink: (url: string) => string | null } | null = null
let mainWindow: BrowserWindow | null = null

function takeSetup(url: string | undefined): void {
  if (!url?.startsWith('synap:')) return
  if (setupSink) setupSink.applySetupLink(url)
  else queuedSetup = url
}

function goLobby(): void {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
  void mainWindow.webContents.executeJavaScript('window.__surfNav && window.__surfNav("home")').catch(() => undefined)
}

app.on('open-url', (event, url) => {
  event.preventDefault()
  if (url.startsWith('synap://lobby')) { goLobby(); return }
  takeSetup(url)
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})
app.on('second-instance', (_event, argv) => {
  const link = argv.find((arg) => arg.startsWith('synap:'))
  if (link?.startsWith('synap://lobby')) { goLobby(); return }
  takeSetup(link)
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin' && !surfEnv('SELFTEST') && !surfEnv('EVAL') && !surfEnv('SMOKE')) app.quit() })
void app.whenReady().then(async () => {
  if (surfEnv('SMOKE')) return smoke()
  if (surfEnv('SELFTEST')) return selfTest()
  if (surfEnv('EVAL')) {
    const { runEval } = await import('./eval-run')
    try {
      await runEval()
      app.exit(0)
    } catch (error) {
      console.error(error)
      app.exit(1)
    }
    return
  }
  const boot = Date.now()
  const services = await createServices()
  setupSink = services
  if (!surfEnv('SMOKE') && !surfEnv('SELFTEST') && !surfEnv('EVAL')) {
    if (process.defaultApp && process.argv.length >= 2) app.setAsDefaultProtocolClient('synap', process.execPath, [process.argv[1]])
    else app.setAsDefaultProtocolClient('synap')
  }
  if (queuedSetup) services.applySetupLink(queuedSetup)
  await services.adoptLocal()
  const paths = preloadAndHtml()
  const win: BrowserWindow = createMainWindow(paths.preload, paths.html)
  mainWindow = win
  win.on('focus', () => { void services.adoptLocal() })
  registerIpc(win, services)
  const stopStreams = () => services.lifecycle.releaseWindow()
  win.on('closed', stopStreams)
  win.webContents.on('render-process-gone', stopStreams)
  startUpdater()
  const shots = surfEnv('CAPTURE_DIR')
  win.webContents.once('did-finish-load', () => {
    if (surfEnv('E2E_QUIT')) {
      console.log(`[surf] startup-ms ${Date.now() - boot}`)
      app.exit(0)
      return
    }
    if (shots) void captureShots(win, shots)
  })
})
