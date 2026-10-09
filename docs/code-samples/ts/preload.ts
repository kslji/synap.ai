/**
 * Preload (runs sandboxed, contextIsolation on). Exposes a small, typed API - never ipcRenderer itself.
 * In a sandboxed preload only 'electron' (+ a few Node polyfills) can be required; electron-vite bundles
 * the IPC channel constants in, and `import type` lines disappear at build time.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC, type HarborApi, type ChatEvent } from './ipc-contract.js';

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api: HarborApi = {
  chat: {
    send: (req) => ipcRenderer.invoke(IPC.chatSend, req),
    cancel: (id) => ipcRenderer.invoke(IPC.chatCancel, id),
    onEvent: (cb) => subscribe<ChatEvent>(IPC.chatEvent, cb),
  },
  models: {
    status: () => ipcRenderer.invoke(IPC.modelsStatus),
    download: (id) => ipcRenderer.invoke(IPC.modelsDownload, id),
    onEvent: (cb) => subscribe(IPC.modelsEvent, cb),
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
};

contextBridge.exposeInMainWorld('harbor', api);

declare global {
  interface Window { harbor: HarborApi }
}
