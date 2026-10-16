/**
 * Screen capture stays off until the user clicks and the OS allows it.
 * The picture stays in memory. Nothing is written unless the user saves.
 */

export type OsScreenPermission = 'granted' | 'denied' | 'restricted' | 'not-determined' | 'unknown'

export type CaptureDeny = 'no-action' | 'denied' | 'needs-permission'

export function mayCaptureScreen(input: {
  explicitAction: boolean
  permission: OsScreenPermission
  platform: string
}): { ok: true } | { ok: false; reason: CaptureDeny } {
  if (!input.explicitAction) return { ok: false, reason: 'no-action' }
  if (input.permission === 'denied' || input.permission === 'restricted') return { ok: false, reason: 'denied' }
  if (input.permission === 'granted') return { ok: true }
  if (input.platform === 'win32' || input.platform === 'linux') return { ok: true }
  return { ok: false, reason: 'needs-permission' }
}

export function captureDenyMessage(reason: CaptureDeny): string {
  if (reason === 'no-action') return 'Screenshot capture starts only from the Capture screenshot button.'
  if (reason === 'denied') return 'Screen recording is off. Allow it for Synap.surf in the system settings, then try again.'
  return 'Allow screen recording for Synap.surf, then click Capture screenshot again.'
}

export async function captureScreen(input: {
  explicitAction: boolean
  permission: OsScreenPermission
  platform: string
  getSources: () => Promise<{ png: Buffer }[]>
}): Promise<{ ok: true; png: Buffer } | { ok: false; message: string }> {
  const gate = mayCaptureScreen(input)
  if (!gate.ok) return { ok: false, message: captureDenyMessage(gate.reason) }
  const sources = await input.getSources()
  const png = sources[0]?.png
  if (!png || png.length < 32) return { ok: false, message: captureDenyMessage('denied') }
  return { ok: true, png }
}

export function shouldWriteScreenshot(userSave: boolean): boolean {
  return userSave === true
}

export async function saveScreenshot(input: {
  userSave: boolean
  png: Buffer
  choosePath: () => Promise<string | null>
  write: (path: string, bytes: Buffer) => void
}): Promise<{ saved: boolean; path?: string }> {
  if (!shouldWriteScreenshot(input.userSave)) return { saved: false }
  const path = await input.choosePath()
  if (!path) return { saved: false }
  input.write(path, input.png)
  return { saved: true, path }
}

const IMAGE_EXT = /\.(png|jpe?g|webp)$/i

/** Dropped or picked paths are read only after the user attached them, and only for images. */
export function imagePathsAllowed(explicitAction: boolean, paths: readonly string[]): string[] {
  if (!explicitAction) return []
  return paths.filter((path) => IMAGE_EXT.test(path))
}
