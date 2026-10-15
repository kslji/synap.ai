/**
 * Walk a project folder. Respects .gitignore (including nested files), skips
 * dependency and build directories, binaries, secrets, and oversized files.
 */
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import ignore, { type Ignore } from 'ignore'
import { BINARY_EXT, CODE_LIMITS, isSecretName, SKIP_DIR_NAMES } from './limits.js'
import { languageFor } from './languages.js'

export interface ScannedFile {
  abs: string
  rel: string
  size: number
  mtimeMs: number
  language: string
}

export interface ScanStats {
  files: ScannedFile[]
  ignored: number
  binaries: number
  tooBig: number
  capped: boolean
}

export interface ScanLimits {
  maxFileBytes: number
  maxFiles: number
  maxTotalBytes: number
  maxLineChars: number
}

interface Matcher { base: string; ig: Ignore }

function posix(path: string): string {
  return path.split(sep).join('/')
}

function loadMatcher(dir: string, base: string): Matcher | null {
  try {
    const text = readFileSync(join(dir, '.gitignore'), 'utf8')
    return { base, ig: ignore().add(text) }
  } catch {
    return null
  }
}

function ignored(rel: string, isDir: boolean, matchers: Matcher[]): boolean {
  let skip = false
  for (const matcher of matchers) {
    if (matcher.base && !rel.startsWith(matcher.base)) continue
    const local = matcher.base ? rel.slice(matcher.base.length) : rel
    if (!local) continue
    const localProbe = isDir ? `${local.replace(/\/$/, '')}/` : local
    const result = matcher.ig.test(localProbe)
    if (result.ignored) skip = true
    if (result.unignored) skip = false
  }
  return skip
}

function looksBinary(abs: string, size: number, maxLineChars: number): boolean {
  const sample = readFileSync(abs).subarray(0, Math.min(size, 8192))
  if (sample.includes(0)) return true
  const text = sample.toString('utf8')
  const first = text.split('\n', 1)[0] ?? ''
  return first.length >= maxLineChars
}

export function scanProject(root: string, limits: ScanLimits = CODE_LIMITS): ScanStats {
  const rootReal = realpathSync(root)
  const files: ScannedFile[] = []
  const stats: ScanStats = { files, ignored: 0, binaries: 0, tooBig: 0, capped: false }
  let total = 0
  const rootMatcher = loadMatcher(rootReal, '')
  const matchers: Matcher[] = rootMatcher ? [rootMatcher] : []

  function walk(dir: string, relDir: string, scopes: Matcher[]): void {
    if (stats.capped) return
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) }
    catch { return }
    const nested = loadMatcher(dir, relDir ? `${relDir}/` : '')
    const nextScopes = nested && nested.base !== '' ? [...scopes, nested] : scopes
    for (const ent of entries) {
      if (stats.capped) return
      if (ent.isSymbolicLink()) { stats.ignored++; continue }
      const name = ent.name
      const rel = relDir ? `${relDir}/${name}` : name
      const abs = join(dir, name)
      if (ent.isDirectory()) {
        if (SKIP_DIR_NAMES.has(name) || ignored(rel, true, nextScopes)) { stats.ignored++; continue }
        walk(abs, rel, nextScopes)
        continue
      }
      if (!ent.isFile()) continue
      if (isSecretName(name) || ignored(rel, false, nextScopes)) { stats.ignored++; continue }
      const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : ''
      if (BINARY_EXT.has(ext)) { stats.binaries++; continue }
      const language = languageFor(name)
      if (!language) { stats.binaries++; continue }
      let info
      try { info = statSync(abs) }
      catch { continue }
      if (info.size > limits.maxFileBytes || info.size === 0) { stats.tooBig++; continue }
      if (files.length >= limits.maxFiles || total + info.size > limits.maxTotalBytes) {
        stats.capped = true
        return
      }
      if (looksBinary(abs, info.size, limits.maxLineChars)) { stats.binaries++; continue }
      const real = realpathSync(abs)
      const relReal = posix(relative(rootReal, real))
      if (relReal.startsWith('..') || relReal === '') { stats.ignored++; continue }
      files.push({ abs: real, rel: posix(rel), size: info.size, mtimeMs: info.mtimeMs, language })
      total += info.size
    }
  }

  walk(rootReal, '', matchers)
  files.sort((a, b) => a.rel.localeCompare(b.rel))
  return stats
}

/** Same rules as a full walk, for one path reported by the file watcher. */
export function classifyFile(root: string, absPath: string, limits: ScanLimits = CODE_LIMITS): ScannedFile | null {
  let rootReal: string
  let real: string
  try {
    rootReal = realpathSync(root)
    real = realpathSync(absPath)
  } catch {
    return null
  }
  const rel = posix(relative(rootReal, real))
  if (!rel || rel.startsWith('..')) return null
  if (rel.split('/').some((part) => SKIP_DIR_NAMES.has(part))) return null
  const name = rel.split('/').pop() ?? rel
  if (isSecretName(name)) return null
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : ''
  if (BINARY_EXT.has(ext)) return null
  const language = languageFor(name)
  if (!language) return null
  const info = statSync(real)
  if (!info.isFile() || info.size === 0 || info.size > limits.maxFileBytes) return null
  if (looksBinary(real, info.size, limits.maxLineChars)) return null
  const matchers: Matcher[] = []
  const rootMatcher = loadMatcher(rootReal, '')
  if (rootMatcher) matchers.push(rootMatcher)
  let dir = rootReal
  let base = ''
  for (const part of rel.split('/').slice(0, -1)) {
    dir = join(dir, part)
    base = base ? `${base}/${part}` : part
    const nested = loadMatcher(dir, `${base}/`)
    if (nested) matchers.push(nested)
  }
  if (ignored(rel, false, matchers)) return null
  return { abs: real, rel, size: info.size, mtimeMs: info.mtimeMs, language }
}
