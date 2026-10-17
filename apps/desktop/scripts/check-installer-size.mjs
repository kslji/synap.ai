/**
 * GitHub rejects a release asset at or above 2 GiB.
 * NSIS and DMG both receive the offline 2B file as one extra resource.
 * The GGUF is 1,280,835,840 bytes, under that limit. This check fails the
 * release if a finished installer is not strictly smaller than 2 GiB.
 */
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

export const GITHUB_ASSET_LIMIT_BYTES = 2 * 1024 * 1024 * 1024

export function assetFits(bytes) {
  return Number.isFinite(bytes) && bytes > 0 && bytes < GITHUB_ASSET_LIMIT_BYTES
}

const isMain = process.argv[1]?.endsWith('check-installer-size.mjs')
if (!isMain) {
  /* imported by the unit test */
} else {
const dir = process.argv[2]
if (!dir) {
  console.error('usage: node scripts/check-installer-size.mjs <dist>')
  process.exit(1)
}

const names = readdirSync(dir).filter((name) => /\.(dmg|exe)$/i.test(name) && !name.includes('uninstall'))
if (!names.length) {
  console.error('no installer in', dir)
  process.exit(1)
}
let failed = 0
for (const name of names) {
  const bytes = statSync(join(dir, name)).size
  const ok = assetFits(bytes)
  console.log(`${ok ? 'ok' : 'too big'} ${name} ${bytes}`)
  if (!ok) failed += 1
  if (process.env.SURF_BUNDLE_MODEL === '1' && !name.includes('offline-2b')) {
    console.error('offline build produced an installer without offline-2b in the name:', name)
    failed += 1
  }
}
if (failed) process.exit(1)
}
