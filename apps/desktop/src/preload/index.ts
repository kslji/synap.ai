/**
 * Preload (sandboxed, contextIsolation on). Exposes window.surf — never ipcRenderer itself.
 */
import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import { IPC, type SurfApi, type ChatEvent, type LibraryEvent, type ModelEvent } from '../shared/ipc-contract'

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
    importFromFile: () => ipcRenderer.invoke(IPC.packsImportFile),
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
}

contextBridge.exposeInMainWorld('surf', api)
