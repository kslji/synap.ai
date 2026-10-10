/**
 * Main-process log. A closed terminal (EPIPE / EIO on stdout) must not crash the app.
 * Lines also go to a small rotating file under userData/logs.
 */
import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { EventEmitter } from 'node:events'

const MAX_BYTES = 512 * 1024
const KEEP = 3

export function isClosedPipe(err: unknown): boolean {
  const code = typeof err === 'object' && err !== null && 'code' in err ? String((err as { code: unknown }).code) : ''
  if (code === 'EPIPE' || code === 'EIO') return true
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  return message.includes('EPIPE') || message.includes('EIO')
}

function isBenign(err: unknown): boolean {
  if (isClosedPipe(err)) return true
  return err instanceof Error && err.name === 'AbortError'
}

/** Ignore EPIPE and EIO. Any other stream error is still raised. */
export function attachPipeGuard(stream: EventEmitter): void {
  stream.on('error', (err: unknown) => {
    if (isClosedPipe(err)) return
    throw err instanceof Error ? err : new Error(String(err))
  })
}

export interface FileLog {
  path: string
  write(line: string): void
}

export function createRotatingLog(dir: string, name = 'main.log'): FileLog {
  mkdirSync(dir, { recursive: true })
  const path = join(dir, name)
  return {
    path,
    write(line: string) {
      try {
        rotate(path)
        appendFileSync(path, line.endsWith('\n') ? line : `${line}\n`)
      } catch {
        /* a full disk must not take down the app */
      }
    },
  }
}

function rotate(path: string): void {
  let size = 0
  try { size = statSync(path).size } catch { return }
  if (size < MAX_BYTES) return
  const stem = path.replace(/\.log$/, '')
  rmSync(`${stem}.${KEEP}.log`, { force: true })
  for (let i = KEEP - 1; i >= 1; i--) {
    try { renameSync(`${stem}.${i}.log`, `${stem}.${i + 1}.log`) } catch { /* that slot is empty */ }
  }
  try { renameSync(path, `${stem}.1.log`) } catch { /* another writer rotated first */ }
}

function formatArg(value: unknown): string {
  if (value instanceof Error) return value.stack || value.message
  if (typeof value === 'string') return value
  try { return JSON.stringify(value) } catch { return String(value) }
}

let consolePatched = false

export function installMainLog(dir: string): FileLog {
  const log = createRotatingLog(dir)
  attachPipeGuard(process.stdout)
  attachPipeGuard(process.stderr)
  if (consolePatched) return log
  consolePatched = true
  const wrap = (level: string, fn: (...args: unknown[]) => void) => (...args: unknown[]) => {
    log.write(`${new Date().toISOString()} ${level} ${args.map(formatArg).join(' ')}`)
    try { fn.apply(console, args) } catch (err) {
      if (!isClosedPipe(err)) throw err
    }
  }
  console.log = wrap('info', console.log)
  console.warn = wrap('warn', console.warn)
  console.error = wrap('error', console.error)
  return log
}

let guardsInstalled = false
let dialogShown = false

export function installProcessGuards(log: FileLog, notify: (message: string) => void): void {
  if (guardsInstalled) return
  guardsInstalled = true
  const record = (kind: string, err: unknown): Error => {
    const error = err instanceof Error ? err : new Error(typeof err === 'string' ? err : String(err))
    log.write(`${new Date().toISOString()} ${kind} ${error.stack || error.message}`)
    return error
  }
  const friendly = 'Synap.surf hit a problem and saved the details in its log. You can keep using the app, or quit and open it again.'
  process.on('uncaughtException', (err) => {
    const error = record('uncaughtException', err)
    if (isBenign(error) || dialogShown) return
    dialogShown = true
    try { notify(friendly) } catch { /* no display */ }
  })
  process.on('unhandledRejection', (reason) => {
    const error = record('unhandledRejection', reason)
    if (isBenign(error) || dialogShown) return
    dialogShown = true
    try { notify(friendly) } catch { /* no display */ }
  })
}
