/**
 * Unified diffs for propose_edit. Applying a diff is a separate step from proposing it.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, relative, sep } from 'node:path'
import { resolveInside } from './paths.js'

const MAX_DIFF_CHARS = 20_000

const LF = String.fromCharCode(10)
const CRLF = String.fromCharCode(13) + LF

/** Split text into lines, normalising CRLF and dropping one trailing newline. */
function textLines(text: string): string[] {
  const lines = text.split(CRLF).join(LF).split(LF)
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

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
    const applied = applyUnifiedDiff(current, diffText, display)
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
  const applied = applyUnifiedDiff(current, diff, rel)
  if (!applied.ok) return applied
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, applied.text, 'utf8')
  return { ok: true }
}

export function unifiedDiff(path: string, before: string, after: string): string {
  const rel = path.split(sep).join('/')
  if (!before) {
    const lines = textLines(after)
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

interface Hunk {
  /** The line the model says the hunk starts at; only a hint, see `findAt`. */
  start: number
  body: string[]
}

interface Section {
  path: string | null
  hunks: Hunk[]
}

/**
 * Apply a unified diff, forgiving the two mistakes a small model makes and reporting the rest.
 *
 * The line numbers in `@@` are treated as a hint: a hunk that does not match there is placed where
 * its own context and removed lines occur. A diff that covers two files is narrowed to the file the
 * edit is for, because `propose_edit` writes one path.
 */
export function applyUnifiedDiff(original: string, diff: string, path?: string): { ok: true; text: string } | { ok: false; message: string } {
  const lines = diff.replace(/\r\n/g, '\n').split('\n')
  const sections: Section[] = []
  let section: Section | null = null
  let i = 0
  while (i < lines.length) {
    const line = lines[i] ?? ''
    if (line.startsWith('+++')) {
      const named = headerPath(line)
      if (named) {
        if (section && !section.hunks.length) section.path = named
        else {
          section = { path: named, hunks: [] }
          sections.push(section)
        }
      }
      i++
      continue
    }
    const header = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/.exec(line)
    if (!header) { i++; continue }
    if (!section) {
      section = { path: null, hunks: [] }
      sections.push(section)
    }
    const body: string[] = []
    i++
    while (i < lines.length && !lines[i]!.startsWith('@@') && !lines[i]!.startsWith('diff ') && !lines[i]!.startsWith('---') && !lines[i]!.startsWith('+++')) {
      body.push(lines[i] ?? '')
      i++
    }
    section.hunks.push({ start: Number(header[1]), body })
  }
  const filled = sections.filter((item) => item.hunks.length)
  if (!filled.length) return { ok: false, message: 'diff has no hunks' }
  const hunks = hunksFor(filled, path)
  if ('message' in hunks) return hunks

  const src = original.replace(/\r\n/g, '\n').split('\n')
  const blankFile = original.length === 0
  const placed: Hunk[] = []
  for (const hunk of hunks.hunks) {
    const need = contextOf(hunk)
    const declared = Math.max(0, hunk.start - 1)
    const at = blankFile ? 0 : findAt(src, need, declared)
    if (at === null) {
      const first = need.find((text) => text.trim().length > 0) ?? ''
      return { ok: false, message: `could not find the lines this hunk changes${first ? ` ("${first.trim().slice(0, 60)}")` : ''}; read the file again and edit the text it has now` }
    }
    placed.push({ start: at, body: hunk.body })
  }
  placed.sort((a, b) => a.start - b.start)

  let cursor = 0
  const out: string[] = []
  for (const hunk of placed) {
    if (hunk.start < cursor) return { ok: false, message: 'two hunks change the same lines' }
    if (!blankFile) out.push(...src.slice(cursor, hunk.start))
    let at = hunk.start
    for (const line of hunk.body) {
      if (line.startsWith('\\')) continue
      if (line === '') continue
      const tag = line[0]
      const text = line.slice(1)
      if (tag === ' ') {
        out.push(blankFile ? text : (src[at] ?? ''))
        at++
      } else if (tag === '-') {
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

/** The hunks for one path. A diff that names another file is refused by name, not misapplied. */
function hunksFor(sections: Section[], path?: string): { hunks: Hunk[] } | { ok: false; message: string } {
  const named = sections.filter((item) => item.path !== null)
  if (path && named.length) {
    const want = relPath(path)
    const match = sections.filter((item) => item.path !== null && relPath(item.path) === want)
    if (match.length) return { hunks: match.flatMap((item) => item.hunks) }
    const names = [...new Set(named.map((item) => item.path ?? ''))].join(', ')
    return { ok: false, message: `this diff changes ${names}; this edit is for ${want}. Send one file per propose_edit.` }
  }
  return { hunks: sections.flatMap((item) => item.hunks) }
}

/** The lines a hunk needs to see before it can be applied: its context and the text it removes. */
function contextOf(hunk: Hunk): string[] {
  return hunk.body.filter((line) => line !== '' && (line[0] === ' ' || line[0] === '-')).map((line) => line.slice(1))
}

/** Where the hunk really goes: the declared line when it matches, else the nearest line that does. */
function findAt(src: string[], need: string[], declared: number): number | null {
  if (!need.length) return declared
  if (matchesAt(src, need, declared)) return declared
  let best: number | null = null
  for (let at = 0; at + need.length <= src.length; at++) {
    if (!matchesAt(src, need, at)) continue
    if (best === null || Math.abs(at - declared) < Math.abs(best - declared)) best = at
  }
  return best
}

function matchesAt(src: string[], need: string[], at: number): boolean {
  if (at < 0 || at + need.length > src.length) return false
  for (let k = 0; k < need.length; k++) if (src[at + k] !== need[k]) return false
  return true
}

/** The path on a `+++` line, without the a/ or b/ prefix git writes. */
function headerPath(line: string): string | null {
  const raw = (line.slice(3).trim().split('\t')[0] ?? '').trim()
  if (!raw || raw === '/dev/null') return null
  return relPath(raw)
}

function relPath(path: string): string {
  return path.replace(/^[ab]\//, '').replace(/\\/g, '/').replace(/^\.\//, '')
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
