/**
 * Hidden window for pages whose static HTML has almost no article text.
 * Sandboxed. No Node in the page. Destroyed as soon as the HTML is copied.
 */
import { BrowserWindow } from 'electron'

export async function renderJsPage(url: string, timeoutMs = 6000): Promise<string | null> {
  const win = new BrowserWindow({
    show: false,
    width: 800,
    height: 600,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      javascript: true,
      partition: 'search:reader',
    },
  })
  try {
    await win.loadURL(url)
    const html = await Promise.race([
      win.webContents.executeJavaScript('document.documentElement ? document.documentElement.outerHTML : ""'),
      new Promise<string>((_, reject) => setTimeout(() => reject(new Error('js page timeout')), timeoutMs)),
    ])
    return typeof html === 'string' ? html.slice(0, 1_000_000) : null
  } catch {
    return null
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}
