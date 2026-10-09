import { useEffect, useRef, useState } from 'react'
import { SurfDots, type SurfMood } from '@surf/ui'
import type { ModelStatus } from '../../../shared/ipc-contract'
import type { UiMsg } from '../types'

const PROMPTS = [
  'What is 14 knots in km/h?',
  'How do you keep chats on this computer?',
  'What can you do while offline?',
]

export function ChatScreen({
  messages,
  streaming,
  status,
  onSend,
  onToggleOffline,
}: {
  messages: UiMsg[]
  streaming: boolean
  status: ModelStatus
  onSend: (text: string) => void
  onToggleOffline: () => void
}) {
  const [text, setText] = useState('')
  const scroller = useRef<HTMLDivElement>(null)
  const chatReady = status.models.some((m) => m.role === 'chat' && m.installed)
  const waiting = streaming && messages.some((m) => m.pending && !m.text)
  const mood: SurfMood = streaming ? (waiting ? 'thinking' : 'answering') : status.offlineOnly || !status.online ? 'offline' : 'idle'

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight })
  }, [messages])

  function submit(value = text) {
    const t = value.trim()
    if (!t || streaming) return
    setText('')
    onSend(t)
  }

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-6 py-3">
        <div>
          <div className="text-sm font-semibold">General</div>
          <div className="text-xs text-[var(--muted)]">Answers stay on this computer</div>
        </div>
        <div className="flex items-center gap-3">
          <span className={`pill ${status.offlineOnly || !status.online ? 'pill-warn' : 'pill-ok'}`}>
            <i />
            {status.offlineOnly ? 'Offline only' : status.online ? 'Online' : 'Offline'}
          </span>
          <label className="flex items-center gap-2 text-sm text-[var(--muted)]">
            Offline only
            <button type="button" className="toggle" data-on={status.offlineOnly ? 'yes' : 'no'} aria-pressed={status.offlineOnly} onClick={onToggleOffline}>
              <span />
            </button>
          </label>
        </div>
      </header>
      <div ref={scroller} className="flex-1 overflow-auto px-6 py-8">
        {messages.length === 0 ? (
          <div className="mx-auto flex max-w-lg flex-col items-center pt-16 text-center">
            <SurfDots mood={mood} size={168} />
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Ask Surf</h1>
            <p className="mt-2 text-[15px] leading-relaxed text-[var(--muted)]">
              Works offline. Stays up to date when you&apos;re online.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              {PROMPTS.map((p) => (
                <button key={p} type="button" className="btn btn-ghost" onClick={() => submit(p)}>{p}</button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto flex max-w-2xl flex-col gap-5">
            {messages.map((m) => <Bubble key={m.id} msg={m} mood={mood} />)}
          </div>
        )}
      </div>
      <form
        className="px-6 pb-5"
        onSubmit={(e) => { e.preventDefault(); submit() }}
      >
        <div className="mx-auto flex max-w-2xl items-end gap-2">
          <textarea
            className="field min-h-[52px]"
            rows={1}
            placeholder={chatReady ? 'Message Surf' : 'Download a model to start chatting'}
            value={text}
            disabled={!chatReady}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
            }}
          />
          <button className="btn btn-primary h-[52px] px-5" type="submit" disabled={!chatReady || streaming || !text.trim()}>Send</button>
        </div>
        {!chatReady && <p className="mx-auto mt-2 max-w-2xl text-xs text-[var(--muted)]">Open Models and download the suggested chat model. It stays on this computer.</p>}
      </form>
    </section>
  )
}

function Bubble({ msg, mood }: { msg: UiMsg; mood: SurfMood }) {
  if (msg.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl bg-[var(--accent-soft)] px-4 py-3 text-[15px] leading-relaxed">{msg.text}</div>
      </div>
    )
  }
  return (
    <div className="flex gap-3">
      <div className="pt-1"><SurfDots mood={msg.pending ? mood : msg.error ? 'error' : 'idle'} size={46} /></div>
      <div className="min-w-0 flex-1">
        <div className="whitespace-pre-wrap text-[15px] leading-relaxed">
          {msg.text || (msg.pending ? 'Thinking' : '')}
        </div>
        {msg.tools.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {msg.tools.map((t, i) => (
              <span key={i} className="pill pill-muted">{t.name}: {t.output}</span>
            ))}
          </div>
        )}
        {msg.sources.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {msg.sources.map((s, i) => (
              <span key={i} className="pill" title={s.url}>[S{i + 1}] {s.title || s.pack}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
