/**
 * Run a check inside the project folder.
 * Callers must pass the Ask/Auto gate first. This module does not decide permission.
 *
 * Network isolation is best-effort and depends on the OS:
 * - macOS: `sandbox-exec` profile that denies network, when the tool exists and the probe succeeds.
 * - Linux: `bwrap --unshare-net` when present, otherwise `unshare --net` when the kernel allows it.
 * - Windows: a job object with kill-on-close, plus a scrubbed environment. Windows does not
 *   isolate the network here.
 * If the helper is missing or the probe fails, the command still runs with the working
 * directory locked to the project and a scrubbed environment. The result note says so.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WINDOWS_JOB_SCRIPT } from './windows-job.js'

export const SANDBOX_TIMEOUT_MS = 20_000
export const CHECK_TIMEOUT_MS = 60_000
export const SANDBOX_OUTPUT_CAP = 64_000

export type SandboxKind = 'macos-sandbox-exec' | 'linux-bwrap' | 'linux-unshare' | 'windows-job' | 'fallback'

export interface SandboxTools {
  sandboxExec: boolean
  bwrap: boolean
  unshare: boolean
}

export interface SandboxChoice {
  kind: SandboxKind
  note: string
}

export interface SandboxOptions {
  cwd: string
  command: string
  timeoutMs?: number
  outputCap?: number
  signal?: AbortSignal
  onOutput?: (chunk: string) => void
  /** Force a backend. Tests use `fallback` so they do not depend on bwrap. */
  kind?: SandboxKind
  env?: NodeJS.ProcessEnv
}

export interface SandboxResult {
  ok: boolean
  output: string
  exitCode: number | null
  timedOut: boolean
  truncated: boolean
  killed: boolean
  kind: SandboxKind
  note: string
}

const KEEP_ENV = [
  'PATH', 'Path', 'PATHEXT',
  'HOME', 'USER', 'USERNAME', 'LOGNAME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH',
  'LANG', 'LC_ALL', 'LC_CTYPE', 'LANGUAGE',
  'TMPDIR', 'TMP', 'TEMP',
  'SystemRoot', 'SYSTEMROOT', 'windir', 'COMSPEC', 'ComSpec',
  'SHELL', 'TERM', 'COLORTERM',
  'APPDATA', 'LOCALAPPDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)',
  'SYSTEMDRIVE', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'OS',
  'PYTHONPATH', 'PYTHONHOME', 'VIRTUAL_ENV',
  'CI',
]

const SECRET_KEY = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|PRIVATE|SESSION|COOKIE|AUTH|AWS_|GCP_|GOOGLE_|GITHUB_|GH_|NPM_|HUGGING|OPENAI|ANTHROPIC|DATABASE_URL|DSN|BEARER)/i

let cachedChoice: SandboxChoice | null = null

export function selectSandbox(platform: NodeJS.Platform, tools: SandboxTools): SandboxChoice {
  if (platform === 'darwin' && tools.sandboxExec) {
    return {
      kind: 'macos-sandbox-exec',
      note: 'Network is denied by a sandbox-exec profile when the probe succeeds. File writes stay in the project and temporary directories. This is best-effort.',
    }
  }
  if (platform === 'linux' && tools.bwrap) {
    return {
      kind: 'linux-bwrap',
      note: 'Network is disabled with bwrap --unshare-net when the probe succeeds. This is best-effort and falls back if bwrap cannot start.',
    }
  }
  if (platform === 'linux' && tools.unshare) {
    return {
      kind: 'linux-unshare',
      note: 'Network is disabled with unshare --net when the kernel allows a user namespace. This is best-effort and falls back if unshare is refused.',
    }
  }
  if (platform === 'win32') {
    return {
      kind: 'windows-job',
      note: 'The process runs in a Windows job object so the tree dies on timeout. Network is not isolated on Windows. The environment is scrubbed. This is best-effort.',
    }
  }
  if (platform === 'darwin') {
    return { kind: 'fallback', note: 'sandbox-exec is not available. Network was not disabled. The working directory is the project and the environment is scrubbed. This is best-effort.' }
  }
  if (platform === 'linux') {
    return { kind: 'fallback', note: 'bwrap and unshare are not available. Network was not disabled. The working directory is the project and the environment is scrubbed. This is best-effort.' }
  }
  return { kind: 'fallback', note: 'No OS network sandbox is available. Network was not disabled. The working directory is the project and the environment is scrubbed. This is best-effort.' }
}

