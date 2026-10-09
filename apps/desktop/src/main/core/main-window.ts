/**
 * Secure window + IPC wiring (main process).
 * contextIsolation, no nodeIntegration, sandbox, strict CSP, trusted sender check, zod on every payload.
 */
import { app, BrowserWindow, ipcMain, session, shell, type IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'
import { IPC, type ChunkPreview, type ConversationSummary, type LibraryFile, type ModelStatus, type SettingsPatch, type StoredMessage } from './ipc-contract.js'
import { AttachmentId, ChatSendReq, ConversationId, JobId, LibraryAdd, LibraryPick, LibraryPreview, ModelId, SettingsPatch as SettingsPatchSchema, type ParsedChat } from './ipc-schemas.js'

export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ')

const DEV_URL = process.env['ELECTRON_RENDERER_URL']

export function createMainWindow(preloadPath: string, rendererHtml: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 880,
    minHeight: 600,
    show: false,
    title: 'Surf AI',
    backgroundColor: '#fafafa',
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: true,
    },
  })

  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    const csp = DEV_URL ? CSP.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'") : CSP
    cb({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } })
  })
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'media'))

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => { if (url !== win.webContents.getURL()) e.preventDefault() })
  win.once('ready-to-show', () => win.show())

  if (DEV_URL && !app.isPackaged) void win.loadURL(DEV_URL)
  else void win.loadFile(rendererHtml)
  return win
}

function assertTrusted(e: IpcMainInvokeEvent): void {
  const url = e.senderFrame?.url ?? ''
  const ok = url.startsWith('file://') || (!!DEV_URL && url.startsWith(DEV_URL))
  if (!ok || e.senderFrame !== e.sender.mainFrame) throw new Error('untrusted IPC sender')
}

export interface Services {
  chat: {
    send(req: ParsedChat, win: BrowserWindow): Promise<{ conversationId: string; messageId: string }>
    cancel(id: string): void
  }
  models: {
    status(): Promise<ModelStatus>
    download(modelId: string, win: BrowserWindow): Promise<void>
  }
  conversations: {
    list(): Promise<ConversationSummary[]>
    open(id: string): Promise<{ id: string; messages: StoredMessage[] }>
  }
  packs: {
    list(): Promise<{ id: string; version: string; niche: string }[]>
    importFromFile(): Promise<string | null>
  }
  settings: {
    get(): Promise<Required<SettingsPatch>>
    set(p: SettingsPatch): Promise<void>
    isOfflineOnly(): boolean
  }
  updates: {
    check(): Promise<string | null>
    installOffline(win: BrowserWindow): Promise<boolean>
  }
  library: {
    add(paths: string[], conversationId: string | null, createConversation: boolean, win: BrowserWindow): Promise<{ conversationId: string | null; files: LibraryFile[] }>
    pick(conversationId: string | null, createConversation: boolean, win: BrowserWindow): Promise<{ conversationId: string | null; files: LibraryFile[] }>
    list(): Promise<LibraryFile[]>
    retry(jobId: string): Promise<void>
    cancel(jobId: string): Promise<void>
    remove(attachmentId: string): Promise<void>
    preview(ref: { chunkId?: number; attachmentId?: string }): Promise<ChunkPreview | null>
  }
}

export function registerIpc(win: BrowserWindow, s: Services): void {
  ipcMain.handle(IPC.chatSend, (e, raw) => { assertTrusted(e); return s.chat.send(ChatSendReq.parse(raw), win) })
  ipcMain.handle(IPC.chatCancel, (e, id) => { assertTrusted(e); if (typeof id === 'string') s.chat.cancel(id) })
  ipcMain.handle(IPC.settingsGet, (e) => { assertTrusted(e); return s.settings.get() })
  ipcMain.handle(IPC.settingsSet, (e, raw) => { assertTrusted(e); return s.settings.set(SettingsPatchSchema.parse(raw)) })
  ipcMain.handle(IPC.modelsStatus, (e) => { assertTrusted(e); return s.models.status() })
  ipcMain.handle(IPC.modelsDownload, (e, raw) => { assertTrusted(e); return s.models.download(ModelId.parse(raw), win) })
  ipcMain.handle(IPC.conversationsList, (e) => { assertTrusted(e); return s.conversations.list() })
  ipcMain.handle(IPC.conversationsOpen, (e, raw) => { assertTrusted(e); return s.conversations.open(ConversationId.parse(raw)) })
  ipcMain.handle(IPC.packsList, (e) => { assertTrusted(e); return s.packs.list() })
  ipcMain.handle(IPC.packsImportFile, (e) => { assertTrusted(e); return s.packs.importFromFile() })
  ipcMain.handle(IPC.updatesCheck, (e) => { assertTrusted(e); return s.updates.check() })
  ipcMain.handle(IPC.updatesInstallOffline, (e) => { assertTrusted(e); return s.updates.installOffline(win) })
  ipcMain.handle(IPC.libraryAdd, (e, raw) => {
    assertTrusted(e)
    const body = LibraryAdd.parse(raw)
    return s.library.add(body.paths, body.conversationId, body.createConversation, win)
  })
  ipcMain.handle(IPC.libraryPick, (e, raw) => {
    assertTrusted(e)
    const body = LibraryPick.parse(raw ?? { conversationId: null })
    return s.library.pick(body.conversationId, body.createConversation, win)
  })
  ipcMain.handle(IPC.libraryList, (e) => { assertTrusted(e); return s.library.list() })
  ipcMain.handle(IPC.libraryRetry, (e, raw) => { assertTrusted(e); return s.library.retry(JobId.parse(raw)) })
  ipcMain.handle(IPC.libraryCancel, (e, raw) => { assertTrusted(e); return s.library.cancel(JobId.parse(raw)) })
  ipcMain.handle(IPC.libraryDelete, (e, raw) => { assertTrusted(e); return s.library.remove(AttachmentId.parse(raw)) })
  ipcMain.handle(IPC.libraryPreview, (e, raw) => { assertTrusted(e); return s.library.preview(LibraryPreview.parse(raw)) })
}

/** Layout note for electron-vite output: out/main, out/preload, out/renderer. */
export function preloadAndHtml(): { preload: string; html: string } {
  return {
    preload: join(__dirname, '../preload/index.js'),
    html: join(__dirname, '../renderer/index.html'),
  }
}
