/**
 * Preload (sandboxed, contextIsolation on). Exposes window.surf — never ipcRenderer itself.
 */
import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import { IPC, type SurfApi, type ChatEvent, type DocumentEvent, type LibraryEvent, type ModelEvent } from '../shared/ipc-contract'

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
    onEvent: (cb) => subscribe<ModelEvent>(IPC.modelsEvent, cb),
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
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    set: (p) => ipcRenderer.invoke(IPC.settingsSet, p),
  },
  updates: {
    check: () => ipcRenderer.invoke(IPC.updatesCheck),
    installOffline: () => ipcRenderer.invoke(IPC.updatesInstallOffline),
  },
  conversations: {
    list: () => ipcRenderer.invoke(IPC.conversationsList),
    open: (id) => ipcRenderer.invoke(IPC.conversationsOpen, id),
    remove: (id) => ipcRenderer.invoke(IPC.conversationsDelete, id),
  },
  webCache: {
    status: () => ipcRenderer.invoke(IPC.webCacheStatus),
    clear: () => ipcRenderer.invoke(IPC.webCacheClear),
  },
  library: {
    pathForFile: (file) => webUtils.getPathForFile(file),
    add: (paths, conversationId, createConversation = false) => ipcRenderer.invoke(IPC.libraryAdd, { paths, conversationId, createConversation }),
    pick: (conversationId, createConversation = false) => ipcRenderer.invoke(IPC.libraryPick, { conversationId, createConversation }),
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
  documents: {
    pick: (title) => ipcRenderer.invoke(IPC.documentsPick, title),
    convert: (input, format) => ipcRenderer.invoke(IPC.documentsConvert, { ...input, format }),
    plan: (input) => ipcRenderer.invoke(IPC.documentsPlan, input),
    export: (input) => ipcRenderer.invoke(IPC.documentsExport, input),
    cancel: () => ipcRenderer.invoke(IPC.documentsCancel),
    onEvent: (cb) => subscribe<DocumentEvent>(IPC.documentsEvent, cb),
  },
  agents: {
    list: () => ipcRenderer.invoke(IPC.agentsList),
  },
  code: {
    search: (query) => ipcRenderer.invoke(IPC.codeSearch, query),
    attach: () => ipcRenderer.invoke(IPC.codeAttach),
    run: (language, code) => ipcRenderer.invoke(IPC.codeRun, { language, code }),
    licenses: () => ipcRenderer.invoke(IPC.codeLicenses),
    propose: (path, before, after) => ipcRenderer.invoke(IPC.codePropose, { path, before, after }),
    apply: (id, approved) => ipcRenderer.invoke(IPC.codeApply, { id, approved }),
  },
  assistant: {
    desk: () => ipcRenderer.invoke(IPC.assistantDesk),
    draft: (summary) => ipcRenderer.invoke(IPC.assistantSend, summary),
    approve: (id) => ipcRenderer.invoke(IPC.assistantApprove, id),
    cancel: (id) => ipcRenderer.invoke(IPC.assistantCancel, id),
    armDelete: () => ipcRenderer.invoke(IPC.assistantDelete),
  },
}

contextBridge.exposeInMainWorld('surf', api)
