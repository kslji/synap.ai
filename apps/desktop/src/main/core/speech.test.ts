import assert from 'node:assert/strict'
import { constants, accessSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { test } from 'node:test'
import { NO_VOICE, speakArgs, startSpeak } from './speech.js'

test('speech stays on the device and names the operating system voice', () => {
  const mac = speakArgs('darwin', 'Two plus two is 4.')
  assert.equal(mac?.file, 'say')
  assert.deepEqual(mac?.args, ['Two plus two is 4.'])
  const win = speakArgs('win32', "It's 4.")
  assert.equal(win?.file, 'powershell.exe')
  assert.match(win?.args.join(' ') ?? '', /System\.Speech/)
  assert.match(win?.args.join(' ') ?? '', /It''s 4\./)
  const linux = speakArgs('linux', 'Hello')
  assert.equal(linux?.file, 'espeak-ng')
  assert.equal(speakArgs('linux', '   '), null)
  assert.match(NO_VOICE, /No system voice/)
  const joined = JSON.stringify({ mac, win, linux })
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

test('the operating system voice speaks a short line', { timeout: 25_000 }, async () => {
  const spec = speakArgs(process.platform, 'Surf')
  assert.ok(spec)
  if (!commandExists(spec.file)) {
    if (process.env.CI && (process.platform === 'darwin' || process.platform === 'win32')) {
      assert.fail(`${spec.file} is not installed on ${process.platform}`)
    }
    return
  }
  assert.equal(await startSpeak('Surf'), true)
})
