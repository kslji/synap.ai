/**
 * On-device dictation. Audio stays on this computer. Nothing here is spoken
 * aloud, and nothing here is written to a log.
 */

export const MIC_DENIED = 'Microphone access is turned off. Allow the microphone for Synap.surf in system settings, then try again.'
export const NO_MICROPHONE = 'No microphone was found on this computer.'
export const SPEECH_PROGRAM_MISSING = 'Speech recognition is not included in this copy of Synap.surf.'
export const SPEECH_MODEL_OFFLINE = 'The speech model is not on this computer, and Offline only is on.'
export const SPEECH_MODEL_MISSING = 'The speech model is not on this computer yet.'
export const SPEECH_FAILED = 'Could not transcribe that recording.'
export const NOTHING_HEARD = 'No speech was heard in that recording.'

/** The recording is never played back. */
export const MIC_MONITOR_GAIN = 0

export const DICTATION_SAMPLE_RATE = 16_000
/** Ignore a tap that is shorter than a tenth of a second. */
export const MIN_SPEECH_SAMPLES = 1_600
/** Stop a recording after one minute. */
export const MAX_RECORDING_MS = 60_000

export function classifyMicError(name: string): 'denied' | 'no-mic' | 'failed' {
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') return 'denied'
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') return 'no-mic'
  return 'failed'
}

export function micNote(kind: 'denied' | 'no-mic' | 'failed'): string {
  if (kind === 'denied') return MIC_DENIED
  if (kind === 'no-mic') return NO_MICROPHONE
  return SPEECH_FAILED
}

export function osMicStatus(status: string): 'granted' | 'denied' | 'prompt' | 'unknown' {
  if (status === 'granted') return 'granted'
  if (status === 'denied' || status === 'restricted') return 'denied'
  if (status === 'not-determined') return 'prompt'
  return 'unknown'
}

/** Percent comes from the bytes already written and the registry file size. */
export function speechProgressLabel(done: number, total: number): string {
  if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0) return 'Downloading speech model'
  const pct = Math.floor((Math.max(0, done) / total) * 100)
  return `Downloading speech model ${Math.min(100, Math.max(0, pct))}%`
}

export function placeTranscript(current: string, transcript: string, start: number, end: number): { text: string; caret: number } {
  const spoken = transcript.replace(/\s+/g, ' ').trim()
  const safeStart = Math.max(0, Math.min(start, current.length))
  const safeEnd = Math.max(safeStart, Math.min(end, current.length))
  if (!spoken) return { text: current, caret: safeEnd }
  const before = current.slice(0, safeStart)
  const after = current.slice(safeEnd)
  const lead = before.length > 0 && !/\s$/.test(before) ? ' ' : ''
  const trail = after.length > 0 && !/^\s/.test(after) ? ' ' : ''
  const text = `${before}${lead}${spoken}${trail}${after}`
  return { text, caret: (before + lead + spoken).length }
}

export function whisperArgs(modelPath: string, wavPath: string, threads: number): string[] {
  const count = Math.max(1, Math.min(8, Math.floor(threads) || 1))
  return ['-m', modelPath, '-f', wavPath, '-l', 'auto', '-nt', '-np', '-ng', '-t', String(count)]
}

export function parseWhisperText(raw: string): string {
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const spoken: string[] = []
  for (const line of lines) {
    if (/^(whisper_|ggml_|main:|system_info|load time|metal |ggml_metal|error:|read_audio_data:)/i.test(line)) continue
    const text = line.replace(/^\[[^\]]+\]\s*/, '').replace(/<\|[^|]+\|>/g, '').trim()
    if (!text) continue
    spoken.push(text)
  }
  return spoken.join(' ').replace(/\s+/g, ' ').trim()
}

export function floatToPcm16(samples: Float32Array, fromRate: number, toRate = DICTATION_SAMPLE_RATE): Int16Array {
  const source = fromRate > 0 ? samples : new Float32Array()
  const rate = fromRate > 0 ? fromRate : toRate
  const ratio = rate / toRate
  const outLen = ratio === 1 ? source.length : Math.floor(source.length / ratio)
  const out = new Int16Array(outLen)
  for (let i = 0; i < outLen; i++) {
    const pos = ratio === 1 ? i : i * ratio
    const j = Math.floor(pos)
    const frac = pos - j
    const a = source[j] ?? 0
    const b = source[Math.min(j + 1, source.length - 1)] ?? a
    const mixed = a + (b - a) * frac
    const clamped = Math.max(-1, Math.min(1, mixed))
    out[i] = clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff)
  }
  return out
}

export function encodeWavPcm16(samples: Int16Array, sampleRate: number): Uint8Array {
  const dataBytes = samples.length * 2
  const buf = new Uint8Array(44 + dataBytes)
  const view = new DataView(buf.buffer)
  writeAscii(buf, 0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  writeAscii(buf, 8, 'WAVE')
  writeAscii(buf, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeAscii(buf, 36, 'data')
  view.setUint32(40, dataBytes, true)
  for (let i = 0; i < samples.length; i++) view.setInt16(44 + i * 2, samples[i] ?? 0, true)
  return buf
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const step = 0x2000
  for (let i = 0; i < bytes.length; i += step) {
    const slice = bytes.subarray(i, i + step)
    binary += String.fromCharCode(...slice)
  }
  return btoa(binary)
}

function writeAscii(buf: Uint8Array, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) buf[offset + i] = text.charCodeAt(i)
}
