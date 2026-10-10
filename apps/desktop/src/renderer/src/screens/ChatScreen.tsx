import { useEffect, useRef, useState } from 'react'
import { StarSurf, starStateFor } from '@surf/ui'
import type { ChunkPreview, DocScope, LibraryFile, ModelStatus } from '../../../shared/ipc-contract'
import type { UiMsg } from '../types'
import { Preview } from './LibraryScreen'

const PROMPTS = [
  'What is 14 knots in km/h?',
  'How do you keep chats on this computer?',
  'What can you do while offline?',
]

export function ChatScreen({
  messages,
  streaming,
  status,
  files,
  scope,
  preview,
  webSearchAllowed,
  chatWeb,
  agentName,
  agentNote,
  modelLabel,
  chatChoices,
  chatModelId,
  tourAttach,
  tourOnline,
  onSend,
  onToggleOffline,
  onToggleChatWeb,
  onAttach,
  onPick,
  onScope,
  onOpenCitation,
  onClosePreview,
  onSelectModel,
}: {
  messages: UiMsg[]
  streaming: boolean
  status: ModelStatus
  files: LibraryFile[]
  scope: DocScope
  preview: ChunkPreview | null
  webSearchAllowed: boolean
  chatWeb: boolean
  agentName: string
  agentNote?: string
  modelLabel: string
  chatChoices: { id: string; label: string }[]
  chatModelId: string
  tourAttach: boolean
  tourOnline: boolean
  onSend: (text: string) => void
  onToggleOffline: () => void
  onToggleChatWeb: () => void
  onAttach: (paths: string[]) => void
  onPick: () => void
  onScope: (scope: DocScope) => void
  onOpenCitation: (chunkId: number) => void
  onClosePreview: () => void
  onSelectModel: (id: string) => void
}) {
  const [text, setText] = useState('')
  const [over, setOver] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)
  const chatReady = status.models.some((m) => m.role === 'chat' && m.installed)
  const pending = messages.find((m) => m.pending && m.role === 'assistant')
  const reading = files.some((file) => file.status === 'queued' || file.status === 'running')
  const searching = messages.some((m) => m.pending && (m.phase === 'searching' || m.phase === 'reading'))
  const mood = searching
    ? 'searching'
    : streaming
      ? pending && pending.tools.length > 0 && !pending.text
        ? 'working'
        : pending && !pending.text
          ? 'thinking'
          : 'answering'
      : status.offlineOnly || !status.online
        ? 'offline'
        : 'idle'

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
    <section className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-6 py-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold" data-chat-agent={agentName}>{agentName}</div>
            <div className="truncate text-xs text-[var(--muted)]">{modelLabel} · {status.onlineReason || 'Answers stay on this computer'}</div>
          </div>
          <div className="flex items-center gap-3">
            {chatChoices.length > 0 && (
              <select className="field w-auto py-1" aria-label="Chat model" value={chatModelId} onChange={(event) => onSelectModel(event.target.value)}>
                {chatChoices.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
              </select>
            )}
            <span className={`pill ${status.offlineOnly || !status.online ? 'pill-warn' : 'pill-ok'}`} title={status.onlineReason} data-online-reason={status.onlineReason}>
              <i />
              {status.offlineOnly ? 'Offline' : status.online ? 'Online' : 'Offline'}
            </span>
          </div>
        </header>
        <div ref={scroller} className="flex-1 overflow-auto px-6 py-8">
          {messages.length === 0 ? (
            <div className="mx-auto flex max-w-lg flex-col items-center pt-16 text-center">
              <StarSurf state={starStateFor(reading ? 'working' : mood)} size={220} />
              <h1 className="mt-2 text-3xl font-semibold tracking-tight">{agentName}</h1>
              <p className="mt-2 text-[15px] leading-relaxed text-[var(--muted)]">
                {agentNote || 'Ask here. Files you attach stay on this computer.'}
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                {PROMPTS.map((p) => (
                  <button key={p} type="button" className="btn btn-ghost" onClick={() => submit(p)}>{p}</button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto flex max-w-2xl flex-col gap-5">
              {messages.map((m) => <Bubble key={m.id} msg={m} mood={mood} onOpenCitation={onOpenCitation} />)}
            </div>
          )}
        </div>
        <form
          className="px-6 pb-5"
          onSubmit={(e) => { e.preventDefault(); submit() }}
          onDragOver={(e) => { e.preventDefault(); setOver(true) }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setOver(false)
            const paths = [...e.dataTransfer.files].map((file) => window.surf.library.pathForFile(file)).filter(Boolean)
            if (paths.length) onAttach(paths)
          }}
        >
          <div
            className={`mx-auto max-w-2xl rounded-2xl border px-3 py-3 ${over ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--line)]'}`}
            data-upload={over ? 'yes' : 'no'}
          >
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <div role="radiogroup" aria-label="Where to search" className="flex gap-1">
                <ScopeButton current={scope} id="chat" onScope={onScope}>This chat</ScopeButton>
                <ScopeButton current={scope} id="all" onScope={onScope}>All chats</ScopeButton>
              </div>
              <button
                type="button"
                className="toggle"
                data-offline-toggle="yes"
                data-on={status.offlineOnly ? 'yes' : 'no'}
                data-tour="online"
                data-tour-target={tourOnline ? 'yes' : 'no'}
                aria-pressed={status.offlineOnly}
                aria-label={status.offlineOnly ? 'Offline' : 'Online'}
                onClick={onToggleOffline}
              >
                <span />
              </button>
              <span className="text-xs text-[var(--muted)]">{status.offlineOnly ? 'Offline' : 'Online'}</span>
              <button
                type="button"
                className={`rounded-full px-3 py-1 text-xs ${webSearchAllowed && chatWeb && !status.offlineOnly ? 'bg-[var(--accent)] text-[var(--accent-ink)]' : 'bg-[var(--bg-elev)] text-[var(--muted)]'}`}
                data-chat-web={webSearchAllowed && chatWeb && !status.offlineOnly ? 'yes' : 'no'}
                aria-pressed={webSearchAllowed && chatWeb && !status.offlineOnly}
                title={webSearchAllowed ? 'Search the web for this chat' : 'Turn on web search in Settings'}
                onClick={onToggleChatWeb}
              >
                Web search
              </button>
              {reading && (
                <span className="inline-flex items-center gap-2 text-xs text-[var(--muted)]" data-processing="yes">
                  <StarSurf state="searching" size={36} />
                  Reading files
                </span>
              )}
            </div>
            {files.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {files.map((file) => (
                  <span key={file.id} className="pill" data-file-status={file.status}>
                    {file.name}
                    {(file.status === 'queued' || file.status === 'running') && ` ${Math.round(file.progress * 100)}%`}
                    {file.status === 'failed' && ' failed'}
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-end gap-2">
              <button type="button" className="btn btn-ghost h-[52px]" data-tour="attach" data-tour-target={tourAttach ? 'yes' : 'no'} onClick={onPick} disabled={!chatReady}>Attach</button>
              <textarea
                className="field min-h-[52px]"
                rows={1}
                placeholder={chatReady ? `Message ${agentName}` : 'The model is still downloading'}
                value={text}
                disabled={!chatReady}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
                }}
              />
              <button className="btn btn-primary h-[52px] px-5" type="submit" disabled={!chatReady || streaming || !text.trim()}>Send</button>
            </div>
          </div>
          {!chatReady && <p className="mx-auto mt-2 max-w-2xl text-xs text-[var(--muted)]">Finish setup in Settings → Models. The file stays on this computer.</p>}
        </form>
      </div>
      {preview && <Preview preview={preview} onClose={onClosePreview} />}
    </section>
  )
}

function chipLabel(source: UiMsg['sources'][number]): string {
  const place = source.locator ? ` · ${source.locator}` : ''
  if (source.version && source.pack && !source.pack.includes(source.version)) return `${source.pack} · ${source.version}${place}`
  if (source.pack) return `${source.pack}${place}`
  return `${source.fileName || source.title || 'Source'}${place}`
}

function ScopeButton({ current, id, onScope, children }: { current: DocScope; id: DocScope; onScope: (scope: DocScope) => void; children: string }) {
  const on = current === id
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      data-doc-scope={id}
      className={`rounded-full px-3 py-1 text-xs ${on ? 'bg-[var(--accent)] text-[var(--accent-ink)]' : 'bg-[var(--bg-elev)] text-[var(--muted)]'}`}
      onClick={() => onScope(id)}
    >
      {children}
    </button>
  )
}

function Bubble({ msg, mood, onOpenCitation }: { msg: UiMsg; mood: string; onOpenCitation: (chunkId: number) => void }) {
  if (msg.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl bg-[var(--accent-soft)] px-4 py-3 text-[15px] leading-relaxed">{msg.text}</div>
      </div>
    )
  }
  const creature = msg.pending ? mood : msg.error ? 'error' : 'idle'
  return (
    <div className="flex gap-3">
      <div className="pt-1"><StarSurf state={starStateFor(creature)} size={52} /></div>
      <div className="min-w-0 flex-1">
        {msg.pending && msg.phase === 'searching' && <div className="mb-1 text-sm text-[var(--muted)]" data-searching="yes">Searching the web…</div>}
        {msg.pending && msg.phase === 'reading' && <div className="mb-1 text-sm text-[var(--muted)]" data-searching="yes">Reading the page…</div>}
        <div className="whitespace-pre-wrap text-[15px] leading-relaxed">
          <CitedText text={msg.text || (msg.pending && !msg.phase ? 'Thinking' : '')} sources={msg.sources} onOpen={onOpenCitation} />
        </div>
        {msg.tools.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {msg.tools.map((t, i) => (
              <span key={i} className="pill pill-muted">{t.name}: {t.output}</span>
            ))}
          </div>
        )}
        {msg.sources.some((s) => s.kind !== 'web') && (
          <div className="mt-2 flex flex-wrap gap-2">
            {msg.sources.map((s, i) => s.kind === 'web' ? null : (
              <button
                key={i}
                type="button"
                className="pill"
                data-citation="yes"
                data-pack-citation={s.version ? 'yes' : 'no'}
                title={s.excerpt || s.title}
                onClick={() => { if (s.chunkId) onOpenCitation(s.chunkId) }}
              >
                {chipLabel(s)}
                {s.suspicious ? <span className="mt-1 block text-xs font-normal text-[var(--muted)]" data-suspicious="yes">This source contained suspicious instructions and was ignored.</span> : null}
              </button>
            ))}
          </div>
        )}
        {msg.sources.some((s) => s.kind === 'web') && (
          <div className="mt-3 flex flex-col gap-2">
            {msg.sources.map((s, i) => s.kind === 'web' ? (
              <button
                key={i}
                type="button"
                className="card px-3 py-2 text-left"
                data-web-source="yes"
                data-saved-web={s.savedAt ? 'yes' : 'no'}
                onClick={() => { void window.surf.links.open(s.url) }}
              >
                <div className="text-sm font-semibold">[S{i + 1}] {s.title}</div>
                <div className="text-xs text-[var(--muted)]">
                  {s.savedAt ? s.pack : (s.domain || s.url)}
                  {s.savedAt && s.domain ? ` · ${s.domain}` : ''}
                  {!s.savedAt && s.published ? ` · ${s.published}` : ''}
                </div>
                {s.staleNote && <div className="mt-1 text-xs text-[var(--muted)]" data-stale-note="yes">{s.staleNote}</div>}
                {s.suspicious && <div className="mt-1 text-xs text-[var(--muted)]" data-suspicious="yes">This source contained suspicious instructions and was ignored.</div>}
              </button>
            ) : null)}
          </div>
        )}
      </div>
    </div>
  )
}

function CitedText({ text, sources, onOpen }: { text: string; sources: UiMsg['sources']; onOpen: (chunkId: number) => void }) {
  const parts = text.split(/(\[S\d+\])/g)
  return (
    <>
      {parts.map((part, i) => {
        const mark = /^\[S(\d+)\]$/.exec(part)
        if (!mark) return <span key={i}>{part}</span>
        const source = sources[Number(mark[1]) - 1]
        if (source?.kind === 'web' && source.url) {
          return (
            <button key={i} type="button" className="font-semibold text-[var(--accent-text)] underline" data-web-source="yes" onClick={() => { void window.surf.links.open(source.url) }}>
              {part}
            </button>
          )
        }
        if (!source?.chunkId) return <span key={i}>{part}</span>
        return (
          <button key={i} type="button" className="font-semibold text-[var(--accent-text)] underline" data-citation="yes" onClick={() => onOpen(source.chunkId!)}>
            {part}
          </button>
        )
      })}
    </>
  )
}
