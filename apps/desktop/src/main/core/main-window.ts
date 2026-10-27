/**
 * Secure window + IPC wiring (main process).
 * contextIsolation, no nodeIntegration, sandbox, strict CSP, trusted sender check, zod on every payload.
 */
import { app, BrowserWindow, ipcMain, session, shell, type IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'
import { z } from 'zod'
import { IPC, type AuthStatus, type BenchmarkResult, type ChatConsentState, type ChunkPreview, type CodeAgentDecideReq as CodeAgentDecide, type CodeAgentModeState, type CodeAgentReviseReq as CodeAgentRevise, type CodeAgentRoot, type CodeAgentSetModeReq as CodeAgentSetMode, type CodeAgentSetModeResult, type CodeAgentUndoReq as CodeAgentUndo, type CodeCompleteReq, type CodeCompleteResult, type CodeEditorFile, type CodeEditorText, type CodeProjectStatus, type CodeStorageUsage, type CodeVisionCaptureResult, type CodeVisionSaveResult, type ConversationSummary, type DeviceInfo, type DocumentResult, type FileDecideReq, type FileFolderGrant, type FileGrantReq, type FileIndexLimits, type FileIndexLimitsReq, type FileOsDenialKind, type FileSuggestFolder, type FillPlan, type FillRow, type LibraryFile, type LicenceDevice, type LicenceStatus, type ModelStatus, type OnlineBalance, type OnlineModelRow, type PackRow, type SettingsPatch, type StorageCategoryId, type StorageReport, type StoredMessage, type UpdateOffer, type UsageReport } from './ipc-contract.js'
import type { ExportFormat } from './ipc-contract.js'
import { AttachmentId, ChatConsentGet, ChatConsentSet, ChatSendReq, CodeAgentDecideReq, CodeAgentReviseReq, CodeAgentSetModeReq, CodeAgentUndoReq, CodeCompleteReq as CodeCompleteBody, CodeFilePath, CodeFileSave, CodeVisionCapture, CodeVisionSave, ConversationId, DeviceId, DocumentConvert, DocumentExport, DocumentPlan, EmailBody, FileDecideReq as FileDecideBody, FileGrantReq as FileGrantBody, FileLimitsReq, FileOsKind, HttpLink, JobId, LibraryAdd, LibraryPick, LibraryPreview, LicenceActivateBody, LicenceActivationId, ModelId, OtpVerifyBody, PackId, SettingsPatch as SettingsPatchSchema, SpeechWav, StorageCategoryId as StorageCategorySchema, StorageClearReq, type ParsedChat } from './ipc-schemas.js'
import { surfEnv } from './surf-env.js'
import { NO_VOICE, startSpeak, stopSpeak } from './speech.js'

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
  const e2e = Boolean(surfEnv('E2E_DIR'))
  const win = new BrowserWindow({
    width: e2e ? 1100 : 1180,
    height: e2e ? 720 : 780,
    minWidth: 880,
    minHeight: 600,
    useContentSize: e2e,
    show: false,
    title: 'Synap.surf',
    backgroundColor: '#fafafa',
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: !e2e,
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
  /** Move a verified local model file into the models folder. */
  adoptLocal(): Promise<void>
  /** Read synap://setup?model=&file= and adopt that file when the path checks out. */
  applySetupLink(raw: string): string | null
  chat: {
    send(req: ParsedChat, win: BrowserWindow): Promise<{ conversationId: string; messageId: string }>
    cancel(id: string): void
    /** Item 12: this chat's Online-context consent, and the change of it. */
    consent(conversationId: string): ChatConsentState
    setConsent(req: { conversationId: string; allowed: boolean }): ChatConsentState
    /** Tier-aware online model list for the chat picker (ADR 0008). */
    onlineModels(): Promise<OnlineModelRow[]>
    /** Wallet + purchase tier, or null when the gateway is unreachable/signed out. */
    onlineBalance(): Promise<OnlineBalance | null>
    /** Remember the picked online model. */
    setOnlineModel(modelId: string): Promise<void>
    /** Open the top-up page for a locked model / empty wallet. */
    openTopUp(): Promise<void>
  }
  models: {
    status(): Promise<ModelStatus>
    download(modelId: string, win: BrowserWindow): Promise<void>
    cancel(win: BrowserWindow): void
    importLocal(path: string | null, win: BrowserWindow): Promise<{ id: string } | null>
    benchmark(modelId: string): Promise<BenchmarkResult>
    remove(modelId: string, win: BrowserWindow): Promise<{ id: string; freedBytes: number }>
  }
  setup: {
    state(): Promise<import('../../shared/setup-choice.js').SetupSnapshot>
    start(): Promise<void>
    choose(modelId: string): Promise<void>
    useFile(modelId: string): Promise<void>
    pause(): void
    resume(): Promise<void>
    retry(): Promise<void>
    repair(): Promise<void>
  }
  conversations: {
    list(): Promise<ConversationSummary[]>
    open(id: string): Promise<{ id: string; messages: StoredMessage[] }>
    remove(id: string): Promise<void>
  }
  usage: {
    get(): Promise<UsageReport>
    reset(): Promise<UsageReport>
    csv(): Promise<string>
  }
  storage: {
    report(): Promise<StorageReport>
    clear(category: StorageCategoryId, itemId?: string): Promise<StorageReport>
    open(category: StorageCategoryId): Promise<void>
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
  licence: {
    status(): Promise<LicenceStatus>
    activate(key?: string): Promise<LicenceStatus>
    deactivate(activationId?: string): Promise<LicenceStatus>
    devices(): Promise<LicenceDevice[]>
  }
  settings: {
    get(): Promise<Required<SettingsPatch>>
    set(p: SettingsPatch): Promise<void>
    isOfflineOnly(): boolean
  }
  updates: {
    check(): Promise<UpdateOffer | null>
    apply(): Promise<void>
    installOffline(win: BrowserWindow): Promise<boolean>
  }
  library: {
    add(paths: string[], conversationId: string | null, createConversation: boolean, agentId: string, win: BrowserWindow): Promise<{ conversationId: string | null; files: LibraryFile[] }>
    pick(conversationId: string | null, createConversation: boolean, agentId: string, win: BrowserWindow): Promise<{ conversationId: string | null; files: LibraryFile[] }>
    list(): Promise<LibraryFile[]>
    retry(jobId: string): Promise<void>
    cancel(jobId: string): Promise<void>
    remove(attachmentId: string): Promise<void>
    preview(ref: { chunkId?: number; attachmentId?: string }): Promise<ChunkPreview | null>
  }
  links: {
    open(url: string): Promise<void>
  }
  codeAgent: {
    root(): Promise<CodeAgentRoot>
    pick(win: BrowserWindow): Promise<CodeAgentRoot>
    decide(req: CodeAgentDecide): Promise<{ ok: boolean }>
    revise(req: CodeAgentRevise): Promise<{ ok: boolean }>
    undo(req: CodeAgentUndo): Promise<{ ok: boolean }>
    mode(): Promise<CodeAgentModeState>
    setMode(req: CodeAgentSetMode): Promise<CodeAgentSetModeResult>
  }
  documents: {
    pick(win: BrowserWindow, title: string): Promise<string | null>
    convert(win: BrowserWindow, input: { path?: string; attachmentId?: string }, format: ExportFormat): Promise<DocumentResult | null>
    plan(input: { templatePath?: string; templateAttachmentId?: string; sourcePath?: string; sourceAttachmentId?: string }): Promise<FillPlan>
    export(win: BrowserWindow, input: { path?: string; attachmentId?: string }, rows: FillRow[], format: ExportFormat | 'same', highlight: boolean): Promise<DocumentResult | null>
    cancel(): void
  }
  code: {
    pick(win: BrowserWindow): Promise<CodeProjectStatus | null>
    status(): Promise<CodeProjectStatus | null>
    storage(): Promise<CodeStorageUsage>
  }
  codeIde: {
    launch(root: string): Promise<{ pid: number }>
  }
  codeComplete: {
    suggest(req: CodeCompleteReq): Promise<CodeCompleteResult>
    files(): Promise<CodeEditorFile[]>
    read(path: string): Promise<CodeEditorText>
    save(path: string, text: string): Promise<{ path: string }>
  }
  codeVision: {
    capture(): Promise<CodeVisionCaptureResult>
    save(base64: string, mime: 'image/png' | 'image/jpeg' | 'image/webp', win: BrowserWindow): Promise<CodeVisionSaveResult>
  }
  files: {
    list(): Promise<FileFolderGrant[]>
    suggestions(): Promise<FileSuggestFolder[]>
    pick(win: BrowserWindow, defaultPath: string | null): Promise<string[]>
    grant(req: FileGrantReq): Promise<FileFolderGrant>
    decide(req: FileDecideReq): Promise<void>
    revoke(id: string): Promise<void>
    open(path: string): Promise<void>
    openSettings(kind: FileOsDenialKind): Promise<void>
    limits(): Promise<FileIndexLimits>
    setLimits(req: FileIndexLimitsReq): Promise<FileIndexLimits>
    pause(id: string): Promise<void>
    resume(id: string): Promise<void>
  }
  speech: {
    prepare(): Promise<{ status: 'granted' | 'denied' | 'prompt' | 'unknown' }>
    transcribe(wav: Buffer): Promise<{ ok: boolean; text: string; note: string }>
  }
  lifecycle: {
    releaseWindow(): void
  }
}

const liveIpc = new Set<string>()

function handle(channel: string, listener: Parameters<typeof ipcMain.handle>[1]): void {
  liveIpc.add(channel)
  ipcMain.handle(channel, listener)
}

export function unregisterIpc(): void {
  for (const channel of liveIpc) ipcMain.removeHandler(channel)
  liveIpc.clear()
}

export function registerIpc(win: BrowserWindow, s: Services): void {
  handle(IPC.chatSend, (e, raw) => { assertTrusted(e); return s.chat.send(ChatSendReq.parse(raw), win) })
  handle(IPC.chatCancel, (e, id) => { assertTrusted(e); if (typeof id === 'string') s.chat.cancel(id) })
  handle(IPC.chatConsentGet, (e, raw) => { assertTrusted(e); return s.chat.consent(ChatConsentGet.parse(raw).conversationId) })
  handle(IPC.chatConsentSet, (e, raw) => { assertTrusted(e); return s.chat.setConsent(ChatConsentSet.parse(raw)) })
  handle(IPC.chatOnlineModels, (e) => { assertTrusted(e); return s.chat.onlineModels() })
  handle(IPC.chatOnlineBalance, (e) => { assertTrusted(e); return s.chat.onlineBalance() })
  handle(IPC.chatSetOnlineModel, (e, raw) => { assertTrusted(e); return s.chat.setOnlineModel(z.string().max(120).parse(raw)) })
  handle(IPC.chatOpenTopUp, (e) => { assertTrusted(e); return s.chat.openTopUp() })
  handle(IPC.settingsGet, (e) => { assertTrusted(e); return s.settings.get() })
  handle(IPC.settingsSet, (e, raw) => { assertTrusted(e); return s.settings.set(SettingsPatchSchema.parse(raw)) })
  handle(IPC.modelsStatus, (e) => { assertTrusted(e); return s.models.status() })
  handle(IPC.modelsDownload, (e, raw) => { assertTrusted(e); return s.models.download(ModelId.parse(raw), win) })
  handle(IPC.modelsCancel, (e) => { assertTrusted(e); s.models.cancel(win) })
  handle(IPC.modelsImportLocal, (e, raw) => {
    assertTrusted(e)
    const path = raw == null || raw === '' ? null : z.string().min(1).max(4096).parse(raw)
    return s.models.importLocal(path, win)
  })
  handle(IPC.modelsBenchmark, (e, raw) => { assertTrusted(e); return s.models.benchmark(ModelId.parse(raw)) })
  handle(IPC.modelsRemove, (e, raw) => { assertTrusted(e); return s.models.remove(ModelId.parse(raw), win) })
  handle(IPC.setupState, (e) => { assertTrusted(e); return s.setup.state() })
  handle(IPC.setupStart, (e) => { assertTrusted(e); return s.setup.start() })
  handle(IPC.setupChoose, (e, raw) => { assertTrusted(e); return s.setup.choose(ModelId.parse(raw)) })
  handle(IPC.setupUseFile, (e, raw) => { assertTrusted(e); return s.setup.useFile(ModelId.parse(raw)) })
  handle(IPC.setupRepair, (e) => { assertTrusted(e); return s.setup.repair() })
  handle(IPC.setupPause, (e) => { assertTrusted(e); s.setup.pause() })
  handle(IPC.setupResume, (e) => { assertTrusted(e); return s.setup.resume() })
  handle(IPC.setupRetry, (e) => { assertTrusted(e); return s.setup.retry() })
  handle(IPC.conversationsList, (e) => { assertTrusted(e); return s.conversations.list() })
  handle(IPC.conversationsOpen, (e, raw) => { assertTrusted(e); return s.conversations.open(ConversationId.parse(raw)) })
  handle(IPC.conversationsDelete, (e, raw) => { assertTrusted(e); return s.conversations.remove(ConversationId.parse(raw)) })
  handle(IPC.usageGet, (e) => { assertTrusted(e); return s.usage.get() })
  handle(IPC.usageReset, (e) => { assertTrusted(e); return s.usage.reset() })
  handle(IPC.usageCsv, (e) => { assertTrusted(e); return s.usage.csv() })
  handle(IPC.storageReport, (e) => { assertTrusted(e); return s.storage.report() })
  handle(IPC.storageClear, (e, raw) => {
    assertTrusted(e)
    const body = StorageClearReq.parse(raw)
    return s.storage.clear(body.category, body.itemId)
  })
  handle(IPC.storageOpen, (e, raw) => { assertTrusted(e); return s.storage.open(StorageCategorySchema.parse(raw)) })
  handle(IPC.packsList, (e) => { assertTrusted(e); return s.packs.list() })
  handle(IPC.packsSync, (e) => { assertTrusted(e); return s.packs.sync() })
  handle(IPC.packsRemove, (e, raw) => { assertTrusted(e); return s.packs.remove(PackId.parse(raw)) })
  handle(IPC.packsImportFile, (e) => { assertTrusted(e); return s.packs.importFromFile(win) })
  handle(IPC.authStatus, (e) => { assertTrusted(e); return s.auth.status() })
  handle(IPC.authStart, (e, raw) => { assertTrusted(e); return s.auth.start(EmailBody.parse(raw).email) })
  handle(IPC.authVerify, (e, raw) => { assertTrusted(e); const body = OtpVerifyBody.parse(raw); return s.auth.verify(body.email, body.code) })
  handle(IPC.authSignOut, (e) => { assertTrusted(e); return s.auth.signOut() })
  handle(IPC.authDevices, (e) => { assertTrusted(e); return s.auth.devices() })
  handle(IPC.authRevoke, (e, raw) => { assertTrusted(e); return s.auth.revoke(DeviceId.parse(raw)) })
  handle(IPC.licenceStatus, (e) => { assertTrusted(e); return s.licence.status() })
  handle(IPC.licenceActivate, (e, raw) => { assertTrusted(e); return s.licence.activate(LicenceActivateBody.parse(raw ?? {}).key) })
  handle(IPC.licenceDeactivate, (e, raw) => { assertTrusted(e); return s.licence.deactivate(LicenceActivationId.parse(raw ?? null) ?? undefined) })
  handle(IPC.licenceDevices, (e) => { assertTrusted(e); return s.licence.devices() })
  handle(IPC.updatesCheck, (e) => { assertTrusted(e); return s.updates.check() })
  handle(IPC.updatesApply, (e) => { assertTrusted(e); return s.updates.apply() })
  handle(IPC.updatesInstallOffline, (e) => { assertTrusted(e); return s.updates.installOffline(win) })
  handle(IPC.libraryAdd, (e, raw) => {
    assertTrusted(e)
    const body = LibraryAdd.parse(raw)
    return s.library.add(body.paths, body.conversationId, body.createConversation, body.agentId, win)
  })
  handle(IPC.libraryPick, (e, raw) => {
    assertTrusted(e)
    const body = LibraryPick.parse(raw ?? { conversationId: null })
    return s.library.pick(body.conversationId, body.createConversation, body.agentId, win)
  })
  handle(IPC.libraryList, (e) => { assertTrusted(e); return s.library.list() })
  handle(IPC.libraryRetry, (e, raw) => { assertTrusted(e); return s.library.retry(JobId.parse(raw)) })
  handle(IPC.libraryCancel, (e, raw) => { assertTrusted(e); return s.library.cancel(JobId.parse(raw)) })
  handle(IPC.libraryDelete, (e, raw) => { assertTrusted(e); return s.library.remove(AttachmentId.parse(raw)) })
  handle(IPC.libraryPreview, (e, raw) => { assertTrusted(e); return s.library.preview(LibraryPreview.parse(raw)) })
  handle(IPC.documentsPick, (e, raw) => {
    assertTrusted(e)
    return s.documents.pick(win, z.string().max(80).parse(raw))
  })
  handle(IPC.documentsConvert, (e, raw) => {
    assertTrusted(e)
    const body = DocumentConvert.parse(raw)
    return s.documents.convert(win, { path: body.path, attachmentId: body.attachmentId }, body.format)
  })
  handle(IPC.documentsPlan, (e, raw) => {
    assertTrusted(e)
    const body = DocumentPlan.parse(raw)
    return s.documents.plan(body)
  })
  handle(IPC.documentsExport, (e, raw) => {
    assertTrusted(e)
    const body = DocumentExport.parse(raw)
    return s.documents.export(win, { path: body.templatePath, attachmentId: body.templateAttachmentId }, body.rows, body.format, body.highlight)
  })
  handle(IPC.documentsCancel, (e) => { assertTrusted(e); s.documents.cancel() })
  handle(IPC.codePick, (e) => { assertTrusted(e); return s.code.pick(win) })
  handle(IPC.codeIdeLaunch, (e, root) => { assertTrusted(e); return s.codeIde.launch(z.string().min(1).max(4096).parse(root)) })
  handle(IPC.codeStatus, (e) => { assertTrusted(e); return s.code.status() })
  handle(IPC.codeStorage, (e) => { assertTrusted(e); return s.code.storage() })
  handle(IPC.linksOpen, (e, raw) => {
    assertTrusted(e)
    const url = HttpLink.parse(raw)
    return s.links.open(url)
  })
  handle(IPC.codeAgentRoot, (e) => { assertTrusted(e); return s.codeAgent.root() })
  handle(IPC.codeAgentPick, (e) => { assertTrusted(e); return s.codeAgent.pick(win) })
  handle(IPC.codeAgentDecide, (e, raw) => { assertTrusted(e); return s.codeAgent.decide(CodeAgentDecideReq.parse(raw)) })
  handle(IPC.codeAgentRevise, (e, raw) => { assertTrusted(e); return s.codeAgent.revise(CodeAgentReviseReq.parse(raw)) })
  handle(IPC.codeAgentUndo, (e, raw) => { assertTrusted(e); return s.codeAgent.undo(CodeAgentUndoReq.parse(raw)) })
  handle(IPC.codeAgentMode, (e) => { assertTrusted(e); return s.codeAgent.mode() })
  handle(IPC.codeAgentSetMode, (e, raw) => { assertTrusted(e); return s.codeAgent.setMode(CodeAgentSetModeReq.parse(raw)) })
  handle(IPC.codeCompleteSuggest, (e, raw) => { assertTrusted(e); return s.codeComplete.suggest(CodeCompleteBody.parse(raw)) })
  handle(IPC.codeCompleteFiles, (e) => { assertTrusted(e); return s.codeComplete.files() })
  handle(IPC.codeCompleteRead, (e, raw) => { assertTrusted(e); return s.codeComplete.read(CodeFilePath.parse(raw).path) })
  handle(IPC.codeCompleteSave, (e, raw) => {
    assertTrusted(e)
    const body = CodeFileSave.parse(raw)
    return s.codeComplete.save(body.path, body.text)
  })
  handle(IPC.codeVisionCapture, (e, raw) => {
    assertTrusted(e)
    CodeVisionCapture.parse(raw)
    return s.codeVision.capture()
  })
  handle(IPC.codeVisionSave, (e, raw) => {
    assertTrusted(e)
    const body = CodeVisionSave.parse(raw)
    return s.codeVision.save(body.base64, body.mime, win)
  })
  handle(IPC.filesList, (e) => { assertTrusted(e); return s.files.list() })
  handle(IPC.filesSuggest, (e) => { assertTrusted(e); return s.files.suggestions() })
  handle(IPC.filesPick, (e, raw) => {
    assertTrusted(e)
    const path = raw == null || raw === '' ? null : z.string().min(1).max(4096).parse(raw)
    return s.files.pick(win, path)
  })
  handle(IPC.filesGrant, (e, raw) => { assertTrusted(e); return s.files.grant(FileGrantBody.parse(raw)) })
  handle(IPC.filesDecide, (e, raw) => { assertTrusted(e); return s.files.decide(FileDecideBody.parse(raw)) })
  handle(IPC.filesRevoke, (e, raw) => { assertTrusted(e); return s.files.revoke(z.string().min(1).max(80).parse(raw)) })
  handle(IPC.filesOpen, (e, raw) => { assertTrusted(e); return s.files.open(z.string().min(1).max(4096).parse(raw)) })
  handle(IPC.filesSettings, (e, raw) => { assertTrusted(e); return s.files.openSettings(FileOsKind.parse(raw)) })
  handle(IPC.filesLimits, (e) => { assertTrusted(e); return s.files.limits() })
  handle(IPC.filesSetLimits, (e, raw) => { assertTrusted(e); return s.files.setLimits(FileLimitsReq.parse(raw)) })
  handle(IPC.filesPause, (e, raw) => { assertTrusted(e); return s.files.pause(z.string().min(1).max(80).parse(raw)) })
  handle(IPC.filesResume, (e, raw) => { assertTrusted(e); return s.files.resume(z.string().min(1).max(80).parse(raw)) })
  handle(IPC.speechSpeak, async (e, raw) => {
    assertTrusted(e)
    const text = z.string().max(8000).parse(raw)
    const ok = await startSpeak(text)
    return { ok, note: ok ? '' : NO_VOICE }
  })
  handle(IPC.speechStop, (e) => {
    assertTrusted(e)
    stopSpeak()
  })
  handle(IPC.speechPrepare, (e) => {
    assertTrusted(e)
    return s.speech.prepare()
  })
  handle(IPC.speechTranscribe, (e, raw) => {
    assertTrusted(e)
    const body = SpeechWav.parse(raw)
    return s.speech.transcribe(Buffer.from(body.wavBase64, 'base64'))
  })
}

/** Layout note for electron-vite output: out/main, out/preload, out/renderer. */
export function preloadAndHtml(): { preload: string; html: string } {
  return {
    preload: join(__dirname, '../preload/index.js'),
    html: join(__dirname, '../renderer/index.html'),
  }
}
