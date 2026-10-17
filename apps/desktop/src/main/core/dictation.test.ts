import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { availableParallelism, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { downloadVerified } from './model-download.js'
import { parseRegistry, pick } from './model-registry.js'
import {
  classifyMicError,
  encodeWavPcm16,
  floatToPcm16,
  MIC_DENIED,
  MIC_MONITOR_GAIN,
  micNote,
  NO_MICROPHONE,
  osMicStatus,
  placeTranscript,
  speechProgressLabel,
  SPEECH_FAILED,
  whisperArgs,
  parseWhisperText,
} from './dictation.js'
import { resolveWhisperCli, transcribeFile } from './dictation-run.js'

const here = dirname(fileURLToPath(import.meta.url))
const registryPath = join(here, '../../../resources/models.registry.json')
const fixturePath = join(here, 'fixtures/dictate-surf.wav')

test('a denied microphone and a missing microphone are different notes', () => {
  assert.equal(micNote(classifyMicError('NotAllowedError')), MIC_DENIED)
  assert.equal(micNote(classifyMicError('PermissionDeniedError')), MIC_DENIED)
  assert.equal(micNote(classifyMicError('SecurityError')), MIC_DENIED)
  assert.equal(micNote(classifyMicError('NotFoundError')), NO_MICROPHONE)
  assert.equal(micNote(classifyMicError('DevicesNotFoundError')), NO_MICROPHONE)
  assert.equal(micNote(classifyMicError('OverconstrainedError')), NO_MICROPHONE)
  assert.equal(micNote(classifyMicError('AbortError')), SPEECH_FAILED)
  assert.equal(MIC_MONITOR_GAIN, 0)
})

test('operating system microphone status maps onto granted, denied, or a prompt', () => {
  assert.equal(osMicStatus('granted'), 'granted')
  assert.equal(osMicStatus('denied'), 'denied')
  assert.equal(osMicStatus('restricted'), 'denied')
  assert.equal(osMicStatus('not-determined'), 'prompt')
  assert.equal(osMicStatus('unknown'), 'unknown')
})

test('a transcript is inserted into the message without gluing words', () => {
  assert.deepEqual(placeTranscript('hello', 'there', 5, 5), { text: 'hello there', caret: 11 })
  assert.deepEqual(placeTranscript('hello world', 'there', 6, 11), { text: 'hello there', caret: 11 })
  assert.deepEqual(placeTranscript('say ', 'four', 4, 4), { text: 'say four', caret: 8 })
  assert.deepEqual(placeTranscript('hello', '   ', 5, 5), { text: 'hello', caret: 5 })
  const middle = placeTranscript('ab', 'cd', 1, 1)
  assert.equal(middle.text, 'a cd b')
  assert.equal(middle.caret, 4)
})

test('speech download progress uses the bytes already saved', () => {
  assert.equal(speechProgressLabel(0, 100), 'Downloading speech model 0%')
  assert.equal(speechProgressLabel(50, 100), 'Downloading speech model 50%')
  assert.equal(speechProgressLabel(100, 100), 'Downloading speech model 100%')
  assert.equal(speechProgressLabel(Number.NaN, 100), 'Downloading speech model')
  assert.equal(speechProgressLabel(1, 0), 'Downloading speech model')
})

test('whisper arguments are a list and the wav is 16 kHz mono', () => {
  const args = whisperArgs('/models/ggml-base-q8_0.bin', '/tmp/clip.wav', 4)
  assert.deepEqual(args.slice(0, 4), ['-m', '/models/ggml-base-q8_0.bin', '-f', '/tmp/clip.wav'])
  assert.ok(args.includes('-ng'))
  assert.equal(args.some((arg) => /[;&|`$]/.test(arg)), false)
  const pcm = floatToPcm16(new Float32Array([0, 0.5, -1]), 16_000)
  const wav = encodeWavPcm16(pcm, 16_000)
  assert.equal(Buffer.from(wav.subarray(0, 4)).toString('ascii'), 'RIFF')
  assert.equal(Buffer.from(wav.subarray(8, 12)).toString('ascii'), 'WAVE')
  assert.equal(wav.length, 44 + pcm.length * 2)
  assert.equal(parseWhisperText('[00:00:00.000 --> 00:00:01.000]  Hello from surf.\nread_audio_data: reading audio data\nwhisper_init_from_file_with_params_no_state: loading'), 'Hello from surf.')
})

test('the speech model for each tier is the registry row', () => {
  const reg = parseRegistry(JSON.parse(readFileSync(registryPath, 'utf8')))
  assert.equal(pick(reg, 'asr', 0).id, 'whisper-base-q8_0')
  assert.equal(pick(reg, 'asr', 1).id, 'whisper-base-q8_0')
  assert.equal(pick(reg, 'asr', 0).sha256, 'c577b9a86e7e048a0b7eada054f4dd79a56bbfa911fbdacf900ac5b567cbb7d9')
  assert.equal(pick(reg, 'asr', 0).size_bytes, 81_768_585)
  assert.equal(pick(reg, 'asr', 2).id, 'whisper-small-q8_0')
  assert.equal(pick(reg, 'asr', 3).id, 'whisper-large-v3-turbo-q5_0')
})

test('whisper-cli transcribes a spoken line on this computer', { timeout: 180_000 }, async () => {
  if (process.env.SURF_WHISPER_LIVE !== '1') return
  const desktop = join(here, '../../..')
  const bin = resolveWhisperCli(false, '', desktop)
  assert.equal(existsSync(bin), true, `whisper-cli is not at ${bin}`)
  assert.equal(existsSync(fixturePath), true, 'missing dictate-surf.wav')
  const reg = parseRegistry(JSON.parse(readFileSync(registryPath, 'utf8')))
  const model = pick(reg, 'asr', 0)
  const dest = join(tmpdir(), 'surf-whisper-live', model.file)
  mkdirSync(dirname(dest), { recursive: true })
  await downloadVerified({ url: model.url, dest, size: model.size_bytes, sha256: model.sha256 })
  const text = await transcribeFile(bin, dest, readFileSync(fixturePath), Math.min(4, availableParallelism()))
  assert.match(text, /surf/i)
})
