/**
 * Code agent helpers that do not need a model: symbol index, sandboxed JS,
 * diff approval, and the preview document. Python runs only when Pyodide is bundled.
 */
import { Worker } from 'node:worker_threads'
import { createHash, randomBytes } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, resolve, sep } from 'node:path'
import { filterParagraphs } from './injection.js'
import { previewDocument, type PreviewDoc } from '../../shared/preview-doc.js'

export { previewDocument, type PreviewDoc }

export interface SymbolChunk {
  path: string
  name: string
  kind: string
  text: string
}

const DECL = /^\s*(?:export\s+)?(?:async\s+)?(?:function|class|def|fn|func)\s+([A-Za-z_][\w]*)|^[\t ]*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_][\w]*)/gm

export function chunkSource(path: string, text: string): SymbolChunk[] {
  const chunks: SymbolChunk[] = []
  const lines = text.split(/\n/)
  let current: { name: string; start: number } | null = null
  const flush = (end: number) => {
    if (!current) return
    chunks.push({ path, name: current.name, kind: 'symbol', text: lines.slice(current.start, end).join('\n') })
    current = null
  }
  lines.forEach((line, index) => {
    DECL.lastIndex = 0
    const match = DECL.exec(line)
    const name = match?.[1] || match?.[2]
    if (!name) return
    flush(index)
    current = { name, start: index }
  })
  flush(lines.length)
  if (!chunks.length && text.trim()) chunks.push({ path, name: path.split('/').pop() ?? path, kind: 'file', text })
  return chunks
}

export function searchSymbols(chunks: SymbolChunk[], query: string): SymbolChunk[] {
  const terms = query.toLowerCase().split(/[^\p{L}\p{N}_]+/u).filter((term) => term.length > 1)
  const scored = chunks.map((chunk) => {
    const hay = `${chunk.path} ${chunk.name} ${chunk.text}`.toLowerCase()
    let score = 0
    for (const term of terms) {
      if (chunk.name.toLowerCase() === term) score += 5
      else if (chunk.name.toLowerCase().includes(term)) score += 3
      if (chunk.path.toLowerCase().includes(term)) score += 2
      if (hay.includes(term)) score += 1
    }
    return { chunk, score }
  })
  return scored.filter((row) => row.score > 0).sort((a, b) => b.score - a.score).map((row) => row.chunk)
}

const CODE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.go', '.java', '.kt', '.kts', '.swift', '.cpp', '.cc', '.c', '.h', '.hpp'])

export function indexProject(root: string, limit = 80): SymbolChunk[] {
  const chunks: SymbolChunk[] = []
  const stack = [resolve(root)]
  while (stack.length && chunks.length < limit) {
    const dir = stack.pop()
    if (!dir) break
    let entries: { name: string; isSymbolicLink: () => boolean; isDirectory: () => boolean }[]
    try { entries = readdirSync(dir, { withFileTypes: true, encoding: 'utf8' }) } catch { continue }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name.startsWith('.')) continue
      const path = join(dir, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) { stack.push(path); continue }
      if (!CODE_EXT.has(extname(entry.name).toLowerCase())) continue
      try {
        if (statSync(path).size > 200_000) continue
        chunks.push(...chunkSource(path, readFileSync(path, 'utf8')))
      } catch { continue }
      if (chunks.length >= limit) break
    }
  }
  return chunks.slice(0, limit)
}

export function insideRoot(root: string, target: string): boolean {
  const base = resolve(root)
  const resolved = resolve(base, target)
  return resolved === base || resolved.startsWith(base.endsWith(sep) ? base : base + sep)
}

const ALLOWED_LICENSE = /^(apache-2\.0|mit)$/i

export interface LicenseNote {
  path: string
  name: string
  license: string
  allowed: boolean
}

