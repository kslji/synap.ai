/**
 * Secure window + IPC wiring (main process). Checklist from https://www.electronjs.org/docs/latest/tutorial/security
 *  - contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true
 *  - strict Content-Security-Policy (meta tag in index.html + header for the dev server)
 *  - no navigation / no new windows; external links open in the OS browser (https only)
 *  - every IPC call validates the sender frame and the payload
 */
import { app, BrowserWindow, ipcMain, session, shell, type IpcMainInvokeEvent } from 'electron';
import { join } from 'node:path';
import { IPC, type SettingsPatch } from './ipc-contract.js';
import { ChatSendReq, SettingsPatch as SettingsPatchSchema } from './ipc-schemas.js';

// Renderer may only talk to itself. llama-server etc. are reached by MAIN, never by the renderer.
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'", // React inline styles; drop if you use CSS files only
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const DEV_URL = process.env['ELECTRON_RENDERER_URL']; // set by electron-vite in dev

export function createMainWindow(preloadPath: string, rendererHtml: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: true,
    },
  });

  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [DEV_URL ? CSP.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'") : CSP] } });
  });
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'media')); // mic for voice only

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => { if (url !== win.webContents.getURL()) e.preventDefault(); });
  win.once('ready-to-show', () => win.show());

  if (DEV_URL && !app.isPackaged) void win.loadURL(DEV_URL);
  else void win.loadFile(rendererHtml);
  return win;
}

/** Only accept IPC from our own top-level page. */
function assertTrusted(e: IpcMainInvokeEvent): void {
  const url = e.senderFrame?.url ?? '';
  const ok = url.startsWith('file://') || (!!DEV_URL && url.startsWith(DEV_URL));
  if (!ok || e.senderFrame !== e.sender.mainFrame) throw new Error('untrusted IPC sender');
}

export interface Services {
  chat: { send(req: ReturnType<typeof ChatSendReq.parse>, win: BrowserWindow): Promise<{ conversationId: string; messageId: string }>; cancel(id: string): void };
  settings: { get(): Promise<unknown>; set(p: SettingsPatch): Promise<void> };
}

export function registerIpc(win: BrowserWindow, s: Services): void {
  ipcMain.handle(IPC.chatSend, (e, raw) => { assertTrusted(e); return s.chat.send(ChatSendReq.parse(raw), win); });
  ipcMain.handle(IPC.chatCancel, (e, id) => { assertTrusted(e); if (typeof id === 'string') s.chat.cancel(id); });
  ipcMain.handle(IPC.settingsGet, (e) => { assertTrusted(e); return s.settings.get(); });
  ipcMain.handle(IPC.settingsSet, (e, raw) => { assertTrusted(e); return s.settings.set(SettingsPatchSchema.parse(raw)); });
  // ... models, packs, updates follow the same pattern
}

/** Typical main/index.ts wiring with electron-vite's output layout (out/main, out/preload, out/renderer). */
export function bootstrap(services: Services): void {
  app.enableSandbox(); // sandbox ALL renderers, even ones we forget to configure
  if (!app.requestSingleInstanceLock()) { app.quit(); return; }
  void app.whenReady().then(() => {
    const win = createMainWindow(join(__dirname, '../preload/index.js'), join(__dirname, '../renderer/index.html'));
    registerIpc(win, services);
  });
}
