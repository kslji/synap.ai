/**
 * Model text cleanup. JSON replies sometimes arrive inside ``` fences.
 * Fill-in-the-middle replies sometimes repeat the suffix and add an extra `}`.
 */

/** Pull the body out of a ``` fence when the model wrapped JSON or code. */
export function stripMarkdownFences(raw: string): string {
  const trimmed = raw.trim()
  const whole = trimmed.match(/^```(?:[A-Za-z0-9_-]+)?[ \t]*\r?\n?([\s\S]*?)\r?\n?```$/)
  if (whole) return whole[1].trim()
  const inner = trimmed.match(/```(?:[A-Za-z0-9_-]+)?[ \t]*\r?\n?([\s\S]*?)```/)
  if (inner) return inner[1].trim()
  return trimmed
}

/** Parse JSON from a model, including a fenced block or a JSON value buried in prose. */
export function parseModelJson(raw: string): unknown {
  const body = stripMarkdownFences(raw)
  try {
    return JSON.parse(body)
  } catch {
    const start = body.indexOf('{')
    const end = body.lastIndexOf('}')
    if (start >= 0 && end > start) return JSON.parse(body.slice(start, end + 1))
    const arrStart = body.indexOf('[')
    const arrEnd = body.lastIndexOf(']')
    if (arrStart >= 0 && arrEnd > arrStart) return JSON.parse(body.slice(arrStart, arrEnd + 1))
    throw new Error('model output was not JSON')
  }
}

export interface InfillContext {
  prefix?: string
  suffix?: string
}

/**
 * Drop a duplicated suffix, then drop extra closing braces the suffix already closes.
 * Brace counts ignore strings and comments.
 */
export function cleanInfill(completion: string, ctx: InfillContext = {}): string {
  let text = completion.replace(/\r\n/g, '\n')
  const suffix = (ctx.suffix ?? '').replace(/\r\n/g, '\n')
  const prefix = (ctx.prefix ?? '').replace(/\r\n/g, '\n')
  if (suffix.trim()) {
    while (text.endsWith(suffix)) text = text.slice(0, -suffix.length)
    text = stripSuffixOverlap(text, suffix)
  }
  return stripExtraClosers(prefix, text, suffix)
}

function stripSuffixOverlap(text: string, suffix: string): string {
  const max = Math.min(text.length, suffix.length)
  for (let n = max; n > 0; n--) {
    const piece = suffix.slice(0, n)
    if (!text.endsWith(piece)) continue
    if (!piece.trim()) continue
    return text.slice(0, -n)
  }
  return text
}

function stripExtraClosers(prefix: string, text: string, suffix: string): string {
  if (!suffix.includes('}')) return text
  const base = braceDepth(prefix)
  let body = text
  while (braceDepth(prefix + body) < base && /\}[ \t]*\n?$/.test(body)) {
    body = body.replace(/[ \t]*\}[ \t]*\n?$/, '')
  }
  return body
}

/** Net `{` minus `}` in code. Strings and comments do not count. */
export function braceDepth(source: string): number {
  let depth = 0
  let i = 0
  let mode: 'code' | 'line' | 'block' | 'sq' | 'dq' | 'bt' = 'code'
  while (i < source.length) {
    const c = source[i]
    const n = source[i + 1]
    if (mode === 'line') {
      if (c === '\n') mode = 'code'
      i++
      continue
    }
    if (mode === 'block') {
      if (c === '*' && n === '/') { mode = 'code'; i += 2; continue }
      i++
      continue
    }
    if (mode === 'sq' || mode === 'dq' || mode === 'bt') {
      if (c === '\\') { i += 2; continue }
      const end = mode === 'sq' ? "'" : mode === 'dq' ? '"' : '`'
      if (c === end) mode = 'code'
      i++
      continue
    }
    if (c === '/' && n === '/') { mode = 'line'; i += 2; continue }
    if (c === '/' && n === '*') { mode = 'block'; i += 2; continue }
    if (c === "'") { mode = 'sq'; i++; continue }
    if (c === '"') { mode = 'dq'; i++; continue }
    if (c === '`') { mode = 'bt'; i++; continue }
    if (c === '{') depth++
    else if (c === '}') depth--
    i++
  }
  return depth
}
