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
    // Missing parents stay missing until an approved write creates them.
    const missing: string[] = []
    let cursor = abs
    while (!existsSync(cursor)) {
      const parent = resolve(cursor, '..')
      if (parent === cursor) return null
      const name = basename(cursor)
      if (!name || name === '.' || name === '..') return null
      missing.push(name)
      cursor = parent
    }
    let anchor: string
    try { anchor = realpathSync(cursor) } catch { return null }
    if (anchor !== rootReal && !inside(rootReal, anchor)) return null
    let built = anchor
    for (const name of missing.reverse()) built = resolve(built, name)
    return inside(rootReal, built)
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
