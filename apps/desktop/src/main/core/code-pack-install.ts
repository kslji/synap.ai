/**
 * Copy the installer copy of the Code pack into the app's private data folder.
 * A newer signed pack replaces an older one. A bad signature is left uninstalled.
 */
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { compareVersions } from './pack-verify.js'
import { loadCodePack, type CodePackLoad } from './code-pack.js'
import type { TrustedKeys } from './pack-verify.js'

export async function installBundledCodePack(bundledDir: string, destDir: string, keys: TrustedKeys): Promise<CodePackLoad> {
  const bundled = await loadCodePack(bundledDir, keys)
  if (bundled.status !== 'ready') return bundled
  const current = await loadCodePack(destDir, keys)
  if (current.status === 'ready' && compareVersions(bundled.manifest.version, current.manifest.version) <= 0) return current
  const staging = `${destDir}.incoming`
  rmSync(staging, { recursive: true, force: true })
  mkdirSync(join(staging, '..'), { recursive: true })
  cpSync(bundledDir, staging, { recursive: true })
  const checked = await loadCodePack(staging, keys)
  if (checked.status !== 'ready') {
    rmSync(staging, { recursive: true, force: true })
    return checked
  }
  rmSync(destDir, { recursive: true, force: true })
  mkdirSync(join(destDir, '..'), { recursive: true })
  cpSync(staging, destDir, { recursive: true })
  rmSync(staging, { recursive: true, force: true })
  return loadCodePack(destDir, keys)
}

export function bundledCodePackDir(isPackaged: boolean, resourcesPath: string, appRoot: string): string {
  const packaged = join(resourcesPath, 'code-pack')
  if (isPackaged && existsSync(packaged)) return packaged
  return join(appRoot, 'resources', 'code-pack')
}
