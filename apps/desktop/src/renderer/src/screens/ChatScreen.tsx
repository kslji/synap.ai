import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Check, Copy, MoreHorizontal, Plus, RefreshCw, ThumbsDown, ThumbsUp, Volume2 } from 'lucide-react'
import { BlobMascot, blobStateFor, Markdown } from '@surf/ui'
import { balanceMarkdown, clipWords, SPEAK_LIMIT, streamingMarkdown } from '../../../shared/reply-text'
import { useMascotActivity } from '../mascot-activity'
import type { ChunkPreview, CodeProjectStatus, LibraryFile, ModelStatus } from '../../../shared/ipc-contract'
import { BOT_NAME_LIMIT, cleanMascotName } from '../../../main/core/appearance'
import { messagePlaceholder } from '../../../shared/chat-title'
import { friendlyNameFromId } from '../../../shared/model-label'
import { quoteChipLabel } from '../../../shared/quote'
import { MODEL_MISSING_COPY, modelSiteUrl } from '../model-site'
import { formatIndexBytes } from '../format'
import type { UiMsg } from '../types'
import { CodeModeBar, CodeTrace } from './CodeTrace'
import { FileAnswerBody, FilePermissionCard } from './FilePermissions'
import { CodeEditor } from './CodeEditor'
import { CodeShots, type CodeShot } from './CodeShots'
import { MicButton } from './MicButton'
import { placeTranscript, speechProgressLabel } from '../../../main/core/dictation'
import { Preview } from './LibraryScreen'
import { FOLDER_PROMPT } from '../../../main/core/chat-route'

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
  preview,
  agentName,
  agentNote,
  botName = 'Surf',
  onBotName,
  modelLabel,
  tourAttach,
  onSend,
  shots = [],
  onAddShots,
  onRemoveShot,
  onSaveShot,
  onCaptureShot,
  onAttach,
  onPick,
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
  onContinue,
  animateMascot = true,
}: {
  messages: UiMsg[]
  streaming: boolean
  status: ModelStatus
  files: LibraryFile[]
  preview: ChunkPreview | null
  agentName: string
  agentNote?: string
  botName?: string
  onBotName?: (name: string) => void
  modelLabel: string
  tourAttach: boolean
  onSend: (text: string, images?: { mime: CodeShot['mime']; base64: string }[]) => void
  shots?: CodeShot[]
  onAddShots?: (files: File[]) => void
  onRemoveShot?: (id: string) => void
  onSaveShot?: (id: string) => void
  onCaptureShot?: () => void
  onAttach: (paths: string[]) => void
  onPick: () => void
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
  onContinue?: (messageId: string) => void
  animateMascot?: boolean
}) {
  const [confirmingAuto, setConfirmingAuto] = useState(false)
  const [text, setText] = useState('')
  const [listening, setListening] = useState(false)
  const [micNoteText, setMicNoteText] = useState('')
  const [micProgress, setMicProgress] = useState<{ done: number; total: number } | null>(null)
  const fieldRef = useRef<HTMLTextAreaElement>(null)
  const textRef = useRef(text)
  textRef.current = text
  const [over, setOver] = useState(false)
  const [burst, setBurst] = useState<string | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const wasStreaming = useRef(false)
  const messagesRef = useRef(messages)
  messagesRef.current = messages
  const activity = useMascotActivity()
  const chatReady = status.models.some((m) => m.role === 'chat' && m.installed)
  const pending = messages.find((m) => m.pending && m.role === 'assistant')
  const reading = files.some((file) => file.status === 'queued' || file.status === 'running')
  const webSearch = messages.some((m) => m.pending && (m.phase === 'searching' || m.phase === 'files'))
  const webRead = messages.some((m) => m.pending && m.phase === 'reading')
  const writing = Boolean(streaming && pending?.text)
  const toolRun = Boolean(pending && (pending.tools.length > 0 || (pending.steps?.length ?? 0) > 0) && !pending.text)
  const live = webSearch
    ? 'searching'
    : reading || webRead
      ? 'reading'
      : writing
        ? 'writing'
        : streaming && toolRun
          ? 'working'
          : streaming && pending && !pending.text
            ? 'thinking'
            : 'idle'
  const waiting = messages.some((m) => (m.steps ?? []).some((step) => step.status === 'waiting') || (m.diffs ?? []).some((diff) => diff.status === 'pending') || m.plan?.status === 'review')
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')
  useEffect(() => {
    if (streaming) { wasStreaming.current = true; return }
    if (!wasStreaming.current) return
    wasStreaming.current = false
    const last = [...messagesRef.current].reverse().find((m) => m.role === 'assistant')
    if (!last || last.pending) return
    setBurst(last.error ? 'oops' : 'happy')
    const id = window.setTimeout(() => setBurst(null), 1600)
    return () => window.clearTimeout(id)
  }, [streaming])
  const { setTask, setTyping, setPermission, setCaret } = activity
  useEffect(() => {
    setTask(listening ? 'listening' : (burst ?? live))
    return () => setTask(null)
  }, [setTask, burst, live, listening])
  useEffect(() => {
    setTyping(text.trim().length > 0)
    return () => setTyping(false)
  }, [setTyping, text])
  useEffect(() => {
    setPermission(waiting)
    return () => setPermission(false)
  }, [setPermission, waiting])
  useEffect(() => {
    setCaret(writing ? ((pending?.text.length ?? 0) % 42) / 42 : null)
  }, [setCaret, writing, pending?.text])

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight })
  }, [messages])

  function submit(value = text) {
    const t = value.trim()
    const images = shots.map((shot) => ({ mime: shot.mime, base64: shot.base64 }))
    if (streaming || (!t && images.length === 0)) return
    setText('')
    onSend(t, images)
  }

  const bot = cleanMascotName(botName)
  return (
    <section className="flex min-w-0 flex-1" data-listening={listening ? 'yes' : 'no'}>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-center px-6 py-4">
          <div className="shell-title" data-chat-header="yes" data-chat-agent={agentName} title={status.onlineReason} data-online-reason={status.onlineReason}>
            <BlobMascot variant="avatar" state={listening ? 'listening' : 'idle'} size={28} animate={animateMascot} label={bot} />
            <BotNameField name={bot} onSave={(next) => onBotName?.(next)} />
            <span className="agent-tag" data-agent-pill="yes">{agentName}</span>
          </div>
        </header>
        {project && (
          <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-6 py-2" data-code-project="yes">
            <div className="min-w-0 text-xs text-[var(--muted)]">
              <span className="font-semibold text-[var(--ink)]">{folderName(project.root)}</span>
              {' · '}
              {project.state === 'indexing' ? `Indexing ${project.done}/${project.files}` : `${project.files} files`}
              {' · '}
              {formatIndexBytes(project.bytes)}
              {' · '}
              {project.embeddings === 'ready' ? 'keywords + embeddings' : project.embeddings === 'pending' ? 'embeddings catching up' : 'keyword index'}
              {project.error ? ` · ${project.error}` : ''}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {onCodeMode && (
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
                Change folder
              </button>
            </div>
          </div>
        )}
        {project && <CodeEditor enabled={tabSuggestions} languagesOff={tabSuggestionsOff} />}
        <div ref={scroller} className="flex-1 overflow-auto px-6 py-6">
          {messages.length === 0 ? (
            <div className="empty-chat">
              {!chatReady ? (
                <>
                  <BlobMascot state={activity.state} size={120} animate={animateMascot} />
                  <h1 className="empty-title" data-empty-agent="yes">{agentName}</h1>
                  <p className="empty-lead" data-model-missing="yes">{MODEL_MISSING_COPY}</p>
                  <button className="btn btn-primary mt-4" type="button" data-open-site="yes" onClick={() => { void window.surf.links.open(modelSiteUrl()) }}>
                    Open synap.surf
                  </button>
                </>
              ) : (
                <>
                  <BlobMascot state={activity.state} size={148} animate={animateMascot} />
                  <h1 className="empty-title" data-empty-agent="yes">{agentName}</h1>
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
              {messages.map((m) => <Bubble key={m.id} msg={m} botName={bot} live={live} burst={burst} latestId={lastAssistant?.id ?? ''} caret={activity.caret} modelLabel={modelLabel} animateMascot={animateMascot} onOpenCitation={onOpenCitation} onSwitchSmaller={onSwitchSmaller} onCodeDecide={onCodeDecide} onCodeRevise={onCodeRevise} onCodeUndo={onCodeUndo} onCodeUndoAll={onCodeUndoAll} onRegenerate={onRegenerate} onContinue={onContinue} onOpenFolder={onOpenProject} />)}
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
            {reading && (
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-2 text-xs text-[var(--muted)]" data-processing="yes">
                  <BlobMascot state="reading" size={36} variant="avatar" animate={animateMascot} />
                  Reading files
                </span>
              </div>
            )}
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
            {onRemoveShot && onSaveShot && <CodeShots shots={shots} onRemove={onRemoveShot} onSave={onSaveShot} />}
            {(micNoteText || micProgress) && (
              <p className="mic-note" data-mic-note={micNoteText ? 'yes' : 'no'} data-speech-progress={micProgress ? 'yes' : 'no'}>
                {micProgress ? speechProgressLabel(micProgress.done, micProgress.total) : micNoteText}
              </p>
            )}
            <div className="shell-composer flex items-end gap-2" data-composer="yes">
              <AttachMenu tourAttach={tourAttach} onPick={onPick} onAddShots={onAddShots} onCaptureShot={onCaptureShot} />
              <textarea
                ref={fieldRef}
                className="field min-h-[44px]"
                rows={1}
                placeholder={messagePlaceholder(bot)}
                value={text}
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
              <MicButton
                speechModelId={status.speechModelId}
                installed={Boolean(status.models.find((model) => model.id === status.speechModelId)?.installed)}
                modelBytes={status.models.find((model) => model.id === status.speechModelId)?.sizeBytes ?? 0}
                offlineOnly={status.offlineOnly}
                onListening={setListening}
                onTranscript={(spoken) => {
                  const field = fieldRef.current
                  const start = field?.selectionStart ?? textRef.current.length
                  const end = field?.selectionEnd ?? textRef.current.length
                  const next = placeTranscript(textRef.current, spoken, start, end)
                  setText(next.text)
                  requestAnimationFrame(() => {
                    fieldRef.current?.focus()
                    fieldRef.current?.setSelectionRange(next.caret, next.caret)
                  })
                }}
                onStatus={(next) => {
                  setMicNoteText(next.note)
                  setMicProgress(next.progress)
                }}
              />
              {streaming && onStop ? (
                <button className="btn btn-ghost h-9 px-3" type="button" data-code-stop="yes" onClick={onStop}>Stop</button>
              ) : (
                <button className="send-btn" type="submit" aria-label="Send" data-tip="Send" disabled={streaming || (!text.trim() && shots.length === 0)}><ArrowUp size={18} strokeWidth={2.4} /></button>
              )}
            </div>
          </div>
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

function pickImages(onAdd: (files: File[]) => void) {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/png,image/jpeg,image/webp'
  input.multiple = true
  input.onchange = () => {
    const files = [...(input.files ?? [])]
    if (files.length) onAdd(files)
  }
  input.click()
}

function AttachMenu({
  tourAttach,
  onPick,
  onAddShots,
  onCaptureShot,
}: {
  tourAttach: boolean
  onPick: () => void
  onAddShots?: (files: File[]) => void
  onCaptureShot?: () => void
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <div className="attach-menu" ref={root}>
      <button
        type="button"
        className="composer-icon"
        aria-label="Attach"
        aria-haspopup="menu"
        aria-expanded={open}
        data-tip="Attach"
        data-attach-menu="yes"
        data-tour="attach"
        data-tour-target={tourAttach ? 'yes' : 'no'}
        onClick={() => setOpen((current) => !current)}
      >
        <Plus size={18} strokeWidth={2} />
      </button>
      {open && (
        <div className="attach-panel" data-attach-panel="yes" role="menu">
          <button type="button" role="menuitem" data-attach-file="yes" onClick={() => { setOpen(false); onPick() }}>Attach file</button>
          {onAddShots && (
            <button type="button" role="menuitem" data-shot-attach="yes" onClick={() => { setOpen(false); pickImages(onAddShots) }}>Attach image</button>
          )}
          {onCaptureShot && (
            <button type="button" role="menuitem" data-capture-screenshot="yes" onClick={() => { setOpen(false); onCaptureShot() }}>Capture screenshot</button>
          )}
        </div>
      )}
    </div>
  )
}

function BotNameField({ name, onSave }: { name: string; onSave: (name: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  const cancelRef = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { setDraft(name) }, [name])
  useEffect(() => {
    if (!editing) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [editing])
  function commit(value: string) {
    const next = cleanMascotName(value)
    setDraft(next)
    setEditing(false)
    if (next !== name) onSave(next)
  }
  if (!editing) {
    return (
      <button
        type="button"
        className="bot-name"
        data-bot-name="yes"
        aria-label={`Bot name, ${name}. Click to rename.`}
        onClick={() => { cancelRef.current = false; setDraft(name); setEditing(true) }}
      >
        {name}
      </button>
    )
  }
  return (
    <input
      ref={inputRef}
      className="bot-name is-edit"
      data-bot-name-edit="yes"
      aria-label="Bot name"
      value={draft}
      maxLength={BOT_NAME_LIMIT}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          cancelRef.current = true
          commit(event.currentTarget.value)
        } else if (event.key === 'Escape') {
          event.preventDefault()
          cancelRef.current = true
          setDraft(name)
          setEditing(false)
        }
      }}
      onBlur={(event) => {
        if (cancelRef.current) {
          cancelRef.current = false
          return
        }
        commit(event.currentTarget.value)
      }}
    />
  )
}

function Bubble({ msg, botName, live, burst, latestId, caret, modelLabel, animateMascot, onOpenCitation, onSwitchSmaller, onCodeDecide, onCodeRevise, onCodeUndo, onCodeUndoAll, onRegenerate, onContinue, onOpenFolder }: { msg: UiMsg; botName: string; live: string; burst: string | null; latestId: string; caret: number | null; modelLabel: string; animateMascot: boolean; onOpenCitation: (chunkId: number) => void; onSwitchSmaller: (id: string) => void; onCodeDecide?: (messageId: string, id: string, allow: boolean, remember?: boolean, all?: boolean) => void; onCodeRevise?: (messageId: string, order: string[], edits?: { id: string; goal: string }[]) => void; onCodeUndo?: (messageId: string, stepId: string) => void; onCodeUndoAll?: (messageId: string) => void; onRegenerate?: (messageId: string) => void; onContinue?: (messageId: string) => void; onOpenFolder?: () => void }) {
  const [versionAt, setVersionAt] = useState<number | null>(null)
  const [wink, setWink] = useState(false)
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
  const waitingHere = (msg.steps ?? []).some((step) => step.status === 'waiting') || (msg.diffs ?? []).some((diff) => diff.status === 'pending') || msg.plan?.status === 'review'
  const creature = waitingHere ? 'permission' : msg.pending ? live : msg.error ? 'oops' : burst && msg.id === latestId ? burst : 'idle'
  return (
    <div className="msg-in flex gap-3" data-assistant-message="yes" data-streamed={msg.streamed ? 'yes' : 'no'}>
      <div className="pt-1"><BlobMascot variant="avatar" state={blobStateFor(creature)} size={44} animate={animateMascot} wink={wink} caret={msg.pending ? caret : null} /></div>
      <div className="min-w-0 flex-1">
      <div className="assistant-name" data-assistant-name="yes">{botName}</div>
      <div className="assistant-card">
        {msg.pending && msg.phase === 'searching' && <div className="mb-1 text-sm text-[var(--muted)]" data-searching="yes">Searching the web…</div>}
        {msg.pending && msg.phase === 'files' && !msg.fileAsk && <div className="mb-1 text-sm text-[var(--muted)]" data-file-searching="yes">Searching your files…</div>}
        {msg.pending && msg.phase === 'reading' && <div className="mb-1 text-sm text-[var(--muted)]" data-searching="yes">Reading the page…</div>}
        {msg.fileAsk && (
          <FilePermissionCard
            prompt={msg.fileAsk}
            onOnce={() => { void allowFolder(msg.fileAsk!, 'once', false) }}
            onAlways={() => { void allowFolder(msg.fileAsk!, 'always', false) }}
            onDeny={() => { void window.surf.files.decide({ promptId: msg.fileAsk!.id, choice: 'deny', path: null }) }}
            onAdd={() => { void allowFolder(msg.fileAsk!, 'always', true) }}
          />
        )}
        {msg.keywordNote && <div className="mb-1 text-sm text-[var(--muted)]" data-keyword-search="yes">{msg.keywordNote}</div>}
        {msg.sources.some((source) => source.filePath) && shown ? (
          <div className={msg.pending ? 'stream-caret' : ''} data-model-error={msg.error ? 'yes' : 'no'}>
            <FileAnswerBody text={shown} sources={msg.sources} onOpen={(path) => { void window.surf.files.open(path) }} />
          </div>
        ) : shown ? (
          <div className={msg.pending ? 'stream-caret' : ''} data-model-error={msg.error ? 'yes' : 'no'} data-reply-markdown="yes">
            <Markdown
              compact
              source={msg.pending ? streamingMarkdown(shown) : balanceMarkdown(shown)}
              renderText={(text) => <CitedText text={text} sources={msg.sources} onOpen={onOpenCitation} />}
            />
          </div>
        ) : (
          <div className={`text-[15px] leading-relaxed ${msg.pending ? 'stream-caret' : ''}`} data-model-error={msg.error ? 'yes' : 'no'}>
            {msg.pending && !msg.phase ? 'Thinking' : ''}
          </div>
        )}
        {msg.canContinue && !msg.pending && onContinue && (
          <button type="button" className="btn btn-ghost mt-3" data-continue="yes" onClick={() => onContinue(msg.id)}>Continue</button>
        )}
        {msg.error && msg.smallerModelId && (
          <button className="btn btn-ghost mt-2" type="button" data-switch-smaller="yes" onClick={() => onSwitchSmaller(msg.smallerModelId!)}>
            Switch to smaller model
          </button>
        )}
        {shown.trim() === FOLDER_PROMPT && onOpenFolder && (
          <button type="button" className="btn btn-primary mt-3" data-open-folder="yes" onClick={onOpenFolder}>Open folder</button>
        )}
        <CodeTrace messageId={msg.id} steps={msg.steps ?? []} diffs={msg.diffs ?? []} plan={msg.plan} onDecide={onCodeDecide} onRevise={onCodeRevise} onUndo={onCodeUndo} onUndoAll={onCodeUndoAll} />
        {msg.tools.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {msg.tools.map((t, i) => (
              <span key={i} className="pill pill-muted">{t.name}: {t.output}</span>
            ))}
          </div>
        )}
        {msg.sources.some((s) => s.kind !== 'web' && !s.filePath) && (
          <div className="mt-2 flex flex-wrap gap-2">
            {msg.sources.map((s, i) => s.kind === 'web' || s.filePath ? null : (
              <button
                key={i}
                type="button"
                className="pill"
                data-citation="yes"
                data-pack-citation={s.version ? 'yes' : 'no'}
                title={s.excerpt || s.title}
                onClick={() => {
                  if (s.filePath) { void window.surf.files.open(s.filePath); return }
                  if (s.chunkId) onOpenCitation(s.chunkId)
                }}
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
            onCopied={() => { setWink(true); window.setTimeout(() => setWink(false), 420) }}
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
  onCopied,
  onRegenerate,
}: {
  text: string
  modelId: string
  elapsedMs: number | null
  sources: string[]
  versionCount: number
  versionAt: number
  onVersion: (index: number) => void
  onCopied?: () => void
  onRegenerate?: () => void
}) {
  const [thumb, setThumb] = useState<'up' | 'down' | null>(null)
  const [note, setNote] = useState('')
  const [copied, setCopied] = useState(false)
  const [more, setMore] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  return (
    <div className="reply-row" data-reply-actions="yes">
      <button type="button" className="icon-quiet" aria-label="Copy" data-tip="Copy" data-reply-copy="yes" onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true)
          onCopied?.()
          window.setTimeout(() => setCopied(false), 1200)
        }).catch(() => setNote('Could not copy.'))
      }}>{copied ? <Check size={16} /> : <Copy size={16} />}</button>
      <button type="button" className="icon-quiet" aria-label="Thumbs up" data-tip="Like" data-reply-up="yes" aria-pressed={thumb === 'up'} onClick={() => setThumb((current) => current === 'up' ? null : 'up')}><ThumbsUp size={16} /></button>
      <button type="button" className="icon-quiet" aria-label="Thumbs down" data-tip="Dislike" data-reply-down="yes" aria-pressed={thumb === 'down'} onClick={() => setThumb((current) => current === 'down' ? null : 'down')}><ThumbsDown size={16} /></button>
      <button type="button" className="icon-quiet" aria-label="Read aloud" data-tip="Speak" data-reply-aloud="yes" data-speaking={speaking ? 'yes' : 'no'} aria-pressed={speaking} onClick={() => { void toggleSpeak(text, setSpeaking).then((next) => { if (next) setNote(next) }) }}><Volume2 size={16} /></button>
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

async function allowFolder(prompt: { id: string; path: string }, choice: 'once' | 'always', fresh: boolean): Promise<void> {
  const picked = await window.surf.files.pick(fresh ? '' : prompt.path)
  if (!picked.length) return
  const [first, ...rest] = picked
  await window.surf.files.decide({ promptId: prompt.id, choice, path: first ?? null })
  for (const path of rest) {
    try { await window.surf.files.grant({ path, scope: choice }) } catch { /* the first folder still answers the question */ }
  }
}

const NO_VOICE = 'No system voice is available on this computer.'
let speakStop: (() => void) | null = null

function voicesOf(synth: SpeechSynthesis): Promise<SpeechSynthesisVoice[]> {
  const ready = synth.getVoices()
  if (ready.length) return Promise.resolve(ready)
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(synth.getVoices()), 400)
    synth.addEventListener('voiceschanged', () => { window.clearTimeout(timer); resolve(synth.getVoices()) }, { once: true })
  })
}

async function toggleSpeak(text: string, setSpeaking: (on: boolean) => void): Promise<string> {
  if (speakStop) {
    speakStop()
    speakStop = null
    setSpeaking(false)
    return ''
  }
  let stopped = false
  const stop = () => {
    stopped = true
    window.speechSynthesis?.cancel()
    void window.surf.speech.stop()
  }
  speakStop = stop
  setSpeaking(true)
  try {
    const spoken = clipWords(text, SPEAK_LIMIT)
    if (!spoken) return ''
    const result = await window.surf.speech.speak(spoken)
    if (stopped || result.ok) return ''
    const synth = window.speechSynthesis
    const voices = synth ? await voicesOf(synth) : []
    if (stopped) return ''
    if (synth && voices.length) {
      synth.cancel()
      await new Promise<void>((resolve) => {
        const utter = new SpeechSynthesisUtterance(spoken)
        utter.onend = () => resolve()
        utter.onerror = () => resolve()
        synth.speak(utter)
        if (stopped) { synth.cancel(); resolve() }
      })
      return ''
    }
    return result.note || NO_VOICE
  } catch {
    return NO_VOICE
  } finally {
    if (speakStop === stop) speakStop = null
    setSpeaking(false)
  }
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
        if (source?.filePath) {
          const path = source.filePath
          return (
            <button key={i} type="button" className="font-semibold text-[var(--accent-text)] underline" data-file-citation="yes" onClick={() => { void window.surf.files.open(path) }}>
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
