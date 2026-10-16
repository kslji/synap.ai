/**
 * Screen capture runs only after an explicit user action and an OS permission check.
 * The bytes stay in memory. Nothing is written unless the user saves.
 */
export type OsScreenPermission = 'granted' | 'denied' | 'prompt' | 'unknown'

export function captureAllowed(input: { explicitAction: boolean; permission: OsScreenPermission }): { ok: true } | { ok: false; reason: 'no-action' | 'permission' } {
  if (!input.explicitAction) return { ok: false, reason: 'no-action' }
  if (input.permission !== 'granted') return { ok: false, reason: 'permission' }
  return { ok: true }
}

export interface MemoryShot {
  bytes: Buffer
  mime: 'image/png'
  savedPath: null
}

export function memoryShot(bytes: Buffer): MemoryShot {
  return { bytes, mime: 'image/png', savedPath: null }
}

export function saveAllowed(explicitAction: boolean): boolean {
  return explicitAction === true
}

/**
 * macOS must be granted (or the ask must succeed) before grab runs.
 * Windows and Linux have no separate screen flag. desktopCapturer is the OS prompt,
 * and it runs only after the button click. A denied status still refuses.
 */
export async function captureAfterConsent<T>(input: {
  explicitAction: boolean
  platform: string
  permission: OsScreenPermission
  requestPermission?: () => Promise<boolean>
  grab: () => Promise<T>
}): Promise<T> {
  if (!input.explicitAction) {
    throw new Error('Screenshot capture needs an explicit action.')
  }
  if (input.permission === 'denied') {
    throw new Error('Screenshot capture needs permission from the operating system.')
  }
  let permission = input.permission
  if (permission !== 'granted') {
    if (input.platform === 'darwin') {
      const ok = input.requestPermission ? await input.requestPermission() : false
      if (!ok) throw new Error('Screenshot capture needs permission from the operating system.')
      permission = 'granted'
    } else {
      permission = 'granted'
    }
  }
  const gate = captureAllowed({ explicitAction: true, permission })
  if (!gate.ok) throw new Error('Screenshot capture needs permission from the operating system.')
  return input.grab()
}
