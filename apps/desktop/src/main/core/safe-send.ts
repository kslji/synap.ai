/**
 * Renderer sends from the main process.
 * Electron's webContents.send logs through console.error after the window is gone, and a closed
 * terminal turns that log into an uncaught EIO. Callers skip the send instead.
 */

export interface SendTarget {
  isDestroyed(): boolean
  webContents: {
    isDestroyed(): boolean
    isCrashed(): boolean
    send(channel: string, payload?: unknown): void
  }
}

export function safeSend(win: SendTarget | null | undefined, channel: string, payload?: unknown): boolean {
  try {
    if (!win || win.isDestroyed()) return false
    const contents = win.webContents
    if (!contents || contents.isDestroyed() || contents.isCrashed()) return false
    contents.send(channel, payload)
    return true
  } catch {
    return false
  }
}
