/**
 * Preload (sandboxed, contextIsolation on). Exposes window.surf — never ipcRenderer itself.
 */
import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import { IPC, type SurfApi, type ChatEvent, type CodeProjectStatus, type DocumentEvent, type FileIndexEvent, type LibraryEvent, type ModelEvent, type SetupSnapshot } from '../shared/ipc-contract'

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: SurfApi = {
  chat: {
    send: (req) => ipcRenderer.invoke(IPC.chatSend, req),
    cancel: (id) => ipcRenderer.invoke(IPC.chatCancel, id),
    onEvent: (cb) => subscribe<ChatEvent>(IPC.chatEvent, cb),
  },
  models: {
    status: () => ipcRenderer.invoke(IPC.modelsStatus),
    download: (id) => ipcRenderer.invoke(IPC.modelsDownload, id),
    benchmark: (id) => ipcRenderer.invoke(IPC.modelsBenchmark, id),
    onEvent: (cb) => subscribe<ModelEvent>(IPC.modelsEvent, cb),
  },
  setup: {
    state: () => ipcRenderer.invoke(IPC.setupState),
    start: () => ipcRenderer.invoke(IPC.setupStart),
    choose: (modelId) => ipcRenderer.invoke(IPC.setupChoose, modelId),
    useFile: (modelId) => ipcRenderer.invoke(IPC.setupUseFile, modelId),
    repair: () => ipcRenderer.invoke(IPC.setupRepair),
    pause: () => ipcRenderer.invoke(IPC.setupPause),
    resume: () => ipcRenderer.invoke(IPC.setupResume),
    retry: () => ipcRenderer.invoke(IPC.setupRetry),
    onEvent: (cb) => subscribe<SetupSnapshot>(IPC.setupEvent, cb),
  },
  packs: {
    list: () => ipcRenderer.invoke(IPC.packsList),
    sync: () => ipcRenderer.invoke(IPC.packsSync),
    remove: (packId) => ipcRenderer.invoke(IPC.packsRemove, packId),
    importFromFile: () => ipcRenderer.invoke(IPC.packsImportFile),
  },
  auth: {
    status: () => ipcRenderer.invoke(IPC.authStatus),
    start: (email) => ipcRenderer.invoke(IPC.authStart, { email }),
    verify: (email, code) => ipcRenderer.invoke(IPC.authVerify, { email, code }),
    signOut: () => ipcRenderer.invoke(IPC.authSignOut),
    devices: () => ipcRenderer.invoke(IPC.authDevices),
    revoke: (deviceId) => ipcRenderer.invoke(IPC.authRevoke, deviceId),
  },
  licence: {
    status: () => ipcRenderer.invoke(IPC.licenceStatus),
    activate: (key) => ipcRenderer.invoke(IPC.licenceActivate, key ? { key } : {}),
    deactivate: (activationId) => ipcRenderer.invoke(IPC.licenceDeactivate, activationId ?? null),
    devices: () => ipcRenderer.invoke(IPC.licenceDevices),
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    set: (p) => ipcRenderer.invoke(IPC.settingsSet, p),
  },
  updates: {
    check: () => ipcRenderer.invoke(IPC.updatesCheck),
    apply: () => ipcRenderer.invoke(IPC.updatesApply),
    installOffline: () => ipcRenderer.invoke(IPC.updatesInstallOffline),
  },
  conversations: {
    list: () => ipcRenderer.invoke(IPC.conversationsList),
    open: (id) => ipcRenderer.invoke(IPC.conversationsOpen, id),
    remove: (id) => ipcRenderer.invoke(IPC.conversationsDelete, id),
  },
  usage: {
    get: () => ipcRenderer.invoke(IPC.usageGet),
    reset: () => ipcRenderer.invoke(IPC.usageReset),
    csv: () => ipcRenderer.invoke(IPC.usageCsv),
  },
  storage: {
    report: () => ipcRenderer.invoke(IPC.storageReport),
    clear: (req) => ipcRenderer.invoke(IPC.storageClear, req),
    open: (category) => ipcRenderer.invoke(IPC.storageOpen, category),
  },
  library: {
    pathForFile: (file) => webUtils.getPathForFile(file),
    add: (paths, conversationId, createConversation = false, agentId = 'code') => ipcRenderer.invoke(IPC.libraryAdd, { paths, conversationId, createConversation, agentId }),
    pick: (conversationId, createConversation = false, agentId = 'code') => ipcRenderer.invoke(IPC.libraryPick, { conversationId, createConversation, agentId }),
    list: () => ipcRenderer.invoke(IPC.libraryList),
    retry: (jobId) => ipcRenderer.invoke(IPC.libraryRetry, jobId),
    cancel: (jobId) => ipcRenderer.invoke(IPC.libraryCancel, jobId),
    remove: (attachmentId) => ipcRenderer.invoke(IPC.libraryDelete, attachmentId),
    preview: (ref) => ipcRenderer.invoke(IPC.libraryPreview, ref),
    onEvent: (cb) => subscribe<LibraryEvent>(IPC.libraryEvent, cb),
  },
  links: {
    open: (url) => ipcRenderer.invoke(IPC.linksOpen, url),
  },
  codeAgent: {
    root: () => ipcRenderer.invoke(IPC.codeAgentRoot),
    pick: () => ipcRenderer.invoke(IPC.codeAgentPick),
    decide: (req) => ipcRenderer.invoke(IPC.codeAgentDecide, req),
    revise: (req) => ipcRenderer.invoke(IPC.codeAgentRevise, req),
    undo: (req) => ipcRenderer.invoke(IPC.codeAgentUndo, req),
    mode: () => ipcRenderer.invoke(IPC.codeAgentMode),
    setMode: (req) => ipcRenderer.invoke(IPC.codeAgentSetMode, req),
  },
  documents: {
    pick: (title) => ipcRenderer.invoke(IPC.documentsPick, title),
    convert: (input, format) => ipcRenderer.invoke(IPC.documentsConvert, { ...input, format }),
    plan: (input) => ipcRenderer.invoke(IPC.documentsPlan, input),
    export: (input) => ipcRenderer.invoke(IPC.documentsExport, input),
    cancel: () => ipcRenderer.invoke(IPC.documentsCancel),
    onEvent: (cb) => subscribe<DocumentEvent>(IPC.documentsEvent, cb),
  },
  code: {
    pick: () => ipcRenderer.invoke(IPC.codePick),
    status: () => ipcRenderer.invoke(IPC.codeStatus),
    storage: () => ipcRenderer.invoke(IPC.codeStorage),
    onEvent: (cb) => subscribe<CodeProjectStatus>(IPC.codeEvent, cb),
  },
codeIde: {
    launch: (root: string) => ipcRenderer.invoke(IPC.codeIdeLaunch, root),
  },
  codeComplete: {
    suggest: (req) => ipcRenderer.invoke(IPC.codeCompleteSuggest, req),
    files: () => ipcRenderer.invoke(IPC.codeCompleteFiles),
    read: (path) => ipcRenderer.invoke(IPC.codeCompleteRead, { path }),
    save: (path, text) => ipcRenderer.invoke(IPC.codeCompleteSave, { path, text }),
  },
  codeVision: {
    capture: (req) => ipcRenderer.invoke(IPC.codeVisionCapture, req),
    save: (req) => ipcRenderer.invoke(IPC.codeVisionSave, req),
  },
  files: {
    list: () => ipcRenderer.invoke(IPC.filesList),
    suggestions: () => ipcRenderer.invoke(IPC.filesSuggest),
    pick: (defaultPath) => ipcRenderer.invoke(IPC.filesPick, defaultPath),
    grant: (req) => ipcRenderer.invoke(IPC.filesGrant, req),
    decide: (req) => ipcRenderer.invoke(IPC.filesDecide, req),
    revoke: (id) => ipcRenderer.invoke(IPC.filesRevoke, id),
    open: (path) => ipcRenderer.invoke(IPC.filesOpen, path),
    openSettings: (kind) => ipcRenderer.invoke(IPC.filesSettings, kind),
    limits: () => ipcRenderer.invoke(IPC.filesLimits),
    setLimits: (req) => ipcRenderer.invoke(IPC.filesSetLimits, req),
    pause: (id) => ipcRenderer.invoke(IPC.filesPause, id),
    resume: (id) => ipcRenderer.invoke(IPC.filesResume, id),
    onEvent: (cb) => subscribe<FileIndexEvent>(IPC.filesEvent, cb),
  },
  speech: {
    speak: (text) => ipcRenderer.invoke(IPC.speechSpeak, text),
    stop: () => ipcRenderer.invoke(IPC.speechStop),
    prepare: () => ipcRenderer.invoke(IPC.speechPrepare),
    transcribe: (req) => ipcRenderer.invoke(IPC.speechTranscribe, req),
  },
}

contextBridge.exposeInMainWorld('surf', api)
