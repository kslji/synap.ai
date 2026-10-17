import assert from 'node:assert/strict'
import { test } from 'node:test'
import { NO_VOICE, speakArgs } from './speech.js'

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
