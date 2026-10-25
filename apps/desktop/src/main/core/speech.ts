/**
 * Read a reply aloud on this computer. The text is passed to the operating
 * system voice. It is not uploaded and it is not written to a log.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { clipWords, SPEAK_LIMIT } from '../../shared/reply-text.js'

export const NO_VOICE = 'No system voice is available on this computer.'

/** Long enough for any OS voice to start a short line, short enough that a wedged one is killed. */
export const SPEAK_TIMEOUT_MS = 45_000

const DETAIL_LIMIT = 2_000

let child: ChildProcess | null = null
let stoppedByUser = false
let generation = 0
let lastDetail = ''

function powershellQuote(text: string): string {
  return `'${text.replace(/'/g, "''")}'`
}

/** Windows PowerShell reads -EncodedCommand as UTF-16LE base64, so the spoken line is not split by the shell. */
export function encodePowerShell(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64')
}

export function speakArgs(platform: NodeJS.Platform, text: string): { file: string; args: string[] } | null {
  const clean = clipWords(text, SPEAK_LIMIT)
  if (!clean) return null
  if (platform === 'darwin') return { file: 'say', args: [clean] }
  if (platform === 'win32') {
    const script = `Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak(${powershellQuote(clean)})`
    return {
      file: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodePowerShell(script)],
    }
  }
  return { file: 'espeak-ng', args: ['-s', '150', clean] }
}

/**
 * Same Windows voice, written to a wav file. The chat button still calls Speak()
 * so a computer with speakers plays the reply. A runner with no audio device
 * cannot do that; the installer test uses this to prove the voice synthesized.
 */
export function windowsWaveArgs(text: string, wavPath: string): { file: string; args: string[] } | null {
  const clean = clipWords(text, SPEAK_LIMIT)
  if (!clean || !wavPath) return null
  const script = [
    "$ErrorActionPreference = 'Stop'",
    'Add-Type -AssemblyName System.Speech',
    '$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer',
    `$synth.SetOutputToWaveFile(${powershellQuote(wavPath)})`,
    `$synth.Speak(${powershellQuote(clean)})`,
    '$synth.Dispose()',
  ].join('; ')
  return {
    file: 'powershell.exe',
    args: ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodePowerShell(script)],
  }
}

/** GitHub-hosted Windows has PowerShell and System.Speech, and often no speaker. */
export function speakBlockedByHardware(detail: string): boolean {
  return /no audio output device is installed|no voice installed on the system|none available with the current security setting/i.test(detail)
}

export function lastSpeakDetail(): string {
  return lastDetail
}

export function speakRunning(): boolean {
  return Boolean(child && child.exitCode == null && !child.killed)
}

export function stopSpeak(): void {
  stoppedByUser = true
  const current = child
  child = null
  if (current && !current.killed) current.kill()
}

/** Start the OS voice. Resolves false when the program cannot be started, exits non-zero, or hangs. */
export function startSpeak(text: string, platform: NodeJS.Platform = process.platform, timeoutMs: number = SPEAK_TIMEOUT_MS): Promise<boolean> {
  generation += 1
  const mine = generation
  stopSpeak()
  stoppedByUser = false
  lastDetail = ''
  const spec = speakArgs(platform, text)
  if (!spec) return Promise.resolve(false)
  return runVoiceProcess(spec, {
    timeoutMs,
    onSpawn: (next) => { child = next },
    onExit: (next) => { if (child === next) child = null },
  }).then((run) => {
    lastDetail = run.detail
    return mine !== generation || stoppedByUser || run.ok
  })
}

/**
 * Run one voice program. `timeoutMs` kills a program that never exits: a voice with no audio device
 * behind it would otherwise hold the app - or a unit run - open indefinitely.
 */
export function runVoiceProcess(
  spec: { file: string; args: string[] },
  options: { timeoutMs?: number; onSpawn?: (next: ChildProcess) => void; onExit?: (next: ChildProcess) => void } = {},
): Promise<{ ok: boolean; detail: string }> {
  const timeoutMs = options.timeoutMs ?? SPEAK_TIMEOUT_MS
  return new Promise((resolve) => {
    let settled = false
    let detail = ''
    let next: ChildProcess | null = null
    const done = (ok: boolean, why = detail) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ ok, detail: why })
    }
    const take = (chunk: Buffer) => {
      if (detail.length >= DETAIL_LIMIT) return
      detail += chunk.toString('utf8').slice(0, DETAIL_LIMIT - detail.length)
    }
    const timer = setTimeout(() => {
      const running = next
      if (running && running.exitCode == null) {
        running.kill('SIGKILL')
        options.onExit?.(running)
      }
      done(false, 'timeout')
    }, timeoutMs)
    timer.unref?.()
    try {
      next = spawn(spec.file, spec.args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
      options.onSpawn?.(next)
      next.stderr?.on('data', take)
      next.on('error', (err: NodeJS.ErrnoException) => {
        if (!detail) detail = err.code ?? 'error'
        options.onExit?.(next as ChildProcess)
        done(false)
      })
      next.on('close', (code) => {
        options.onExit?.(next as ChildProcess)
        done(code === 0)
      })
    } catch {
      next = null
      done(false, 'error')
    }
  })
}
