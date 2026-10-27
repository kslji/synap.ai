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

/** A propose_edit whose diff spans files, planned per file: the halves that land, and why the rest do not. */
export interface PlannedBatch {
  edits: PlannedEdit[]
  skipped: { path: string; error: string }[]
}

/**
 * Plan every file a propose_edit touches. A 2B that types a two-file task into one diff believes
 * both halves landed; answering with only one of them is how the run loses the step it cannot
 * spare. Splitting the diff per file and applying each half says the same thing the model meant,
 * and a half that cannot be placed is reported by name instead of silently dropped.
 */
export function planEdits(root: string, args: Record<string, unknown>): PlannedBatch | { error: string } {
  const diffText = typeof args.diff === 'string' ? args.diff : ''
  if (diffText.trim() && diffText.length <= MAX_DIFF_CHARS) {
    const sections = sectionsOf(diffText)
    const named = [...new Set(sections.flatMap((item) => (item.path === null ? [] : [item.path])))]
    if (named.length > 1) {
      const edits: PlannedEdit[] = []
      const skipped: { path: string; error: string }[] = []
      for (const path of named) {
        const sub = subDiff(path, sections.filter((item) => item.path === path))
        const abs = resolveInside(root, path)
        if (!abs) {
          skipped.push({ path, error: 'path is outside the project' })
          continue
        }
        if (existsSync(abs) && statSync(abs).size > 1024 * 1024) {
          skipped.push({ path, error: 'file is too large to edit' })
          continue
        }
        const current = existsSync(abs) ? readFileSync(abs, 'utf8') : ''
        const applied = applyUnifiedDiff(current, sub, path)
        if (!applied.ok) skipped.push({ path, error: applied.message })
        else if (applied.text === current) skipped.push({ path, error: 'diff does not change the file' })
        else edits.push({ path, abs, diff: sub.endsWith('\n') ? sub : `${sub}\n` })
      }
      if (!edits.length) return { error: skipped.map((item) => `${item.path}: ${item.error}`).join('\n') }
      return { edits, skipped }
    }
  }
  const planned = planEdit(root, args)
  if ('error' in planned) return planned
  return { edits: [planned], skipped: [] }
}

