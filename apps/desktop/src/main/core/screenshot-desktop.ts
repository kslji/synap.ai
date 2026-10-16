/**
 * Desktop screenshot capture. desktopCapturer runs only after a click and an OS permission check.
 * The PNG stays in the returned buffer.
 */
import { desktopCapturer, systemPreferences } from 'electron'
import { captureScreen, type OsScreenPermission } from './vision-capture.js'

export function readScreenPermission(): OsScreenPermission {
  if (process.platform !== 'darwin') return 'unknown'
  try {
    const status = systemPreferences.getMediaAccessStatus('screen')
    if (status === 'granted' || status === 'denied' || status === 'restricted' || status === 'not-determined' || status === 'unknown') {
      return status
    }
  } catch { /* this build has no screen-recording status */ }
  return 'unknown'
}

async function askScreenPermission(): Promise<boolean> {
  if (process.platform !== 'darwin') return true
  try {
    const ask = systemPreferences.askForMediaAccess as (kind: 'microphone' | 'camera' | 'screen') => Promise<boolean>
    return await ask('screen')
  } catch {
    return false
  }
}

export async function captureUserScreenshot(explicitAction: boolean): Promise<{ ok: true; png: Buffer } | { ok: false; message: string }> {
  if (!explicitAction) {
    return captureScreen({
      explicitAction: false,
      permission: 'granted',
      platform: process.platform,
      getSources: async () => [],
    })
  }
  let permission = readScreenPermission()
  if (process.platform === 'darwin' && (permission === 'not-determined' || permission === 'unknown')) {
    const allowed = await askScreenPermission()
    permission = allowed ? 'granted' : readScreenPermission()
    if (!allowed && permission !== 'granted') permission = 'denied'
  }
  return captureScreen({
    explicitAction: true,
    permission,
    platform: process.platform,
    getSources: async () => {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1600, height: 1000 },
      })
      return sources.map((source) => ({ png: source.thumbnail.toPNG() }))
    },
  })
}