export function readLicenses(root: string, limit = 40): LicenseNote[] {
  const notes: LicenseNote[] = []
  const stack = [resolve(root)]
  let visits = 0
  while (stack.length && notes.length < limit && visits < 250) {
    visits += 1
    const dir = stack.pop()
    if (!dir) break
    let entries: { name: string; isSymbolicLink: () => boolean; isDirectory: () => boolean }[]
    try { entries = readdirSync(dir, { withFileTypes: true, encoding: 'utf8' }) } catch { continue }
    for (const entry of entries) {
      if (entry.name === '.git' || entry.name.startsWith('.')) continue
      const path = join(dir, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') stack.push(path)
        else if (notes.length < 8) stack.push(path)
        continue
      }
      if (entry.name !== 'package.json') continue
      try {
        const parsed = JSON.parse(readFileSync(path, 'utf8')) as { name?: string; license?: unknown }
        const license = typeof parsed.license === 'string' ? parsed.license : ''
        if (!license) continue
        notes.push({
          path,
          name: typeof parsed.name === 'string' ? parsed.name : entry.name,
          license,
          allowed: ALLOWED_LICENSE.test(license.trim()),
        })
      } catch { continue }
      if (notes.length >= limit) break
    }
  }
  return notes
}

export interface EditProposal {
  id: string
  path: string
  before: string
  after: string
  diff: string
}

export function proposeEdit(path: string, before: string, after: string): EditProposal {
  return {
    id: createHash('sha256').update(`${path}\n${after}`).digest('hex').slice(0, 12),
    path,
    before,
    after,
    diff: `--- ${path}\n+++ ${path}\n${after.split('\n').map((line) => `+${line}`).join('\n')}`,
  }
}

export function applyEdit(proposal: EditProposal, approved: boolean): { written: boolean; text: string } {
  if (!approved) return { written: false, text: proposal.before }
  return { written: true, text: proposal.after }
}

export interface RunResult {
  executed: boolean
  result?: string
  error?: string
  language: string
}

export async function runCode(language: string, code: string, timeoutMs = 800): Promise<RunResult> {
  const lang = language.toLowerCase()
  if (lang === 'python' || lang === 'py') {
    const { runPython } = await import('./pyodide-runner.js')
    return runPython(code, { runTimeoutMs: Math.max(timeoutMs, 1500) })
  }
  if (lang !== 'javascript' && lang !== 'js') {
    return { executed: false, language: lang, error: `${language} is explained, not executed. The sandbox runs JavaScript only.` }
  }
  return runJavaScript(code, timeoutMs)
}

const WORKER_SOURCE = `
const { parentPort } = require('node:worker_threads')
parentPort.on('message', (message) => {
  try {
    globalThis.fetch = undefined
    const fn = new Function('"use strict";\\n' + String(message.code))
    const value = fn()
    parentPort.postMessage({ ok: true, result: value === undefined ? '' : String(value) })
  } catch (error) {
    parentPort.postMessage({ ok: false, error: String(error && error.message || error) })
  }
})
`

function runJavaScript(code: string, timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve) => {
    const worker = new Worker(WORKER_SOURCE, { eval: true })
    const timer = setTimeout(() => {
      void worker.terminate()
      resolve({ executed: false, language: 'javascript', error: 'timed out' })
    }, timeoutMs)
    worker.once('message', (message: { ok: boolean; result?: string; error?: string }) => {
      clearTimeout(timer)
      void worker.terminate()
      if (!message.ok) resolve({ executed: false, language: 'javascript', error: message.error ?? 'failed' })
      else resolve({ executed: true, language: 'javascript', result: message.result ?? '' })
    })
    worker.once('error', (error) => {
      clearTimeout(timer)
      resolve({ executed: false, language: 'javascript', error: error.message })
    })
    worker.postMessage({ code })
  })
}

export function cleanUntrusted(text: string): string {
  return filterParagraphs(text).text
}

export function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

export function mcpAllowed(url: string, allow: string[]): boolean {
  try {
    const host = new URL(url).hostname
    return allow.some((item) => item === host || item === url)
  } catch {
    return false
  }
}
