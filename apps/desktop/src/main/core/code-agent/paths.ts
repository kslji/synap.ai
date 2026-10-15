/**
 * Project-relative paths. A tool path must stay inside the opened folder.
 */
import { existsSync, realpathSync } from 'node:fs'
import { basename, relative, resolve, sep } from 'node:path'

export function resolveInside(root: string, input: string): string | null {
  if (typeof input !== 'string' || input.includes('\0')) return null
  const rel = input.trim().replace(/\\/g, '/')
  if (!rel || rel.startsWith('/') || /^[A-Za-z]:/.test(rel)) return null
  if (rel.split('/').includes('..')) return null
  let rootReal: string
  try { rootReal = realpathSync(root) } catch { return null }
  const abs = resolve(rootReal, rel)
  try {
    if (existsSync(abs)) return inside(rootReal, realpathSync(abs))
    const parent = resolve(abs, '..')
    if (!existsSync(parent)) return null
    const parentReal = realpathSync(parent)
    if (!inside(rootReal, parentReal)) return null
    const name = basename(abs)
    if (!name || name === '.' || name === '..') return null
    return inside(rootReal, resolve(parentReal, name))
  } catch {
    return null
  }
}

function inside(rootReal: string, candidate: string): string | null {
  if (candidate === rootReal) return candidate
  const back = relative(rootReal, candidate)
  if (!back || back.startsWith('..') || back.split(sep).includes('..')) return null
  return candidate
}
