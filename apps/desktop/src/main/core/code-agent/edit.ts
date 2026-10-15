/**
 * Unified diffs for propose_edit. Applying a diff is a separate step from proposing it.
 */
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { relative, sep } from 'node:path'
import { resolveInside } from './paths.js'

const MAX_DIFF_CHARS = 20_000

export interface PlannedEdit {
  path: string
  abs: string
  diff: string
}

export function planEdit(root: string, args: Record<string, unknown>): PlannedEdit | { error: string } {
  const rel = typeof args.path === 'string' ? args.path.trim() : ''
  const abs = resolveInside(root, rel)
  if (!abs) return { error: 'path is outside the project' }
  const display = relative(root, abs).split(sep).join('/') || rel
  if (existsSync(abs) && statSync(abs).size > 1024 * 1024) return { error: 'file is too large to edit' }
  const diffText = typeof args.diff === 'string' ? args.diff : ''
  const oldText = typeof args.old === 'string' ? args.old : null
  const newText = typeof args.new === 'string' ? args.new : null
  if (diffText.trim()) {
    if (diffText.length > MAX_DIFF_CHARS) return { error: 'diff is too large' }
    const current = existsSync(abs) ? readFileSync(abs, 'utf8') : ''
    const applied = applyUnifiedDiff(current, diffText)
    if (!applied.ok) return { error: applied.message }
    if (applied.text === current) return { error: 'diff does not change the file' }
    return { path: display, abs, diff: diffText.endsWith('\n') ? diffText : `${diffText}\n` }
  }
  if (oldText == null || newText == null) return { error: 'propose_edit needs a diff, or old and new text' }
  const current = existsSync(abs) ? readFileSync(abs, 'utf8') : ''
  const replaced = replaceOnce(current, oldText, newText)
  if (!replaced.ok) return { error: replaced.message }
  if (replaced.text === current) return { error: 'edit does not change the file' }
  const diff = unifiedDiff(display, current, replaced.text)
  if (diff.length > MAX_DIFF_CHARS) return { error: 'diff is too large' }
  return { path: display, abs, diff }
}

export function applyPlannedEdit(root: string, rel: string, diff: string): { ok: true } | { ok: false; message: string } {
  const abs = resolveInside(root, rel)
  if (!abs) return { ok: false, message: 'path is outside the project' }
  const current = existsSync(abs) ? readFileSync(abs, 'utf8') : ''
  const applied = applyUnifiedDiff(current, diff)
  if (!applied.ok) return applied
  writeFileSync(abs, applied.text, 'utf8')
  return { ok: true }
}

export function unifiedDiff(path: string, before: string, after: string): string {
  const rel = path.split(sep).join('/')
  if (!before) {
    const lines = after.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n')
    const body = lines.map((line) => `+${line}`)
    return [`--- /dev/null`, `+++ b/${rel}`, `@@ -0,0 +1,${lines.length} @@`, ...body, ''].join('\n')
  }
  const a = before.replace(/\r\n/g, '\n').split('\n')
  const b = after.replace(/\r\n/g, '\n').split('\n')
  let pre = 0
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++
  let suf = 0
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++
  const ctx = 3
  const from = Math.max(0, pre - ctx)
  const oldEnd = a.length - suf
  const newEnd = b.length - suf
  const oldSlice = a.slice(from, Math.min(a.length, oldEnd + ctx))
  const header = `@@ -${from + 1},${oldSlice.length} +${from + 1},${Math.min(b.length, newEnd + ctx) - from} @@`
  const body: string[] = []
  for (let i = from; i < pre; i++) body.push(` ${a[i]}`)
  for (let i = pre; i < oldEnd; i++) body.push(`-${a[i]}`)
  for (let i = pre; i < newEnd; i++) body.push(`+${b[i]}`)
  for (let i = oldEnd; i < from + oldSlice.length; i++) body.push(` ${a[i]}`)
  return [`--- a/${rel}`, `+++ b/${rel}`, header, ...body, ''].join('\n')
}

export function applyUnifiedDiff(original: string, diff: string): { ok: true; text: string } | { ok: false; message: string } {
  const lines = diff.replace(/\r\n/g, '\n').split('\n')
  const hunks: { oldStart: number; body: string[] }[] = []
  let i = 0
  while (i < lines.length) {
    const header = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/.exec(lines[i] ?? '')
    if (!header) { i++; continue }
    const oldStart = Number(header[1])
    const body: string[] = []
    i++
    while (i < lines.length && !lines[i].startsWith('@@') && !lines[i].startsWith('diff ') && !lines[i].startsWith('---') && !lines[i].startsWith('+++')) {
      body.push(lines[i] ?? '')
      i++
    }
    hunks.push({ oldStart, body })
  }
  if (!hunks.length) return { ok: false, message: 'diff has no hunks' }
  const src = original.replace(/\r\n/g, '\n').split('\n')
  const blankFile = original.length === 0
  let cursor = 0
  const out: string[] = []
  for (const hunk of hunks) {
    const start = hunk.oldStart === 0 ? 0 : hunk.oldStart - 1
    if (start < cursor) return { ok: false, message: 'hunks overlap or go backwards' }
    if (!blankFile) out.push(...src.slice(cursor, start))
    let at = start
    for (const line of hunk.body) {
      if (line.startsWith('\\')) continue
      if (line === '') continue
      const tag = line[0]
      const text = line.slice(1)
      if (tag === ' ') {
        if (!blankFile && src[at] !== text) return { ok: false, message: `context mismatch at line ${at + 1}` }
        out.push(text)
        at++
      } else if (tag === '-') {
        if (blankFile || src[at] !== text) return { ok: false, message: `removed line mismatch at line ${at + 1}` }
        at++
      } else if (tag === '+') {
        out.push(text)
      } else {
        return { ok: false, message: 'unrecognized diff line' }
      }
    }
    cursor = at
  }
  if (!blankFile) out.push(...src.slice(cursor))
  let text = out.join('\n')
  if ((original.endsWith('\n') || original.length === 0) && text.length > 0 && !text.endsWith('\n')) text += '\n'
  return { ok: true, text }
}

function replaceOnce(original: string, oldText: string, newText: string): { ok: true; text: string } | { ok: false; message: string } {
  if (!oldText) {
    if (original.length) return { ok: false, message: 'old text is empty' }
    return { ok: true, text: newText.endsWith('\n') || newText.length === 0 ? newText : `${newText}\n` }
  }
  const first = original.indexOf(oldText)
  if (first < 0) return { ok: false, message: 'old text was not found' }
  if (original.indexOf(oldText, first + oldText.length) >= 0) return { ok: false, message: 'old text matched more than once' }
  return { ok: true, text: original.slice(0, first) + newText + original.slice(first + oldText.length) }
}
