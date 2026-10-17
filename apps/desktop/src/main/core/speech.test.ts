import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { constants, accessSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { test } from 'node:test'
import {
  NO_VOICE,
  lastSpeakDetail,
  speakArgs,
  speakBlockedByHardware,
  startSpeak,
  windowsWaveArgs,
} from './speech.js'

function decodeCommand(args: string[]): string {
  const index = args.indexOf('-EncodedCommand')
  assert.ok(index >= 0)
  return Buffer.from(args[index + 1] ?? '', 'base64').toString('utf16le')
}

test('speech stays on the device and names the operating system voice', () => {
  const mac = speakArgs('darwin', 'Two plus two is 4.')
  assert.equal(mac?.file, 'say')
  assert.deepEqual(mac?.args, ['Two plus two is 4.'])
  const win = speakArgs('win32', "It's 4.")
  assert.equal(win?.file, 'powershell.exe')
  const script = decodeCommand(win?.args ?? [])
  assert.match(script, /System\.Speech/)
  assert.match(script, /Speak\('It''s 4\.'\)/)
  assert.doesNotMatch(script, /SetOutputToNull|https?:\/\//)
  const wave = windowsWaveArgs('Surf', 'C:\\voice\\surf.wav')
  const waveScript = decodeCommand(wave?.args ?? [])
  assert.match(waveScript, /SetOutputToWaveFile\('C:\\voice\\surf\.wav'\)/)
  assert.match(waveScript, /Speak\('Surf'\)/)
  assert.doesNotMatch(waveScript, /SetOutputToNull/)
  const linux = speakArgs('linux', 'Hello')
  assert.equal(linux?.file, 'espeak-ng')
  assert.equal(speakArgs('linux', '   '), null)
  assert.match(NO_VOICE, /No system voice/)
  assert.equal(speakBlockedByHardware('No audio output device is installed.'), true)
  assert.equal(
    speakBlockedByHardware('No voice installed on the system or none available with the current security setting.'),
    true,
  )
  assert.equal(speakBlockedByHardware('The term Speak is not recognized'), false)
  const joined = JSON.stringify({ mac, linux, note: NO_VOICE })
  assert.doesNotMatch(joined, /https?:\/\//)
})

function commandExists(file: string): boolean {
  const dirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean)
  const names = process.platform === 'win32' ? [file, `${file}.exe`, `${file}.cmd`] : [file]
  for (const dir of dirs) {
    for (const name of names) {
      try {
        accessSync(join(dir, name), constants.X_OK)
        return true
      } catch {
        /* try the next directory */
      }
    }
  }
  return false
}

function runVoice(spec: { file: string; args: string[] }): Promise<{ code: number | null; detail: string }> {
  return new Promise((resolve) => {
    let settled = false
    let detail = ''
    const finish = (code: number | null) => {
      if (settled) return
      settled = true
      resolve({ code, detail })
    }
    const next = spawn(spec.file, spec.args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
    next.stderr?.on('data', (chunk: Buffer) => {
      if (detail.length < 2_000) detail += chunk.toString('utf8').slice(0, 2_000 - detail.length)
    })
    next.on('error', (err: NodeJS.ErrnoException) => {
      if (!detail) detail = err.code ?? 'error'
      finish(null)
    })
    next.on('close', (code) => finish(code))
  })
}

test('the operating system voice speaks a short line', { timeout: 25_000 }, async () => {
  const spec = speakArgs(process.platform, 'Surf')
  assert.ok(spec)
  if (!commandExists(spec.file)) {
    if (process.env.CI && (process.platform === 'darwin' || process.platform === 'win32')) {
      assert.fail(`${spec.file} is not installed on ${process.platform}`)
    }
    return
  }
  const spoke = await startSpeak('Surf')
  if (spoke) return
  const detail = lastSpeakDetail()
  if (process.platform === 'win32') {
    // A runner with no audio device cannot play a line, and the PowerShell error
    // text differs per image, so fall back to the wav route that needs no device.
    // It runs the same System.Speech voice, so a broken script still fails here.
    const dir = mkdtempSync(join(tmpdir(), 'surf-voice-'))
    try {
      const wav = join(dir, 'surf.wav')
      const wave = windowsWaveArgs('Surf', wav)
      assert.ok(wave)
      const ran = await runVoice(wave)
      assert.equal(ran.code, 0, ran.detail || detail)
      const bytes = readFileSync(wav)
      assert.equal(bytes.subarray(0, 4).toString('ascii'), 'RIFF')
      assert.ok(bytes.length > 1_000)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
    return
  }
  assert.fail(detail || 'the voice program exited without speaking')
})