export function noteFor(kind: SandboxKind): string {
  if (kind === 'fallback') {
    return 'No OS network sandbox was applied. Network was not disabled. The working directory is locked to the project folder and the environment is scrubbed. This is best-effort.'
  }
  return selectSandbox(
    kind === 'macos-sandbox-exec' ? 'darwin' : kind === 'windows-job' ? 'win32' : 'linux',
    {
      sandboxExec: kind === 'macos-sandbox-exec',
      bwrap: kind === 'linux-bwrap',
      unshare: kind === 'linux-unshare',
    },
  ).note
}

/** Copy an allow-list of environment variables and drop anything that looks like a secret. */
export function scrubEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const key of KEEP_ENV) {
    if (SECRET_KEY.test(key)) continue
    const value = source[key]
    if (typeof value !== 'string' || !value) continue
    out[key] = value
  }
  return out
}

export function resolveSandbox(): SandboxChoice {
  if (cachedChoice) return cachedChoice
  const tools = detectTools()
  let choice = selectSandbox(process.platform, tools)
  if (choice.kind === 'linux-bwrap' && !probe(['bwrap', '--unshare-net', '--die-with-parent', '--ro-bind', '/', '/', '--', 'true'])) {
    choice = selectSandbox(process.platform, { ...tools, bwrap: false })
  }
  if (choice.kind === 'linux-unshare' && !probe(['unshare', '--net', '--', 'true'])) {
    choice = selectSandbox(process.platform, { sandboxExec: false, bwrap: false, unshare: false })
  }
  if (choice.kind === 'macos-sandbox-exec' && !probe(['sandbox-exec', '-p', '(version 1)(allow default)', 'true'])) {
    choice = selectSandbox('darwin', { sandboxExec: false, bwrap: false, unshare: false })
  }
  cachedChoice = choice
  return choice
}

export async function runSandboxed(options: SandboxOptions): Promise<SandboxResult> {
  const choice = options.kind ? { kind: options.kind, note: noteFor(options.kind) } : resolveSandbox()
  const first = await launch(choice.kind, options)
  if (first.wrapperFailed && choice.kind !== 'fallback') {
    const second = await launch('fallback', options)
    return {
      ...second,
      kind: 'fallback',
      note: `${choice.note} The helper did not start. Fell back to a scrubbed environment with the working directory locked to the project. Network was not disabled.`,
    }
  }
  return { ...first, kind: choice.kind, note: choice.note }
}

interface LaunchResult {
  ok: boolean
  output: string
  exitCode: number | null
  timedOut: boolean
  truncated: boolean
  killed: boolean
  wrapperFailed: boolean
}

