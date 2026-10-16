/**
 * Turn compiler, test, and lint output into diagnostics.
 * The fix loop sends these, not the raw log, to the model.
 */
export type DiagnosticSource = 'tsc' | 'eslint' | 'pytest' | 'ruff' | 'pyright' | 'mypy' | 'go' | 'cargo' | 'vitest'

export interface Diagnostic {
  file: string
  line: number
  column: number
  message: string
  rule: string
  source: DiagnosticSource
}

export function parseCommandDiagnostics(command: string, output: string, root?: string): Diagnostic[] {
  const found = [
    ...parseTsc(output, root),
    ...parseEslint(output, root),
    ...parsePytest(output, root),
    ...parseRuff(output, root),
    ...parsePyright(output, root),
    ...parseMypy(output, root),
    ...parseGo(output, root),
    ...parseCargo(output, root),
  ]
  if (/\b(vitest|jest)\b/.test(command)) found.push(...parseVitest(output, root))
  return dedupe(found)
}

export function diagnosticKey(item: Diagnostic): string {
  return [item.file, item.line, item.column, item.rule, item.message].join('\0')
}

function parseTsc(output: string, root?: string): Diagnostic[] {
  const out: Diagnostic[] = []
  const paren = /^(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.+)$/
  const pretty = /^(.+?):(\d+):(\d+)\s+-\s+error\s+(TS\d+):\s+(.+)$/
  for (const line of lines(output)) {
    const match = paren.exec(line) ?? pretty.exec(line)
    if (!match) continue
    const file = match[1] ?? ''
    if (!/\.(?:[cm]?[jt]sx?)$/.test(file)) continue
    out.push(diag(file, match[2], match[3], match[5] ?? '', match[4] ?? '', 'tsc', root))
  }
  return out
}

function parseEslint(output: string, root?: string): Diagnostic[] {
  const out: Diagnostic[] = []
  let current = ''
  const item = /^\s*(\d+):(\d+)\s+error\s+(.+?)\s{2,}(\S+)\s*$/
  const unix = /^(.+?):(\d+):(\d+):\s+(.+?)\s+\(([^)]+)\)\s*$/
  for (const line of lines(output)) {
    const unixMatch = unix.exec(line)
    if (unixMatch) {
      out.push(diag(unixMatch[1] ?? '', unixMatch[2], unixMatch[3], unixMatch[4] ?? '', unixMatch[5] ?? '', 'eslint', root))
      continue
    }
    const problem = item.exec(line)
    if (problem && current) {
      out.push(diag(current, problem[1], problem[2], problem[3] ?? '', problem[4] ?? '', 'eslint', root))
      continue
    }
    if (/^\s/.test(line) || !line || line.startsWith('✖') || line.includes(' problem')) continue
    if (/\.[a-zA-Z0-9]+$/.test(line)) current = line
  }
  return out
}

function parsePytest(output: string, root?: string): Diagnostic[] {
  const out: Diagnostic[] = []
  const failed = /^FAILED\s+(\S+\.py)(?:::(\S+))?\s+-\s+(.+)$/
  const located = /^(\S+\.py):(\d+):\s+([A-Za-z].+)$/
  let pending = ''
  for (const line of lines(output)) {
    if (/^E\s+/.test(line)) {
      pending = line.replace(/^E\s+/, '').trim()
      continue
    }
    const fail = failed.exec(line)
    if (fail) {
      out.push(diag(fail[1] ?? '', '1', '1', fail[3] ?? '', 'FAILED', 'pytest', root))
      continue
    }
    const at = located.exec(line)
    if (!at) continue
    const message = at[3] ?? ''
    if (/^(error|warning|note):/.test(message)) continue
    out.push(diag(at[1] ?? '', at[2], '1', pending || message, 'AssertionError', 'pytest', root))
    pending = ''
  }
  return out
}

function parseRuff(output: string, root?: string): Diagnostic[] {
  const out: Diagnostic[] = []
  const pattern = /^(\S+):(\d+):(\d+):\s+([A-Z]{1,4}\d{3,4})\s+(?:\[\*\]\s+)?(.+)$/
  for (const line of lines(output)) {
    const match = pattern.exec(line)
    if (!match || !/\.py$/.test(match[1] ?? '')) continue
    out.push(diag(match[1] ?? '', match[2], match[3], match[5] ?? '', match[4] ?? '', 'ruff', root))
  }
  return out
}

function parsePyright(output: string, root?: string): Diagnostic[] {
  const out: Diagnostic[] = []
  const pattern = /^(\S+\.py):(\d+):(\d+)\s+-\s+error:\s+(.+?)(?:\s+\(([^)]+)\))?\s*$/
  for (const line of lines(output)) {
    const match = pattern.exec(line)
    if (!match) continue
    out.push(diag(match[1] ?? '', match[2], match[3], match[4] ?? '', match[5] ?? 'error', 'pyright', root))
  }
  return out
}

