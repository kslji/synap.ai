/**
 * Search/replace edits. A patch is verified against the current file before anything is written.
 * Whole-file rewrites of longer files are rejected.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { unifiedDiff } from './edit.js'
import { resolveInside } from './paths.js'
import { normPath } from './plan.js'

/** Files longer than this cannot be replaced in one hunk. */
export const FULL_REWRITE_MIN_LINES = 8

export interface SearchReplace {
  path: string
  old: string
  new: string
}

export interface PreparedFile {
  path: string
  abs: string
  before: string
  after: string
  diff: string
  created: boolean
}

export function preparePatchSet(
  root: string,
  edits: SearchReplace[],
  options: { allowCreate: boolean; allowedPaths: readonly string[] | null },
): { ok: true; files: PreparedFile[] } | { ok: false; message: string } {
  if (!edits.length) return { ok: false, message: 'the model did not propose an edit' }
  const allowed = options.allowedPaths?.map(normPath) ?? null
  const working = new Map<string, { abs: string; text: string; created: boolean }>()
  for (const edit of edits) {
    const rel = normPath(edit.path)
    if (!rel) return { ok: false, message: 'edit path is empty' }
    if (allowed && !allowed.includes(rel)) return { ok: false, message: `edit path ${rel} is not a target of this step` }
    if (rel.split('/').includes('..')) return { ok: false, message: 'path is outside the project' }
    let current = working.get(rel)
    if (!current) {
      const abs = resolveInside(root, rel)
      if (!abs) return { ok: false, message: 'path is outside the project' }
      const exists = existsSync(abs)
      if (!exists && !options.allowCreate) return { ok: false, message: `file not found: ${rel}` }
      const text = exists ? readFileSync(abs, 'utf8') : ''
      current = { abs, text, created: !exists }
      working.set(rel, current)
    }
    const replaced = replaceOnce(current.text, edit.old, edit.new, rel)
    if (!replaced.ok) return replaced
    current.text = replaced.text
  }
  const files: PreparedFile[] = []
  for (const [rel, file] of working) {
    const before = file.created ? '' : readFileSync(file.abs, 'utf8')
    if (file.text === before) return { ok: false, message: `edit does not change ${rel}` }
    // The relative path the edit named. `relative(root, abs)` drifts on macOS, where /var is a link
    // to /private/var: the checkpoint and the plan then point at different files.
    const display = rel
    files.push({
      path: display,
      abs: file.abs,
      before,
      after: file.text,
      diff: unifiedDiff(display, before, file.text),
      created: file.created,
    })
  }
  return { ok: true, files }
}

export function writePrepared(files: readonly PreparedFile[]): void {
  for (const file of files) {
    mkdirSync(dirname(file.abs), { recursive: true })
    writeFileSync(file.abs, file.after, 'utf8')
  }
}

function replaceOnce(original: string, oldText: string, newText: string, path: string): { ok: true; text: string } | { ok: false; message: string } {
  const lines = original.replace(/\r\n/g, '\n').split('\n')
  const oldLines = oldText.replace(/\r\n/g, '\n').split('\n')
  if (!oldText) {
    if (original.length) return { ok: false, message: `search text is empty in ${path}` }
    const text = newText.endsWith('\n') || newText.length === 0 ? newText : `${newText}\n`
    return { ok: true, text }
  }
  if (isFullRewrite(original, oldText, lines, oldLines)) {
    return { ok: false, message: `full file rewrite is not allowed in ${path}; send a smaller search/replace hunk` }
  }
  const first = original.indexOf(oldText)
  if (first < 0) return { ok: false, message: `search text was not found in ${path}` }
  if (original.indexOf(oldText, first + oldText.length) >= 0) {
    return { ok: false, message: `search text matched more than once in ${path}` }
  }
  return { ok: true, text: original.slice(0, first) + newText + original.slice(first + oldText.length) }
}

function isFullRewrite(original: string, oldText: string, lines: string[], oldLines: string[]): boolean {
  if (lines.length <= FULL_REWRITE_MIN_LINES) return false
  const norm = (text: string) => text.replace(/\r\n/g, '\n').replace(/\n$/, '')
  if (norm(oldText) === norm(original)) return true
  const meaningful = oldLines.filter((line) => line.length > 0).length
  const fileLines = lines.filter((line) => line.length > 0).length
  return fileLines > 0 && meaningful / fileLines >= 0.85
}
