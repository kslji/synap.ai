/** Licence file in the app private data folder. The signature is the integrity check. */
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { clockIntegrity, type StoredLicence } from './licence.js'

export interface LoadedLicence {
  stored: StoredLicence | null
  broken: boolean
  maxSeenMs: number | null
  clockOk: boolean
}

export function licencePath(dir: string): string {
  return join(dir, 'licence.json')
}

export function clockPath(dir: string): string {
  return join(dir, 'licence-clock.json')
}

async function writeAtomic(path: string, body: string): Promise<void> {
  const tmp = `${path}.tmp`
  await writeFile(tmp, body, { mode: 0o600 })
  await rename(tmp, path)
}

export async function loadLicenceDir(dir: string): Promise<LoadedLicence> {
  const file = licencePath(dir)
  if (!existsSync(file)) return { stored: null, broken: false, maxSeenMs: null, clockOk: true }
  let stored: StoredLicence
  try {
    stored = JSON.parse(await readFile(file, 'utf8')) as StoredLicence
  } catch {
    return { stored: null, broken: true, maxSeenMs: null, clockOk: false }
  }
  const clockFile = clockPath(dir)
  if (!existsSync(clockFile)) return { stored, broken: false, maxSeenMs: null, clockOk: false }
  try {
    const clock = JSON.parse(await readFile(clockFile, 'utf8')) as { maxSeenMs?: unknown; integrity?: unknown }
    const maxSeenMs = typeof clock.maxSeenMs === 'number' ? clock.maxSeenMs : null
    const integrity = typeof clock.integrity === 'string' ? clock.integrity : ''
    const clockOk = maxSeenMs != null && integrity === clockIntegrity(maxSeenMs, stored.integrity ?? '')
    return { stored, broken: false, maxSeenMs, clockOk }
  } catch {
    return { stored, broken: false, maxSeenMs: null, clockOk: false }
  }
}

export async function writeLicenceDir(dir: string, stored: StoredLicence, nowMs: number): Promise<void> {
  await mkdir(dir, { recursive: true })
  await writeAtomic(licencePath(dir), JSON.stringify(stored))
  const integrity = clockIntegrity(nowMs, stored.integrity)
  await writeAtomic(clockPath(dir), JSON.stringify({ maxSeenMs: nowMs, integrity }))
}

export async function writeClock(dir: string, maxSeenMs: number, licenceIntegrity: string): Promise<void> {
  await mkdir(dir, { recursive: true })
  await writeAtomic(clockPath(dir), JSON.stringify({ maxSeenMs, integrity: clockIntegrity(maxSeenMs, licenceIntegrity) }))
}

export async function clearLicenceDir(dir: string): Promise<void> {
  await rm(licencePath(dir), { force: true })
  await rm(clockPath(dir), { force: true })
}