function parseMypy(output: string, root?: string): Diagnostic[] {
  const out: Diagnostic[] = []
  const pattern = /^(\S+\.py):(\d+):\s+error:\s+(.+?)(?:\s+\[([^\]]+)\])?\s*$/
  for (const line of lines(output)) {
    const match = pattern.exec(line)
    if (!match) continue
    out.push(diag(match[1] ?? '', match[2], '1', match[3] ?? '', match[4] ?? 'error', 'mypy', root))
  }
  return out
}

function parseGo(output: string, root?: string): Diagnostic[] {
  const out: Diagnostic[] = []
  const compile = /^(\S+\.go):(\d+):(\d+):\s+(.+)$/
  const test = /^\s+(\S+\.go):(\d+):\s+(\D.*)$/
  for (const line of lines(output)) {
    const compiled = compile.exec(line)
    if (compiled) {
      out.push(diag(compiled[1] ?? '', compiled[2], compiled[3], compiled[4] ?? '', 'go', 'go', root))
      continue
    }
    const failed = test.exec(line)
    if (failed) out.push(diag(failed[1] ?? '', failed[2], '1', failed[3] ?? '', 'FAIL', 'go', root))
  }
  return out
}

function parseCargo(output: string, root?: string): Diagnostic[] {
  const out: Diagnostic[] = []
  const errorLine = /^error(?:\[(E\d+)\])?:\s*(.*)$/
  const loc = /^\s*-->\s+(\S+):(\d+):(\d+)/
  const panicNew = /^thread '.+' panicked at (\S+):(\d+):(\d+):?\s*$/
  const panicOld = /^thread '.+' panicked at '(.+)', (\S+):(\d+):(\d+)/
  let pending: { rule: string; message: string } | null = null
  const all = lines(output)
  for (let i = 0; i < all.length; i++) {
    const line = all[i] ?? ''
    const old = panicOld.exec(line)
    if (old) {
      out.push(diag(old[2] ?? '', old[3], old[4], old[1] ?? 'panic', 'panic', 'cargo', root))
      continue
    }
    const panic = panicNew.exec(line)
    if (panic) {
      const message = (all[i + 1] ?? '').trim() || 'panic'
      out.push(diag(panic[1] ?? '', panic[2], panic[3], message, 'panic', 'cargo', root))
      continue
    }
    const err = errorLine.exec(line)
    if (err) {
      pending = { rule: err[1] ?? 'error', message: (err[2] ?? '').trim() || 'error' }
      continue
    }
    const at = loc.exec(line)
    if (at && pending) {
      out.push(diag(at[1] ?? '', at[2], at[3], pending.message, pending.rule, 'cargo', root))
      pending = null
    }
  }
  return out
}

function parseVitest(output: string, root?: string): Diagnostic[] {
  const out: Diagnostic[] = []
  const arrow = /^[❯>\s]*(\S+):(\d+):(\d+)\s*$/
  const at = /^\s*at .+\((.+):(\d+):(\d+)\)\s*$/
  let message = ''
  for (const line of lines(output)) {
    if (/AssertionError|Error:/.test(line) && !line.includes('at ')) message = line.trim()
    const match = arrow.exec(line) ?? at.exec(line)
    if (!match) continue
    out.push(diag(match[1] ?? '', match[2], match[3], message || 'test failed', 'test', 'vitest', root))
    message = ''
  }
  return out
}

function diag(file: string, line: string | undefined, column: string | undefined, message: string, rule: string, source: DiagnosticSource, root?: string): Diagnostic {
  return {
    file: relFile(file, root),
    line: numberOr(line, 1),
    column: numberOr(column, 1),
    message: message.replace(/\s+/g, ' ').trim(),
    rule: rule.trim(),
    source,
  }
}

function relFile(file: string, root?: string): string {
  let next = file.trim().replace(/\\/g, '/').replace(/^\.\//, '')
  if (root) {
    const base = root.trim().replace(/\\/g, '/').replace(/\/$/, '')
    if (base && next.startsWith(`${base}/`)) next = next.slice(base.length + 1)
  }
  return next
}

function numberOr(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) return fallback
  return parsed
}

function lines(output: string): string[] {
  return output.split(/\r?\n/).map((line) => line.trimEnd()).filter((line) => line.trim().length > 0)
}

function dedupe(items: Diagnostic[]): Diagnostic[] {
  const seen = new Set<string>()
  const out: Diagnostic[] = []
  for (const item of items) {
    const key = diagnosticKey(item)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}
