/** Public Ed25519 licence keys compiled into the app. The signing seed is never shipped. */
import { app } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { TrustedKeys } from './pack-verify.js'

export function trustedLicenceKeys(): TrustedKeys {
  const keys: TrustedKeys = {}
  const packaged = join(process.resourcesPath, 'licence-public.json')
  const dev = join(app.getAppPath(), 'resources', 'licence-public.json')
  const path = existsSync(packaged) ? packaged : dev
  if (existsSync(path)) {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { keys?: TrustedKeys }
    Object.assign(keys, parsed.keys ?? {})
  }
  return keys
}
