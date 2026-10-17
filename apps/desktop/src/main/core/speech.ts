/**
 * Read a reply aloud on this computer. The text is passed to the operating
 * system voice. It is not uploaded and it is not written to a log.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { clipWords, SPEAK_LIMIT } from '../../shared/reply-text.js'

export const NO_VOICE = 'No system voice is available on this computer.'

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

/** Start the OS voice. Resolves false when the program cannot be started or exits non-zero. */
export function startSpeak(text: string, platform: NodeJS.Platform = process.platform): Promise<boolean> {
  generation += 1
  const mine = generation
  stopSpeak()
  stoppedByUser = false
  lastDetail = ''
  const spec = speakArgs(platform, text)
  if (!spec) return Promise.resolve(false)
  return new Promise((resolve) => {
    let settled = false
    let detail = ''
    const done = (ok: boolean) => {
      if (settled) return
      settled = true
      lastDetail = detail
      resolve(ok)
    }
    const take = (chunk: Buffer) => {
      if (detail.length >= DETAIL_LIMIT) return
      detail += chunk.toString('utf8').slice(0, DETAIL_LIMIT - detail.length)
    }
    try {
      const next = spawn(spec.file, spec.args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
      child = next
      next.stderr?.on('data', take)
      next.on('error', (err: NodeJS.ErrnoException) => {
        if (!detail) detail = err.code ?? 'error'
        if (child === next) child = null
        done(mine !== generation ? true : false)
      })
      next.on('close', (code) => {
        if (child === next) child = null
        done(mine !== generation || stoppedByUser || code === 0)
      })
    } catch {
      child = null
      detail = 'error'
      done(false)
    }
  })
}