/** One file's half of a multi-file diff, with its own header, so it can be planned on its own. */
function subDiff(path: string, sections: Section[]): string {
  const parts: string[] = [`--- a/${path}`, `+++ b/${path}`]
  for (const hunk of sections.flatMap((item) => item.hunks)) {
    const oldCount = hunk.body.filter((line) => line === '' || line.startsWith(' ') || line.startsWith('-')).length
    const newCount = hunk.body.filter((line) => line === '' || line.startsWith(' ') || line.startsWith('+')).length
    parts.push(`@@ -${hunk.start},${oldCount} +${hunk.start},${newCount} @@`, ...hunk.body)
  }
  return parts.join('\n')
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
    // A model that types the whole new file into `diff` and the real pair into old and new has
    // already answered the call: the pair is the edit. Any other failure stays the answer.
    const unusable = !applied.ok && applied.message.includes('no hunks') && oldText != null && newText != null
    if (!applied.ok && !unusable) {
      // Plain text in the diff field is a 2B asking for the edit without knowing the form. Saying
      // "no hunks" back teaches it nothing; naming the two shapes that work is the lesson.
      if (applied.message.includes('no hunks')) return { error: `${applied.message} - write it as a unified diff (--- a/${display}, +++ b/${display}, and @@ lines), or pass the text as it is now as old and the text you want as new` }
      return { error: applied.message }
    }
    if (applied.ok) {
      if (applied.text === current) return { error: 'diff does not change the file' }
      return { path: display, abs, diff: diffText.endsWith('\n') ? diffText : `${diffText}\n` }
    }
  }
  if (oldText == null || newText == null) return { error: 'propose_edit needs a diff, or old and new text' }
  const current = existsSync(abs) ? readFileSync(abs, 'utf8') : ''
  const replaced = replaceOnce(current, oldText, newText)
  if (!replaced.ok) return { error: replaced.message }
  if (replaced.text === current) {
    // The pair says the file is already what the model wants. The one thing that keeps a run alive
    // here is the text it is looking at, so it can name the change it has not made yet.
    return { error: `${display} already holds exactly the text you sent. If the check still fails, the change it wants is somewhere else in this file: ${preview(current)}` }
  }
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
  const filled = sectionsOf(diff)
  if (!filled.length) return { ok: false, message: 'diff has no hunks' }
  const hunks = hunksFor(filled, path)
  if ('message' in hunks) return hunks

  const src = original.replace(/\r\n/g, '\n').split('\n')
  const blankFile = original.length === 0
  const placed: Hunk[] = []
  for (const hunk of hunks.hunks) {
    const declared = Math.max(0, hunk.start - 1)
    const need = contextOf(hunk)
    const at = blankFile ? 0 : findAt(src, need, declared) ?? findPrefixAt(src, need, declared)
    if (at !== null) {
      placed.push({ start: at, body: hunk.body })
      continue
    }
    // The context lines were copied from the file the model remembers. The lines it removes are
    // usually exact, so anchor on those and drop the context: the removal and insertion still land
    // in the right place, and nothing else in the file is touched.
    const removed = hunk.body.filter((line) => line.startsWith('-')).map((line) => line.slice(1))
    const narrow = hunk.body.filter((line) => line.startsWith('-') || line.startsWith('+'))
    const anchor = removed.length ? findAt(src, removed, declared) : null
    if (anchor !== null) {
      // A hunk that opens with an insertion the file already holds came from two places at once:
      // the model pasted the import it thought was missing above the line it really meant to fix.
      // Dropping those leading lines keeps the rest where the removal anchors it, instead of
      // pasting a duplicate import into the middle of a function.
      let cut = 0
      while (cut < narrow.length && narrow[cut]!.startsWith('+') && src.some((text) => text.trim() && text.trim() === narrow[cut]!.slice(1).trim())) cut++
      placed.push({ start: anchor, body: cut < narrow.length ? narrow.slice(cut) : narrow })
      continue
    }
    const first = need.find((text) => text.trim().length > 0) ?? ''
    // The change was probably made a step ago and sent again from memory. "Not found" sends the
    // model round the same hunk; the lines being there already is a different answer.
    const added = hunk.body.filter((line) => line.startsWith('+')).map((line) => line.slice(1).trim())
    if (added.length && added.every((line) => src.some((text) => text.trim() === line))) {
      return { ok: false, message: 'the lines this hunk adds are already in the file, so it would change nothing - the check failed for another reason, so change the line it names' }
    }
    return { ok: false, message: `could not find the lines this hunk changes${first ? ` ("${first.trim().slice(0, 60)}")` : ''}; read the file again and edit the text it has now` }
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
        if (blankFile) {
          out.push(text)
        } else if (at < src.length) {
          out.push(src[at] ?? '')
          at++
        } else {
          // The hunk ran past the end of the file. What the model typed there is not in this file,
          // and the change it made before that point is the one it asked for.
          break
        }
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

/** Split a unified diff into the files it names and the hunks under each header. */
function sectionsOf(diff: string): Section[] {
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
  return sections.filter((item) => item.hunks.length)
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

/**
 * Where the head of the hunk is, when the whole of it is not. A model that keeps typing adds
 * context lines from another file, or past the end of this one: anchoring on the part that is real
 * keeps the edit where it belongs, instead of sliding it to a removal line somewhere else.
 */
function findPrefixAt(src: string[], need: string[], declared: number): number | null {
  for (let k = need.length - 1; k >= 2; k--) {
    const at = findAt(src, need.slice(0, k), declared)
    if (at !== null) return at
  }
  return null
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
  const loose = matchLoose(original, oldText)
  const unique = loose !== null && loose.hits.length === 1
  // A line named without its indentation is still that line: match it whole and give the new text
  // the file's own indent. That is only asked for when the exact match starts part way into a line
  // and what replaces it spans lines, because that splice is what breaks the indentation. An edit
  // of one word inside a line still goes where the word is.
  const anchored = unique && first >= 0 && original[first - 1] !== undefined && original[first - 1] !== LF && newText.includes(LF)
  if (first >= 0 && !anchored) {
    if (original.indexOf(oldText, first + oldText.length) >= 0) return { ok: false, message: 'old text matched more than once' }
    return { ok: true, text: original.slice(0, first) + newText + original.slice(first + oldText.length) }
  }
  // A 2B told "not found" spends its next step re-reading the file, and often guesses the same
  // text again. Leading whitespace is the one difference that never changes what a line means.
  if (unique && loose) {
    const at = loose.hits[0]!
    const matched = loose.src.slice(at, at + loose.want.length).join(LF)
    const indent = leading(loose.src[at]!)
    const body = reindent(textLines(newText), indent).join(LF) + (newText.endsWith(LF) ? LF : '')
    const start = loose.src.slice(0, at).join(LF).length + (at ? 1 : 0)
    return { ok: true, text: original.slice(0, start) + body + original.slice(start + matched.length) }
  }
  if (loose && loose.hits.length > 1) return { ok: false, message: 'old text matched more than once' }
  // A model that retypes a file it has not re-read is describing the file it wants, not the one it
  // sent. When every line the file has is in what it wrote, nothing is lost by taking that as the
  // file; a rewrite that drops a line is not that edit and stays an error.
  const kept = textLines(newText).map((line) => line.trim())
  if (kept.some((line) => line) && textLines(original).filter((line) => line.trim()).every((line) => kept.includes(line.trim()))) {
    return { ok: true, text: newText.endsWith(LF) || !newText.trim() ? newText : `${newText}${LF}` }
  }
  return { ok: false, message: `old text was not found. ${preview(original)}` }
}

/** The lines of `oldText` as the file has them, ignoring only their indentation. */
function matchLoose(original: string, oldText: string): { src: string[]; want: string[]; hits: number[] } | null {
  // Offsets are counted in the text as lines, which is only exact while the file uses one newline.
  if (original.includes(CRLF)) return null
  const want = textLines(oldText).map((line) => line.trim())
  while (want.length && !want[0]) want.shift()
  while (want.length && !want[want.length - 1]) want.pop()
  if (!want.length) return null
  const src = textLines(original)
  const trimmed = src.map((line) => line.trim())
  const hits: number[] = []
  for (let at = 0; at + want.length <= trimmed.length; at++) {
    if (want.every((line, step) => trimmed[at + step] === line)) hits.push(at)
  }
  return { src, want, hits }
}

function leading(line: string): string {
  const spaces = line.match(/^[ \t]*/)
  return spaces ? spaces[0] : ''
}

/** Move a block of new text from the indentation it was typed at to the one the file has. */
function reindent(lines: string[], indent: string): string[] {
  const base = lines.length ? leading(lines[0]!) : ''
  const delta = indent.length - base.length
  if (!delta) return lines
  return lines.map((line) => {
    if (!line.trim()) return line
    if (delta > 0) return ' '.repeat(delta) + line
    return line.slice(Math.min(-delta, leading(line).length))
  })
}

/** The head of the file, numbered: the text a model has to copy to land an edit at all. */
function preview(text: string): string {
  const lines = textLines(text)
  const shown = lines.slice(0, 6).map((line, at) => `${at + 1}|${line}`)
  const more = lines.length > shown.length ? `\n... ${lines.length - shown.length} more lines` : ''
  return `the file reads:\n${shown.join(LF)}${more}`
}
