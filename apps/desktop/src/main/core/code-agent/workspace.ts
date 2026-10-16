/**
 * Read, list, and run inside one project folder.
 * Commands are one program plus arguments. There is no shell.
 * Every command goes through the sandbox. Callers still have to pass the Ask/Auto gate first.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { relative, sep } from 'node:path'
import { resolveInside } from './paths.js'
import { CHECK_TIMEOUT_MS, runSandboxed, SANDBOX_OUTPUT_CAP, SANDBOX_TIMEOUT_MS, type SandboxKind } from './sandbox.js'

const MAX_READ_BYTES = 256 * 1024
const MAX_READ_LINES = 200

export interface CommandHooks {
  onOutput?: (chunk: string) => void
}

export interface CommandResult {
  ok: boolean
  output: string
  note?: string
  timedOut?: boolean
  truncated?: boolean
}

export function splitCommand(input: string): { ok: true; argv: string[] } | { ok: false; reason: string } {
  const trimmed = input.trim()
  if (!trimmed) return { ok: false, reason: 'command is empty' }
  if (/[\n\r|&;<>`$\\]/.test(trimmed) || trimmed.includes('$(')) {
    return { ok: false, reason: 'shell syntax is not allowed; pass one program and its arguments' }
  }
  const argv: string[] = []
  let cur = ''
  let quote: '"' | "'" | null = null
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i] ?? ''
    if (quote) {
      if (ch === quote) quote = null
      else cur += ch
      continue
    }
    if (ch === '"' || ch === "'") { quote = ch; continue }
    if (ch === ' ' || ch === '\t') {
      if (cur) { argv.push(cur); cur = '' }
      continue
    }
    cur += ch
  }
  if (quote) return { ok: false, reason: 'command has an unmatched quote' }
  if (cur) argv.push(cur)
  const file = argv[0]
  if (!file) return { ok: false, reason: 'command is empty' }
  if (file.includes('..')) return { ok: false, reason: 'command path cannot contain ..' }
  return { ok: true, argv }
}

export function readProjectFile(root: string, args: Record<string, unknown>): string {
  const rel = typeof args.path === 'string' ? args.path : ''
  const abs = resolveInside(root, rel)
  if (!abs) return 'error: path is outside the project'
  let info
  try { info = statSync(abs) } catch { return 'error: file not found' }
  if (!info.isFile()) return 'error: path is not a file'
  if (info.size > MAX_READ_BYTES) return 'error: file is too large to read'
  const text = readFileSync(abs, 'utf8')
  if (text.includes('\u0000')) return 'error: file is not text'
  const lines = text.split(/\r?\n/)
  const start = clampLine(args.start_line, 1)
  const end = clampLine(args.end_line, lines.length)
  const from = Math.max(1, Math.min(start, lines.length || 1))
  const to = Math.max(from, Math.min(end, lines.length))
  const capped = Math.min(to, from + MAX_READ_LINES - 1)
  const body = lines.slice(from - 1, capped).map((line, index) => `${from + index}|${line}`).join('\n')
  const note = capped < to || to < lines.length ? `\n(${lines.length} lines; showing ${from}-${capped})` : ''
  return `${relative(root, abs).split(sep).join('/')}\n${body}${note}`
}

export function listProjectDir(root: string, args: Record<string, unknown>): string {
  const rel = typeof args.path === 'string' && args.path.trim() ? args.path : '.'
  const abs = resolveInside(root, rel)
  if (!abs) return 'error: path is outside the project'
  let info
  try { info = statSync(abs) } catch { return 'error: directory not found' }
  if (!info.isDirectory()) return 'error: path is not a directory'
  const entries = readdirSync(abs, { withFileTypes: true })
  const shown = entries.slice(0, 200).map((entry) => {
    if (entry.isSymbolicLink()) return `${entry.name}@`
    if (entry.isDirectory()) return `${entry.name}/`
    return entry.name
  })
  const more = entries.length > shown.length ? `\n… ${entries.length - shown.length} more` : ''
  const label = relative(root, abs).split(sep).join('/') || '.'
  return `${label}\n${shown.join('\n')}${more}`
}

export function runProjectCommand(
  root: string,
  command: string,
  signal?: AbortSignal,
  hooks?: CommandHooks,
  options?: { timeoutMs?: number; outputCap?: number; kind?: SandboxKind },
): Promise<CommandResult> {
  return runSandboxed({
    cwd: root,
    command,
    signal,
    onOutput: hooks?.onOutput,
    timeoutMs: options?.timeoutMs ?? SANDBOX_TIMEOUT_MS,
    outputCap: options?.outputCap ?? SANDBOX_OUTPUT_CAP,
    kind: options?.kind,
  }).then((result) => ({
    ok: result.ok,
    output: result.output,
    note: result.note,
    timedOut: result.timedOut,
    truncated: result.truncated,
  }))
}

export { CHECK_TIMEOUT_MS }

function clampLine(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) return fallback
  return value
}
