import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Check, Copy, Download, MoreHorizontal, Plus, RefreshCw, Search, ThumbsDown, ThumbsUp, Volume2 } from 'lucide-react'
import { StarSurf, starStateFor } from '@surf/ui'
import type { CatalogModel, ChunkPreview, CodeProjectStatus, DocScope, LibraryFile, ModelStatus } from '../../../shared/ipc-contract'
import { formatModelSize, friendlyModelName, friendlyNameFromId } from '../../../shared/model-label'
import { STARTER_CHAT_MODEL_ID } from '../../../shared/starter-model'
import { quoteChipLabel } from '../../../shared/quote'
import { formatIndexBytes } from '../format'
import type { UiMsg } from '../types'
import { CodeModeBar, CodeTrace } from './CodeTrace'
import { CodeEditor } from './CodeEditor'
import { CodeShots, type CodeShot } from './CodeShots'
import { Preview } from './LibraryScreen'
import { ModelGuideButton } from './ModelGuide'

function folderName(root: string): string {
  const parts = root.split(/[/\\]/).filter(Boolean)
  return parts[parts.length - 1] ?? root
}

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
  title,
  modelLabel,
  modelGuide = false,
  tourAttach,
  onSend,
  shots = [],
  onAddShots,
  onRemoveShot,
  onSaveShot,
  onCaptureShot,
  onToggleChatWeb,
  onAttach,
  onPick,
  onScope,
  onOpenCitation,
  onClosePreview,
  onSwitchSmaller,
  project,
  onOpenProject,
  onCodeDecide,
  onCodeRevise,
  onCodeUndo,
  onCodeUndoAll,
  codeMode,
  autoConfirmed,
  onCodeMode,
  onStop,
  tabSuggestions = false,
  tabSuggestionsOff = [],
  onRegenerate,
  animateMascot = true,
  downloadBusyId = null,
  downloadProgress = {},
  setupError = null,
  onDownloadModel,
  onCancelDownload,
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
  title?: string
  modelLabel: string
  modelGuide?: boolean
  tourAttach: boolean
  onSend: (text: string, images?: { mime: CodeShot['mime']; base64: string }[]) => void
  shots?: CodeShot[]
  onAddShots?: (files: File[]) => void
  onRemoveShot?: (id: string) => void
  onSaveShot?: (id: string) => void
  onCaptureShot?: () => void
  onToggleChatWeb: () => void
  onAttach: (paths: string[]) => void
  onPick: () => void
  onScope: (scope: DocScope) => void
  onOpenCitation: (chunkId: number) => void
  onClosePreview: () => void
  onSwitchSmaller: (id: string) => void
  /** Set for the Code agent. Null means no folder has been opened yet. */
  project?: CodeProjectStatus | null
  onOpenProject?: () => void
  onCodeDecide?: (messageId: string, id: string, allow: boolean, remember?: boolean, all?: boolean) => void
  onCodeRevise?: (messageId: string, order: string[], edits?: { id: string; goal: string }[]) => void
  onCodeUndo?: (messageId: string, stepId: string) => void
  onCodeUndoAll?: (messageId: string) => void
  codeMode?: 'ask' | 'auto'
  autoConfirmed?: boolean
  onCodeMode?: (mode: 'ask' | 'auto', confirmAuto?: boolean) => void
  onStop?: () => void
  tabSuggestions?: boolean
  tabSuggestionsOff?: string[]
  onRegenerate?: (messageId: string) => void
  animateMascot?: boolean
  downloadBusyId?: string | null
  downloadProgress?: Record<string, number>
  setupError?: string | null
  onDownloadModel?: (id: string) => void
  onCancelDownload?: () => void
}) {
  const [confirmingAuto, setConfirmingAuto] = useState(false)
  const [text, setText] = useState('')
  const [over, setOver] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)
  const autoStarted = useRef<string | null>(null)
  const chatReady = status.models.some((m) => m.role === 'chat' && m.installed)
  const setupId = status.setupModelId || STARTER_CHAT_MODEL_ID
  const setupModel = status.models.find((item) => item.id === setupId) ?? null
  const pending = messages.find((m) => m.pending && m.role === 'assistant')
  const reading = files.some((file) => file.status === 'queued' || file.status === 'running')
  const searching = messages.some((m) => m.pending && (m.phase === 'searching' || m.phase === 'reading'))
  const mood = searching
    ? 'searching'
    : streaming
      ? pending && (pending.tools.length > 0 || (pending.steps?.length ?? 0) > 0) && !pending.text
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

  useEffect(() => {
    if (!setupModel || chatReady || !onDownloadModel) return
    if (status.offlineOnly || !status.online) return
    if (downloadBusyId) return
    if (autoStarted.current === setupModel.id) return
    autoStarted.current = setupModel.id
    onDownloadModel(setupModel.id)
  }, [setupModel, chatReady, status.offlineOnly, status.online, downloadBusyId, onDownloadModel])

  function submit(value = text) {
    const t = value.trim()
    const images = shots.map((shot) => ({ mime: shot.mime, base64: shot.base64 }))
    if (streaming || (!t && images.length === 0)) return
    setText('')
    onSend(t, images)
  }

  return (
    <section className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-center px-6 py-4">
          <div className="shell-title" data-chat-agent={agentName} title={status.onlineReason} data-online-reason={status.onlineReason}>
            {title || agentName}
          </div>
          {modelGuide && <ModelGuideButton />}
        </header>
        {project !== undefined && (
          <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-6 py-2" data-code-project="yes">
            <div className="min-w-0 text-xs text-[var(--muted)]">
              {project ? (
                <>
                  <span className="font-semibold text-[var(--ink)]">{folderName(project.root)}</span>
                  {' · '}
                  {project.state === 'indexing' ? `Indexing ${project.done}/${project.files}` : `${project.files} files`}
                  {' · '}
                  {formatIndexBytes(project.bytes)}
                  {' · '}
                  {project.embeddings === 'ready' ? 'keywords + embeddings' : project.embeddings === 'pending' ? 'embeddings catching up' : 'keyword index'}
                  {project.error ? ` · ${project.error}` : ''}
                </>
              ) : (
                'No project open. The index stays in this app private data folder.'
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {project && onCodeMode && (
                <CodeModeBar
                  mode={codeMode ?? 'ask'}
                  confirming={confirmingAuto}
                  onChoose={(next) => {
                    if (next === 'auto' && !autoConfirmed) { setConfirmingAuto(true); return }
                    setConfirmingAuto(false)
                    onCodeMode(next)
                  }}
                  onConfirm={() => { setConfirmingAuto(false); onCodeMode('auto', true) }}
                  onCancel={() => setConfirmingAuto(false)}
                />
              )}
              {streaming && onStop && (
                <button type="button" className="btn btn-ghost shrink-0" data-code-stop="yes" onClick={onStop}>Stop</button>
              )}
              <button type="button" className="btn btn-ghost shrink-0" onClick={onOpenProject}>
                {project ? 'Change folder' : 'Open folder'}
              </button>
            </div>
          </div>
        )}
        {project && <CodeEditor enabled={tabSuggestions} languagesOff={tabSuggestionsOff} />}
        <div ref={scroller} className="flex-1 overflow-auto px-6 py-6">
          {messages.length === 0 ? (
            <div className="empty-chat">
              {!chatReady && setupModel && onDownloadModel && onCancelDownload ? (
                <>
                  <StarSurf state={starStateFor(reading ? 'working' : mood)} size={120} />
                  <SetupDownload
                  model={setupModel}
                  busy={downloadBusyId === setupModel.id}
                  progress={downloadProgress[setupModel.id] ?? 0}
                  offline={status.offlineOnly || !status.online}
                  error={setupError}
                  onDownload={() => {
                    autoStarted.current = setupModel.id
                    onDownloadModel(setupModel.id)
                  }}
                  onCancel={onCancelDownload}
                />
                </>
              ) : (
                <>
                  <StarSurf state={starStateFor(reading ? 'working' : mood)} size={148} />
                  <h1 className="empty-title">Hello</h1>
                  <p className="empty-lead">
                    {agentNote || `Ask ${agentName} anything. Your files stay here.`}
                  </p>
                  <div className="suggest-row">
                    {PROMPTS.map((p) => (
                      <button key={p} type="button" className="suggest-chip" onClick={() => submit(p)}>{p}</button>
                    ))}
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="mx-auto flex max-w-2xl flex-col gap-5">
              {messages.map((m) => <Bubble key={m.id} msg={m} mood={mood} modelLabel={modelLabel} animateMascot={animateMascot} onOpenCitation={onOpenCitation} onSwitchSmaller={onSwitchSmaller} onCodeDecide={onCodeDecide} onCodeRevise={onCodeRevise} onCodeUndo={onCodeUndo} onCodeUndoAll={onCodeUndoAll} onRegenerate={onRegenerate} />)}
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
            const dropped = [...e.dataTransfer.files]
            const images = onAddShots ? dropped.filter((file) => file.type.startsWith('image/')) : []
            const rest = dropped.filter((file) => !images.includes(file))
            if (images.length && onAddShots) onAddShots(images)
            const paths = rest.map((file) => window.surf.library.pathForFile(file)).filter(Boolean)
            if (paths.length) onAttach(paths)
          }}
        >
          <div
            className={`shell-compose mx-auto max-w-2xl px-3 py-3 ${over ? 'is-over' : ''}`}
            data-upload={over ? 'yes' : 'no'}
          >
            {searchOpen && (
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <div role="radiogroup" aria-label="Where to search" className="flex gap-1">
                  <ScopeButton current={scope} id="chat" onScope={onScope}>This chat</ScopeButton>
                  <ScopeButton current={scope} id="all" onScope={onScope}>All chats</ScopeButton>
                </div>
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
              </div>
            )}
            <div className="mb-2 flex flex-wrap items-center gap-2">
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
            {onCaptureShot && onAddShots && onRemoveShot && onSaveShot && (
              <CodeShots shots={shots} onRemove={onRemoveShot} onSave={onSaveShot} onAttach={onAddShots} onCapture={onCaptureShot} />
            )}
            <div className="shell-composer flex items-end gap-2">
              <button type="button" className="composer-icon" aria-label="Attach" data-tip="Attach" data-tour="attach" data-tour-target={tourAttach ? 'yes' : 'no'} onClick={onPick} disabled={!chatReady}><Plus size={18} strokeWidth={2} /></button>
              <button type="button" className="composer-icon" aria-label="Search" data-tip="Search" aria-expanded={searchOpen} data-search-tools={searchOpen ? 'open' : 'closed'} onClick={() => setSearchOpen((open) => !open)}><Search size={16} strokeWidth={2} /></button>
              <textarea
                className="field min-h-[44px]"
                rows={1}
                placeholder={chatReady ? `Message ${agentName}` : 'Still getting ready'}
                value={text}
                disabled={!chatReady}
                onChange={(e) => setText(e.target.value)}
                onPaste={(e) => {
                  if (!onAddShots) return
                  const files = [...e.clipboardData.items].map((item) => item.type.startsWith('image/') ? item.getAsFile() : null).filter((file): file is File => Boolean(file))
                  if (!files.length) return
                  e.preventDefault()
                  onAddShots(files)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
                }}
              />
              {streaming && onStop ? (
                <button className="btn btn-ghost h-9 px-3" type="button" data-code-stop="yes" onClick={onStop}>Stop</button>
              ) : (
                <button className="send-btn" type="submit" aria-label="Send" data-tip="Send" disabled={!chatReady || streaming || (!text.trim() && shots.length === 0)}><ArrowUp size={18} strokeWidth={2.4} /></button>
              )}
            </div>
          </div>
        </form>
      </div>
      {preview && <Preview preview={preview} onClose={onClosePreview} />}
    </section>
  )
}

function setupName(model: CatalogModel): string {
  return friendlyModelName({ id: model.id, family: model.family, paramsB: model.paramsB })
}

function ramNote(gb: number): string {
  const ram = Number.isInteger(gb) ? String(gb) : String(gb)
  return `needs ${ram} GB RAM`
}

function SetupDownload({
  model,
  busy,
  progress,
  offline,
  error,
  onDownload,
  onCancel,
}: {
  model: CatalogModel
  busy: boolean
  progress: number
  offline: boolean
  error: string | null
  onDownload: () => void
  onCancel: () => void
}) {
  const percent = Math.max(0, Math.min(100, Math.round(progress * 100)))
  return (
    <div className="card setup-card mt-5 px-5 py-5" data-model-setup="yes" data-model-option={model.id}>
      <div className="setup-head">
        <span className="icon-tile" aria-hidden="true"><Download size={18} /></span>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Setting up {setupName(model)}</h1>
        </div>
      </div>
      <p className="mt-4 text-sm text-[var(--muted)]">
        <span data-model-size={model.id}>{formatModelSize(model.sizeBytes)}</span>
        {' · '}
        <span data-model-ram={model.id}>{ramNote(model.minRamGb)}</span>
      </p>
      <div className={`progress mt-4 ${busy ? 'is-busy' : ''}`} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
        <b style={{ width: `${percent}%` }} />
      </div>
      {offline && <p className="mt-3 text-sm" data-setup-offline="yes">Offline. The download starts when this computer is allowed online.</p>}
      {busy ? (
        <button className="btn btn-ghost mt-4" type="button" data-cancel-download={model.id} onClick={onCancel}>
          Cancel {percent}%
        </button>
      ) : (
        <button className="btn btn-primary mt-4" type="button" data-download-model={model.id} onClick={onDownload}>
          Download {setupName(model)}
        </button>
      )}
      {error && <p className="mt-3 text-sm" data-model-setup-error="yes">{error}</p>}
    </div>
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

function Bubble({ msg, mood, modelLabel, animateMascot, onOpenCitation, onSwitchSmaller, onCodeDecide, onCodeRevise, onCodeUndo, onCodeUndoAll, onRegenerate }: { msg: UiMsg; mood: string; modelLabel: string; animateMascot: boolean; onOpenCitation: (chunkId: number) => void; onSwitchSmaller: (id: string) => void; onCodeDecide?: (messageId: string, id: string, allow: boolean, remember?: boolean, all?: boolean) => void; onCodeRevise?: (messageId: string, order: string[], edits?: { id: string; goal: string }[]) => void; onCodeUndo?: (messageId: string, stepId: string) => void; onCodeUndoAll?: (messageId: string) => void; onRegenerate?: (messageId: string) => void }) {
  const [versionAt, setVersionAt] = useState<number | null>(null)
  const history = msg.versions ?? []
  const showingOld = versionAt != null && versionAt < history.length
  const shown = showingOld ? history[versionAt] ?? msg.text : msg.text
  if (msg.role === 'user') {
    return (
      <div className="msg-in flex justify-end" data-user-message="yes">
        <div className="user-bubble max-w-[80%] px-4 py-3 text-[15px] leading-relaxed">{msg.text}</div>
      </div>
    )
  }
  const creature = msg.pending ? mood : msg.error ? 'error' : msg.gate === 'answer' || msg.gate === 'web' ? 'success' : 'idle'
  return (
    <div className="msg-in flex gap-3" data-assistant-message="yes" data-streamed={msg.streamed ? 'yes' : 'no'}>
      <div className="pt-1"><StarSurf state={starStateFor(creature)} size={44} animate={animateMascot} /></div>
      <div className="min-w-0 flex-1">
      <div className="assistant-card">
        {msg.pending && msg.phase === 'searching' && <div className="mb-1 text-sm text-[var(--muted)]" data-searching="yes">Searching the web…</div>}
        {msg.pending && msg.phase === 'reading' && <div className="mb-1 text-sm text-[var(--muted)]" data-searching="yes">Reading the page…</div>}
        <div className={`whitespace-pre-wrap text-[15px] leading-relaxed ${msg.pending ? 'stream-caret' : ''}`} data-model-error={msg.error ? 'yes' : 'no'}>
          <CitedText text={shown || (msg.pending && !msg.phase ? 'Thinking' : '')} sources={msg.sources} onOpen={onOpenCitation} />
        </div>
        {msg.error && msg.smallerModelId && (
          <button className="btn btn-ghost mt-2" type="button" data-switch-smaller="yes" onClick={() => onSwitchSmaller(msg.smallerModelId!)}>
            Switch to smaller model
          </button>
        )}
        <CodeTrace messageId={msg.id} steps={msg.steps ?? []} diffs={msg.diffs ?? []} plan={msg.plan} onDecide={onCodeDecide} onRevise={onCodeRevise} onUndo={onCodeUndo} onUndoAll={onCodeUndoAll} />
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
        {msg.sources.some((s) => s.pack === 'quote' && s.url) && (
          <div className="mt-2 flex flex-wrap gap-2">
            {msg.sources.map((s, i) => s.pack === 'quote' && s.url ? (
              <button
                key={i}
                type="button"
                className="pill"
                data-quote-chip="yes"
                title={s.excerpt || s.title}
                onClick={() => { void window.surf.links.open(s.url) }}
              >
                {quoteChipLabel(s.title || 'Source', i + 1)}
              </button>
            ) : null)}
          </div>
        )}
        {msg.sources.some((s) => s.kind === 'web' && s.pack !== 'quote') && (
          <div className="mt-3 flex flex-col gap-2">
            {msg.sources.map((s, i) => s.kind === 'web' && s.pack !== 'quote' ? (
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
        {!msg.pending && msg.text && (
          <ReplyBar
            text={shown}
            modelId={friendlyNameFromId(msg.modelId) || msg.modelId || modelLabel}
            elapsedMs={showingOld ? null : msg.elapsedMs ?? null}
            sources={msg.sources.map((source) => source.title).filter(Boolean)}
            versionCount={history.length + 1}
            versionAt={showingOld ? versionAt! : history.length}
            onVersion={(index) => setVersionAt(index >= history.length ? null : index)}
            onRegenerate={onRegenerate ? () => onRegenerate(msg.id) : undefined}
          />
        )}
      </div>
    </div>
  )
}

function ReplyBar({
  text,
  modelId,
  elapsedMs,
  sources,
  versionCount,
  versionAt,
  onVersion,
  onRegenerate,
}: {
  text: string
  modelId: string
  elapsedMs: number | null
  sources: string[]
  versionCount: number
  versionAt: number
  onVersion: (index: number) => void
  onRegenerate?: () => void
}) {
  const [thumb, setThumb] = useState<'up' | 'down' | null>(null)
  const [note, setNote] = useState('')
  const [copied, setCopied] = useState(false)
  const [more, setMore] = useState(false)
  return (
    <div className="reply-row" data-reply-actions="yes">
      <button type="button" className="icon-quiet" aria-label="Copy" data-tip="Copy" data-reply-copy="yes" onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1200)
        }).catch(() => setNote('Could not copy.'))
      }}>{copied ? <Check size={16} /> : <Copy size={16} />}</button>
      <button type="button" className="icon-quiet" aria-label="Thumbs up" data-tip="Like" data-reply-up="yes" aria-pressed={thumb === 'up'} onClick={() => setThumb((current) => current === 'up' ? null : 'up')}><ThumbsUp size={16} /></button>
      <button type="button" className="icon-quiet" aria-label="Thumbs down" data-tip="Dislike" data-reply-down="yes" aria-pressed={thumb === 'down'} onClick={() => setThumb((current) => current === 'down' ? null : 'down')}><ThumbsDown size={16} /></button>
      <button type="button" className="icon-quiet" aria-label="Read aloud" data-tip="Speak" data-reply-aloud="yes" onClick={() => { void readAloud(text).then(setNote) }}><Volume2 size={16} /></button>
      {onRegenerate && <button type="button" className="icon-quiet" aria-label="Regenerate" data-tip="Retry" data-reply-regenerate="yes" onClick={onRegenerate}><RefreshCw size={16} /></button>}
      <button type="button" className="icon-quiet" aria-label="More" data-tip="More" data-reply-more="yes" aria-expanded={more} onClick={() => setMore((open) => !open)}><MoreHorizontal size={16} /></button>
      {versionCount > 1 && (
        <span className="msg-meta" data-reply-versions="yes">
          <button type="button" className="icon-quiet" aria-label="Previous version" disabled={versionAt <= 0} onClick={() => onVersion(versionAt - 1)}>‹</button>
          {versionAt + 1}/{versionCount}
          <button type="button" className="icon-quiet" aria-label="Next version" disabled={versionAt >= versionCount - 1} onClick={() => onVersion(versionAt + 1)}>›</button>
        </span>
      )}
      <span className="msg-meta">{modelId}</span>
      {note && <span className="msg-meta" data-reply-note="yes">{note}</span>}
      {more && (
        <div className="basis-full text-sm text-[var(--muted)]" data-reply-details="yes">
          <p>{modelId}</p>
          <p>{elapsedMs == null ? 'Time: not measured yet' : `Time: ${Math.round(elapsedMs)} ms`}</p>
          <p>{sources.length ? `Sources: ${sources.join(', ')}` : 'Sources: none on this reply'}</p>
        </div>
      )}
    </div>
  )
}

async function readAloud(text: string): Promise<string> {
  const synth = window.speechSynthesis
  if (!synth) return 'No system voice is available on this computer.'
  const ready = synth.getVoices()
  const voices = ready.length ? ready : await new Promise<SpeechSynthesisVoice[]>((resolve) => {
    const timer = window.setTimeout(() => resolve(synth.getVoices()), 400)
    synth.addEventListener('voiceschanged', () => { window.clearTimeout(timer); resolve(synth.getVoices()) }, { once: true })
  })
  if (!voices.length) return 'No system voice is available on this computer.'
  synth.cancel()
  synth.speak(new SpeechSynthesisUtterance(text))
  return ''
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
