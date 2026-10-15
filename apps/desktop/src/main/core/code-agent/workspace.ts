/**
 * Read, list, and run inside one project folder.
 * Commands are one program plus arguments. There is no shell.
 */
import { spawn } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { relative, sep } from 'node:path'
import { resolveInside } from './paths.js'

const MAX_READ_BYTES = 256 * 1024
const MAX_READ_LINES = 200
const COMMAND_TIMEOUT_MS = 20_000
const COMMAND_OUTPUT_CAP = 16_000

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

export function runProjectCommand(root: string, command: string, signal?: AbortSignal): Promise<{ ok: boolean; output: string }> {
  const split = splitCommand(command)
  if (!split.ok) return Promise.resolve({ ok: false, output: split.reason })
  return new Promise((resolve) => {
    const child = spawn(split.argv[0] ?? '', split.argv.slice(1), {
      cwd: root,
      shell: false,
      windowsHide: true,
    })
    let out = ''
    const take = (chunk: Buffer) => {
      if (out.length >= COMMAND_OUTPUT_CAP) return
      out += chunk.toString('utf8').slice(0, COMMAND_OUTPUT_CAP - out.length)
    }
    child.stdout?.on('data', take)
    child.stderr?.on('data', take)
    const timer = setTimeout(() => { child.kill() }, COMMAND_TIMEOUT_MS)
    const onAbort = () => child.kill()
    signal?.addEventListener('abort', onAbort, { once: true })
    const done = (ok: boolean, output: string) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      resolve({ ok, output })
    }
    child.on('error', (error) => done(false, error.message))
    child.on('close', (code) => done(code === 0, out || `exit ${code ?? 'unknown'}`))
  })
}

function clampLine(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) return fallback
  return value
}
