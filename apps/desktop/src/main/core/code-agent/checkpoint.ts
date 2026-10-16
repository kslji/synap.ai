/**
 * Per-step undo. Each checkpoint is the bytes of the files that step touched, taken before the write.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { resolveInside } from './paths.js'
import { normPath } from './plan.js'

export interface FileSnapshot {
  path: string
  existed: boolean
  text: string
}

export interface Checkpoint {
  stepId: string
  root: string
  files: FileSnapshot[]
}

export function captureCheckpoint(root: string, stepId: string, paths: readonly string[]): Checkpoint {
  const files: FileSnapshot[] = []
  const seen = new Set<string>()
  for (const input of paths) {
    const rel = normPath(input)
    if (!rel || seen.has(rel)) continue
    seen.add(rel)
    const abs = resolveInside(root, rel)
    if (!abs || !existsSync(abs)) {
      files.push({ path: rel, existed: false, text: '' })
      continue
    }
    files.push({ path: rel, existed: true, text: readFileSync(abs, 'utf8') })
  }
  return { stepId, root, files }
}

export function extendCheckpoint(checkpoint: Checkpoint, paths: readonly string[]): Checkpoint {
  const known = new Set(checkpoint.files.map((file) => file.path))
  const extra = captureCheckpoint(checkpoint.root, checkpoint.stepId, paths.filter((path) => !known.has(normPath(path))))
  return { ...checkpoint, files: [...checkpoint.files, ...extra.files] }
}

export function restoreCheckpoint(checkpoint: Checkpoint): void {
  for (const file of checkpoint.files) {
    const abs = resolveInside(checkpoint.root, file.path)
    if (!abs) continue
    if (!file.existed) {
      if (existsSync(abs)) rmSync(abs, { force: true })
      continue
    }
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, file.text, 'utf8')
  }
}

export function writeCheckpointDir(dir: string, checkpoints: readonly Checkpoint[]): void {
  mkdirSync(dir, { recursive: true })
  for (const checkpoint of checkpoints) {
    const name = checkpoint.stepId.replace(/[^A-Za-z0-9_-]/g, '_')
    writeFileSync(join(dir, `${name}.json`), JSON.stringify(checkpoint), { mode: 0o600 })
  }
}

export function readCheckpointDir(dir: string): Checkpoint[] {
  if (!existsSync(dir)) return []
  const out: Checkpoint[] = []
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue
    try {
      const parsed = JSON.parse(readFileSync(join(dir, name), 'utf8')) as Checkpoint
      if (parsed && typeof parsed.stepId === 'string' && Array.isArray(parsed.files)) out.push(parsed)
    } catch { /* skip a torn file */ }
  }
  return out
}
