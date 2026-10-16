/**
 * Per-project Ask / Auto choice. New projects follow the settings default,
 * which is Ask until the user changes it. Auto still needs the one-time confirmation.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { effectiveMode, type PermissionMode } from './permission.js'

export interface ModeMap {
  [root: string]: PermissionMode
}

export function parseModeMap(raw: unknown): ModeMap {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: ModeMap = {}
  for (const [key, value] of Object.entries(raw)) {
    if (value === 'ask' || value === 'auto') out[key] = value
  }
  return out
}

export function projectMode(map: ModeMap, root: string, fallback: PermissionMode, autoConfirmed: boolean): PermissionMode {
  const saved = map[root]
  return effectiveMode(saved === 'ask' || saved === 'auto' ? saved : null, fallback, autoConfirmed)
}

export function readModeMap(dir: string): ModeMap {
  try {
    return parseModeMap(JSON.parse(readFileSync(join(dir, 'modes.json'), 'utf8')))
  } catch {
    return {}
  }
}

export function saveProjectMode(dir: string, root: string, mode: PermissionMode): void {
  const map = readModeMap(dir)
  map[root] = mode
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'modes.json'), JSON.stringify(map), { mode: 0o600 })
}
