/**
 * Read a reply aloud on this computer. The text is passed to the operating
 * system voice. It is not uploaded and it is not written to a log.
 */
import { spawn, type ChildProcess } from 'node:child_process'

export const NO_VOICE = 'No system voice is available on this computer.'

let child: ChildProcess | null = null
let stoppedByUser = false
let generation = 0

function powershellQuote(text: string): string {
  return `'${text.replace(/'/g, "''")}'`
}

export function speakArgs(platform: NodeJS.Platform, text: string): { file: string; args: string[] } | null {
  const clean = text.replace(/\s+/g, ' ').trim().slice(0, 4000)
  if (!clean) return null
  if (platform === 'darwin') return { file: 'say', args: [clean] }
  if (platform === 'win32') {
    return {
      file: 'powershell.exe',
      args: ['-NoProfile', '-Command', `Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak(${powershellQuote(clean)})`],
    }
  }
  return { file: 'espeak-ng', args: ['-s', '150', clean] }
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

/** Start the OS voice. Resolves false when the program cannot be started. */
export function startSpeak(text: string, platform: NodeJS.Platform = process.platform): Promise<boolean> {
  generation += 1
  const mine = generation
  stopSpeak()
  stoppedByUser = false
  const spec = speakArgs(platform, text)
  if (!spec) return Promise.resolve(false)
  return new Promise((resolve) => {
    let settled = false
    const done = (ok: boolean) => {
      if (settled) return
      settled = true
      resolve(ok)
    }
    try {
      const next = spawn(spec.file, spec.args, { stdio: 'ignore' })
      child = next
      next.on('error', () => {
        if (child === next) child = null
        done(mine !== generation ? true : false)
      })
      next.on('exit', (code) => {
        if (child === next) child = null
        done(mine !== generation || stoppedByUser || code === 0)
      })
    } catch {
      child = null
      done(false)
    }
  })
}
