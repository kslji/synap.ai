/** Public Ed25519 keys compiled into the app. The signing seed is never shipped. */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { surfEnv } from './surf-env.js'
import type { TrustedKeys } from './pack-verify.js'

export function trustedPackKeys(): TrustedKeys {
  const keys: TrustedKeys = {}
  const packaged = join(process.resourcesPath, 'pack-keys.json')
  const dev = join(app.getAppPath(), 'resources', 'pack-keys.json')
  const path = existsSync(packaged) ? packaged : dev
  if (existsSync(path)) {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { keys?: TrustedKeys }
    Object.assign(keys, parsed.keys ?? {})
  }
  const extra = surfEnv('PACK_PUBKEY')
  if (extra && extra.includes(':')) {
    const split = extra.indexOf(':')
    const id = extra.slice(0, split)
    const hex = extra.slice(split + 1)
    if (/^[0-9a-f]{64}$/i.test(hex)) keys[id] = hex
  }
  return keys
}
