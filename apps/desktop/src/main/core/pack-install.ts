/**
 * Atomic pack install. Staging is verified first. A failed rename deletes the
 * incoming copy and leaves the previous version where it was.
 */
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PackManifest } from './pack-verify.js'

export interface InstalledPointer {
  id: string
  title: string
  version: string
  niche: string
  syncedAt: number
}

export interface InstallOptions {
  /** Test seam: throw after the previous version is moved aside, so rollback can restore it. */
  failAfterAside?: boolean
}

export async function commitInstall(staging: string, packsRoot: string, manifest: PackManifest, title: string, options: InstallOptions = {}): Promise<string> {
  const packRoot = join(packsRoot, manifest.pack_id)
  await mkdir(packRoot, { recursive: true })
  const finalDir = join(packRoot, manifest.version)
  const incoming = `${finalDir}.incoming`
  const backup = `${finalDir}.bak`
  await rm(incoming, { recursive: true, force: true })
  await rm(backup, { recursive: true, force: true })
  await rename(staging, incoming)
  let movedAside = false
  try {
    if (existsSync(finalDir)) {
      await rename(finalDir, backup)
      movedAside = true
    }
    if (options.failAfterAside) throw new Error('forced failure')
    await rename(incoming, finalDir)
  } catch (error) {
    if (movedAside && existsSync(backup)) {
      if (existsSync(finalDir)) await rm(finalDir, { recursive: true, force: true })
      await rename(backup, finalDir)
    }
    await rm(incoming, { recursive: true, force: true })
    throw new Error(`install rolled back: ${(error as Error).message}`)
  }
  await rm(backup, { recursive: true, force: true })
  const pointer: InstalledPointer = {
    id: manifest.pack_id,
    title,
    version: manifest.version,
    niche: manifest.niche,
    syncedAt: Date.now(),
  }
  await writeFile(join(packRoot, 'installed.json'), JSON.stringify(pointer))
  return finalDir
}

export async function readInstalled(packsRoot: string): Promise<InstalledPointer[]> {
  const { readdir } = await import('node:fs/promises')
  if (!existsSync(packsRoot)) return []
  const out: InstalledPointer[] = []
  for (const name of await readdir(packsRoot)) {
    const file = join(packsRoot, name, 'installed.json')
    if (!existsSync(file)) continue
    try {
      out.push(JSON.parse(await readFile(file, 'utf8')) as InstalledPointer)
    } catch {
      continue
    }
  }
  return out
}

export async function removePack(packsRoot: string, packId: string): Promise<void> {
  await rm(join(packsRoot, packId), { recursive: true, force: true })
}
