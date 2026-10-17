/**
 * Runs whisper-cli on a WAV that already lives on this computer.
 * The transcript is returned to the caller. It is not logged.
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseWhisperText, whisperArgs } from './dictation.js'

export function resolveWhisperCli(isPackaged: boolean, resourcesPath: string, appRoot: string, platform = process.platform, arch = process.arch): string {
  const exe = platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli'
  return isPackaged
    ? join(resourcesPath, 'whisper', exe)
    : join(appRoot, 'resources', 'whisper', `${platform}-${arch}`, exe)
}

export async function transcribeFile(bin: string, modelPath: string, wav: Uint8Array, threads: number): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'surf-mic-'))
  try {
    const wavPath = join(dir, 'clip.wav')
    writeFileSync(wavPath, wav)
    const result = await runWhisper(bin, whisperArgs(modelPath, wavPath, threads), 60_000)
    if (result.code !== 0) throw new Error('whisper-cli failed')
    return parseWhisperText(result.stdout) || parseWhisperText(result.stderr)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function runWhisper(bin: string, args: string[], timeoutMs: number): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: join(bin, '..'),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => { stdout += chunk })
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk
      if (stderr.length > 12_000) stderr = stderr.slice(-12_000)
    })
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
  })
}
