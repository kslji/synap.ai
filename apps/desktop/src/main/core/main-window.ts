/**
 * Secure window + IPC wiring (main process).
 * contextIsolation, no nodeIntegration, sandbox, strict CSP, trusted sender check, zod on every payload.
 */
import { app, BrowserWindow, ipcMain, session, shell, type IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'
import { z } from 'zod'
import { IPC, type AgentCardView, type AssistantDesk, type AuthStatus, type ChunkPreview, type CodeRunResult, type ConversationSummary, type DeviceInfo, type DocumentResult, type EditProposalView, type EditResult, type FillPlan, type FillRow, type LibraryFile, type LicenseNote, type ModelStatus, type PackRow, type SettingsPatch, type StoredMessage, type SymbolHit, type WebCacheStatus } from './ipc-contract.js'
import type { ExportFormat } from './ipc-contract.js'
import { AssistantActionId, AssistantSummary, AttachmentId, ChatSendReq, CodeApply, CodePropose, CodeQuery, CodeRunBody, ConversationId, DeviceId, DocumentConvert, DocumentExport, DocumentPlan, EmailBody, HttpLink, JobId, LibraryAdd, LibraryPick, LibraryPreview, ModelId, OtpVerifyBody, PackId, SettingsPatch as SettingsPatchSchema, type ParsedChat } from './ipc-schemas.js'

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
  "frame-src 'self' about: blob: data:",
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
    remove(id: string): Promise<void>
  }
  webCache: {
    status(): Promise<WebCacheStatus>
    clear(): Promise<WebCacheStatus>
  }
  packs: {
    list(): Promise<PackRow[]>
    sync(): Promise<PackRow[]>
    remove(packId: string): Promise<void>
    importFromFile(win: BrowserWindow): Promise<string | null>
  }
  auth: {
    status(): Promise<AuthStatus>
    start(email: string): Promise<void>
    verify(email: string, code: string): Promise<AuthStatus>
    signOut(): Promise<void>
    devices(): Promise<DeviceInfo[]>
    revoke(deviceId: string): Promise<void>
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
  links: {
    open(url: string): Promise<void>
  }
  documents: {
    pick(win: BrowserWindow, title: string): Promise<string | null>
    convert(win: BrowserWindow, input: { path?: string; attachmentId?: string }, format: ExportFormat): Promise<DocumentResult | null>
    plan(input: { templatePath?: string; templateAttachmentId?: string; sourcePath?: string; sourceAttachmentId?: string }): Promise<FillPlan>
    export(win: BrowserWindow, input: { path?: string; attachmentId?: string }, rows: FillRow[], format: ExportFormat | 'same', highlight: boolean): Promise<DocumentResult | null>
    cancel(): void
  }
  agents: {
    list(): Promise<AgentCardView[]>
  }
  code: {
    search(query: string): Promise<SymbolHit[]>
    attach(win: BrowserWindow): Promise<{ root: string; count: number } | null>
    run(language: string, code: string): Promise<CodeRunResult>
    licenses(): Promise<LicenseNote[]>
    propose(path: string, before: string, after: string): Promise<EditProposalView>
    apply(id: string, approved: boolean): Promise<EditResult>
  }
  assistant: {
    desk(): Promise<AssistantDesk>
    draft(summary: string): Promise<AssistantDesk>
    approve(id: string): Promise<AssistantDesk>
    cancel(id: string): Promise<AssistantDesk>
    armDelete(): Promise<AssistantDesk>
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
  ipcMain.handle(IPC.conversationsDelete, (e, raw) => { assertTrusted(e); return s.conversations.remove(ConversationId.parse(raw)) })
  ipcMain.handle(IPC.webCacheStatus, (e) => { assertTrusted(e); return s.webCache.status() })
  ipcMain.handle(IPC.webCacheClear, (e) => { assertTrusted(e); return s.webCache.clear() })
  ipcMain.handle(IPC.packsList, (e) => { assertTrusted(e); return s.packs.list() })
  ipcMain.handle(IPC.packsSync, (e) => { assertTrusted(e); return s.packs.sync() })
  ipcMain.handle(IPC.packsRemove, (e, raw) => { assertTrusted(e); return s.packs.remove(PackId.parse(raw)) })
  ipcMain.handle(IPC.packsImportFile, (e) => { assertTrusted(e); return s.packs.importFromFile(win) })
  ipcMain.handle(IPC.authStatus, (e) => { assertTrusted(e); return s.auth.status() })
  ipcMain.handle(IPC.authStart, (e, raw) => { assertTrusted(e); return s.auth.start(EmailBody.parse(raw).email) })
  ipcMain.handle(IPC.authVerify, (e, raw) => { assertTrusted(e); const body = OtpVerifyBody.parse(raw); return s.auth.verify(body.email, body.code) })
  ipcMain.handle(IPC.authSignOut, (e) => { assertTrusted(e); return s.auth.signOut() })
  ipcMain.handle(IPC.authDevices, (e) => { assertTrusted(e); return s.auth.devices() })
  ipcMain.handle(IPC.authRevoke, (e, raw) => { assertTrusted(e); return s.auth.revoke(DeviceId.parse(raw)) })
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
  ipcMain.handle(IPC.documentsPick, (e, raw) => {
    assertTrusted(e)
    return s.documents.pick(win, z.string().max(80).parse(raw))
  })
  ipcMain.handle(IPC.documentsConvert, (e, raw) => {
    assertTrusted(e)
    const body = DocumentConvert.parse(raw)
    return s.documents.convert(win, { path: body.path, attachmentId: body.attachmentId }, body.format)
  })
  ipcMain.handle(IPC.documentsPlan, (e, raw) => {
    assertTrusted(e)
    const body = DocumentPlan.parse(raw)
    return s.documents.plan(body)
  })
  ipcMain.handle(IPC.documentsExport, (e, raw) => {
    assertTrusted(e)
    const body = DocumentExport.parse(raw)
    return s.documents.export(win, { path: body.templatePath, attachmentId: body.templateAttachmentId }, body.rows, body.format, body.highlight)
  })
  ipcMain.handle(IPC.documentsCancel, (e) => { assertTrusted(e); s.documents.cancel() })
  ipcMain.handle(IPC.agentsList, (e) => { assertTrusted(e); return s.agents.list() })
  ipcMain.handle(IPC.codeSearch, (e, raw) => { assertTrusted(e); return s.code.search(CodeQuery.parse(raw)) })
  ipcMain.handle(IPC.codeAttach, (e) => { assertTrusted(e); return s.code.attach(win) })
  ipcMain.handle(IPC.codeRun, (e, raw) => { assertTrusted(e); const body = CodeRunBody.parse(raw); return s.code.run(body.language, body.code) })
  ipcMain.handle(IPC.codeLicenses, (e) => { assertTrusted(e); return s.code.licenses() })
  ipcMain.handle(IPC.codePropose, (e, raw) => { assertTrusted(e); const body = CodePropose.parse(raw); return s.code.propose(body.path, body.before, body.after) })
  ipcMain.handle(IPC.codeApply, (e, raw) => { assertTrusted(e); const body = CodeApply.parse(raw); return s.code.apply(body.id, body.approved) })
  ipcMain.handle(IPC.assistantDesk, (e) => { assertTrusted(e); return s.assistant.desk() })
  ipcMain.handle(IPC.assistantSend, (e, raw) => { assertTrusted(e); return s.assistant.draft(AssistantSummary.parse(raw)) })
  ipcMain.handle(IPC.assistantApprove, (e, raw) => { assertTrusted(e); return s.assistant.approve(AssistantActionId.parse(raw)) })
  ipcMain.handle(IPC.assistantCancel, (e, raw) => { assertTrusted(e); return s.assistant.cancel(AssistantActionId.parse(raw)) })
  ipcMain.handle(IPC.assistantDelete, (e) => { assertTrusted(e); return s.assistant.armDelete() })
  ipcMain.handle(IPC.linksOpen, (e, raw) => {
    assertTrusted(e)
    const url = HttpLink.parse(raw)
    return s.links.open(url)
  })
}

/** Layout note for electron-vite output: out/main, out/preload, out/renderer. */
export function preloadAndHtml(): { preload: string; html: string } {
  return {
    preload: join(__dirname, '../preload/index.js'),
    html: join(__dirname, '../renderer/index.html'),
  }
}