async function launch(kind: SandboxKind, options: SandboxOptions): Promise<LaunchResult> {
  const { splitCommand } = await import('./workspace.js')
  const split = splitCommand(options.command)
  if (!split.ok) {
    return { ok: false, output: split.reason, exitCode: null, timedOut: false, truncated: false, killed: false, wrapperFailed: false }
  }
  let cwd = options.cwd
  try { cwd = realpathSync(options.cwd) } catch {
    return { ok: false, output: 'project folder is not available', exitCode: null, timedOut: false, truncated: false, killed: false, wrapperFailed: false }
  }
  const cap = options.outputCap ?? SANDBOX_OUTPUT_CAP
  const timeoutMs = options.timeoutMs ?? SANDBOX_TIMEOUT_MS
  const env = scrubEnv(options.env ?? process.env)
  const wrapped = wrap(kind, split.argv, cwd)
  return await new Promise((resolve) => {
    let child: ChildProcess
    try {
      child = spawn(wrapped.file, wrapped.args, {
        cwd,
        env,
        shell: false,
        windowsHide: true,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      resolve({ ok: false, output: message, exitCode: null, timedOut: false, truncated: false, killed: false, wrapperFailed: kind !== 'fallback' })
      return
    }
    let output = ''
    let truncated = false
    let timedOut = false
    let killed = false
    let settled = false
    const take = (chunk: Buffer) => {
      const text = chunk.toString('utf8')
      if (output.length >= cap) {
        truncated = true
        killTree()
        return
      }
      const room = cap - output.length
      const slice = text.slice(0, room)
      output += slice
      options.onOutput?.(slice)
      if (text.length > room) {
        truncated = true
        killTree()
      }
    }
    const killTree = () => {
      if (killed) return
      killed = true
      const pid = child.pid
      if (!pid) return
      if (process.platform === 'win32') {
        spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
        return
      }
      try { process.kill(-pid, 'SIGKILL') } catch { /* the group may already be gone */ }
      try { child.kill('SIGKILL') } catch { /* already gone */ }
    }
    const finish = (exitCode: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearTimeout(force)
      options.signal?.removeEventListener('abort', onAbort)
      if (timedOut) output = `${output}\n[timed out]`.trim()
      if (truncated) output = `${output}\n[output truncated]`.trim()
      resolve({
        ok: exitCode === 0 && !timedOut && !truncated,
        output,
        exitCode,
        timedOut,
        truncated,
        killed,
        wrapperFailed: false,
      })
    }
    const timer = setTimeout(() => {
      timedOut = true
      killTree()
    }, timeoutMs)
    const force = setTimeout(() => finish(null), timeoutMs + 1_000)
    const onAbort = () => killTree()
    options.signal?.addEventListener('abort', onAbort, { once: true })
    child.stdout?.on('data', take)
    child.stderr?.on('data', take)
    child.on('error', (error) => {
      output = output || error.message
      const missing = /ENOENT/.test(error.message)
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearTimeout(force)
      options.signal?.removeEventListener('abort', onAbort)
      resolve({
        ok: false,
        output,
        exitCode: null,
        timedOut: false,
        truncated: false,
        killed,
        wrapperFailed: kind !== 'fallback' && missing,
      })
    })
    child.on('close', (code) => finish(code))
  })
}

function wrap(kind: SandboxKind, argv: string[], cwd: string): { file: string; args: string[] } {
  if (kind === 'linux-bwrap') {
    return {
      file: 'bwrap',
      args: [
        '--unshare-net', '--die-with-parent',
        '--ro-bind', '/', '/',
        '--tmpfs', '/tmp',
        '--bind', cwd, cwd,
        '--dev', '/dev',
        '--proc', '/proc',
        '--chdir', cwd,
        '--',
        ...argv,
      ],
    }
  }
  if (kind === 'linux-unshare') return { file: 'unshare', args: ['--net', '--', ...argv] }
  if (kind === 'macos-sandbox-exec') {
    const dir = mkdtempSync(join(tmpdir(), 'surf-sandbox-'))
    const profile = join(dir, 'profile.sb')
    writeFileSync(profile, macosProfile(cwd))
    return { file: 'sandbox-exec', args: ['-f', profile, ...argv] }
  }
  if (kind === 'windows-job' && process.platform === 'win32') {
    const dir = mkdtempSync(join(tmpdir(), 'surf-sandbox-'))
    const script = join(dir, 'job.ps1')
    writeFileSync(script, WINDOWS_JOB_SCRIPT)
    const payload = Buffer.from(JSON.stringify(argv), 'utf8').toString('base64')
    return {
      file: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, payload],
    }
  }
  return { file: argv[0] ?? '', args: argv.slice(1) }
}

function macosProfile(cwd: string): string {
  const esc = cwd.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return `(version 1)
(deny default)
(allow process*)
(allow signal)
(allow sysctl-read)
(allow mach*)
(allow ipc-posix*)
(allow file-read*)
(allow file-write*
  (subpath "${esc}")
  (subpath "/tmp")
  (subpath "/private/tmp")
  (subpath "/private/var/folders")
  (subpath "/var/folders"))
(deny network*)
`
}

function detectTools(): SandboxTools {
  return {
    sandboxExec: process.platform === 'darwin' && toolExists('sandbox-exec'),
    bwrap: process.platform === 'linux' && toolExists('bwrap'),
    unshare: process.platform === 'linux' && toolExists('unshare'),
  }
}

function toolExists(name: string): boolean {
  const finder = process.platform === 'win32' ? 'where' : 'which'
  const found = spawnSync(finder, [name], { stdio: 'ignore', windowsHide: true })
  return found.status === 0
}

function probe(argv: string[]): boolean {
  const found = spawnSync(argv[0] ?? '', argv.slice(1), { stdio: 'ignore', timeout: 2_000, windowsHide: true })
  return found.status === 0
}
