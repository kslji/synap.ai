import { useEffect, useRef, useState } from 'react'
import { Mic } from 'lucide-react'
import {
  bytesToBase64,
  classifyMicError,
  encodeWavPcm16,
  floatToPcm16,
  MAX_RECORDING_MS,
  MIC_DENIED,
  MIC_MONITOR_GAIN,
  micNote,
  MIN_SPEECH_SAMPLES,
  NOTHING_HEARD,
  SPEECH_MODEL_OFFLINE,
} from '../../../main/core/dictation'

interface Capture {
  ctx: AudioContext
  stream: MediaStream
  source: MediaStreamAudioSourceNode
  processor: ScriptProcessorNode
  chunks: Float32Array[]
}

export function MicButton({
  speechModelId,
  installed,
  modelBytes,
  offlineOnly,
  onListening,
  onTranscript,
  onStatus,
}: {
  speechModelId: string
  installed: boolean
  modelBytes: number
  offlineOnly: boolean
  onListening: (on: boolean) => void
  onTranscript: (text: string) => void
  onStatus: (status: { note: string; progress: { done: number; total: number } | null }) => void
}) {
  const [listening, setListening] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progressOn, setProgressOn] = useState(false)
  const haveModel = useRef(installed)
  haveModel.current = installed
  const capture = useRef<Capture | null>(null)
  const stopTimer = useRef<number | null>(null)
  const onListeningRef = useRef(onListening)
  const onStatusRef = useRef(onStatus)
  onListeningRef.current = onListening
  onStatusRef.current = onStatus

  useEffect(() => () => {
    if (stopTimer.current != null) window.clearTimeout(stopTimer.current)
    release(capture.current)
    capture.current = null
  }, [])

  function publish(note: string, progress: { done: number; total: number } | null) {
    onStatusRef.current({ note, progress })
  }

  useEffect(() => {
    if (!progressOn || !speechModelId) return
    return window.surf.models.onEvent((event) => {
      if (event.id !== speechModelId) return
      if (event.state === 'progress' || event.state === 'done') publish('', { done: event.done, total: event.total })
    })
  }, [progressOn, speechModelId])

  async function toggle() {
    if (listening) {
      await finish()
      return
    }
    if (busy) return
    publish('', null)
    const prep = await window.surf.speech.prepare()
    if (prep.status === 'denied') {
      publish(MIC_DENIED, null)
      return
    }
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
        video: false,
      })
    } catch (error) {
      const name = error instanceof DOMException ? error.name : ''
      publish(micNote(classifyMicError(name)), null)
      return
    }
    const ctx = new AudioContext()
    const source = ctx.createMediaStreamSource(stream)
    const processor = ctx.createScriptProcessor(4096, 1, 1)
    const mute = ctx.createGain()
    mute.gain.value = MIC_MONITOR_GAIN
    const chunks: Float32Array[] = []
    processor.onaudioprocess = (event) => {
      chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)))
    }
    source.connect(processor)
    processor.connect(mute)
    mute.connect(ctx.destination)
    capture.current = { ctx, stream, source, processor, chunks }
    setListening(true)
    onListeningRef.current(true)
    stopTimer.current = window.setTimeout(() => { void finish() }, MAX_RECORDING_MS)
  }

  async function finish() {
    if (stopTimer.current != null) window.clearTimeout(stopTimer.current)
    stopTimer.current = null
    const current = capture.current
    capture.current = null
    setListening(false)
    onListeningRef.current(false)
    if (!current) return
    const rate = current.ctx.sampleRate
    const chunks = current.chunks
    release(current)
    const merged = concatFloats(chunks)
    const pcm = floatToPcm16(merged, rate)
    if (pcm.length < MIN_SPEECH_SAMPLES) {
      publish(NOTHING_HEARD, null)
      return
    }
    setBusy(true)
    try {
      const ready = await ensureModel()
      if (!ready) return
      const wav = encodeWavPcm16(pcm, 16000)
      const result = await window.surf.speech.transcribe({ wavBase64: bytesToBase64(wav) })
      if (result.ok && result.text) onTranscript(result.text)
      else if (result.note) publish(result.note, null)
    } catch (error) {
      publish(error instanceof Error ? error.message : 'Could not transcribe that recording.', null)
    } finally {
      setBusy(false)
      setProgressOn(false)
    }
  }

  async function ensureModel(): Promise<boolean> {
    if (haveModel.current) return true
    if (!speechModelId || offlineOnly) {
      publish(SPEECH_MODEL_OFFLINE, null)
      return false
    }
    setProgressOn(true)
    publish('', { done: 0, total: modelBytes })
    try {
      await window.surf.models.download(speechModelId)
      haveModel.current = true
      return true
    } catch (error) {
      publish(error instanceof Error ? error.message : 'The speech model could not be downloaded.', null)
      setProgressOn(false)
      return false
    }
  }

  return (
    <button
      type="button"
      className={`composer-icon${listening ? ' is-listening' : ''}`}
      aria-label={listening ? 'Stop microphone' : 'Microphone'}
      aria-pressed={listening}
      data-mic="yes"
      data-mic-state={listening ? 'listening' : 'idle'}
      data-tip={listening ? 'Stop microphone' : 'Microphone'}
      disabled={busy && !listening}
      onClick={() => { void toggle() }}
    >
      <Mic size={18} strokeWidth={2} />
    </button>
  )
}

function release(current: Capture | null): void {
  if (!current) return
  current.processor.onaudioprocess = null
  current.processor.disconnect()
  current.source.disconnect()
  for (const track of current.stream.getTracks()) track.stop()
  void current.ctx.close()
}

function concatFloats(chunks: Float32Array[]): Float32Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const merged = new Float32Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.length
  }
  return merged
}
