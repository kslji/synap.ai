import { useState } from 'react'
import { SurfCrew, ThemeSwitch, type ThemeChoice } from '@surf/ui'
import type { ModelStatus } from '../../../shared/ipc-contract'
import { formatBytes, tierLabel } from '../format'

export function Onboarding({
  status,
  progress,
  error,
  theme,
  onTheme,
  onDownload,
  onReady,
}: {
  status: ModelStatus
  progress: number
  error: string | null
  theme: ThemeChoice
  onTheme: (theme: ThemeChoice) => void
  onDownload: (chatId: string) => Promise<void>
  onReady: (chatId: string) => void
}) {
  const suggested = status.models.find((m) => m.recommended)?.id ?? status.models.find((m) => m.role === 'chat' && m.fitsRam)?.id ?? ''
  const chosen = status.models.find((m) => m.id === suggested)
  const embed = status.models.find((m) => m.role === 'embedding')
  const ready = Boolean(chosen?.installed && embed?.installed)
  const [working, setWorking] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const shownError = localError ?? error

  async function start() {
    setLocalError(null)
    if (!suggested) {
      setLocalError('No chat model fits this computer.')
      return
    }
    if (!ready) {
      setWorking(true)
      try { await onDownload(suggested) }
      catch (e) {
        setLocalError((e as Error).message)
        setWorking(false)
        return
      }
      setWorking(false)
    }
    onReady(suggested)
  }

  return (
    <main className="relative flex h-full items-center justify-center bg-[var(--bg)] px-6" data-screen="onboarding" data-first-launch="yes">
      <div className="absolute right-4 top-4">
        <ThemeSwitch value={theme} onChange={onTheme} />
      </div>
      <div className="card w-full max-w-xl px-8 py-8">
        <SurfCrew mood={working ? 'thinking' : 'idle'} size={200} />
        <p className="mt-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">Welcome</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Surf AI stays on this computer</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-[var(--muted)]">
          This beta is not signed by Apple or Microsoft. macOS or Windows may ask once before it opens. Chats stay in an encrypted database on this machine. Surf does not edit, move, or delete your files on its own. Web search stays off until you allow it, and then only the short query leaves the device.
        </p>
        <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
          <Stat k="Memory" v={`${status.ramGb} GB`} />
          <Stat k="Fit" v={tierLabel(status.tier)} />
          <Stat k="Chip" v={`${status.platform} ${status.arch}`} />
          <Stat k="Model" v={chosen?.label ?? 'None'} />
        </dl>
        <p className="mt-4 text-sm leading-relaxed text-[var(--muted)]">
          {ready
            ? 'The recommended model and EmbeddingGemma 2 are already here. Chat works offline.'
            : `${chosen?.label ?? 'The recommended model'} (${chosen ? formatBytes(chosen.sizeBytes) : ''}) and EmbeddingGemma 2 download next. You can quit and resume. After that, chat works offline.`}
        </p>
        {working && (
          <div className="mt-4" data-download-progress="yes">
            <div className="progress"><b style={{ width: `${Math.round(progress * 100)}%` }} /></div>
            <p className="mt-2 text-xs text-[var(--muted)]">{Math.round(progress * 100)}%</p>
          </div>
        )}
        {shownError && <p className="mt-3 text-sm text-[var(--danger)]">{shownError}</p>}
        <div className="mt-6 flex flex-wrap gap-2">
          <button className="btn btn-primary" type="button" data-first-launch-go="yes" onClick={() => void start()} disabled={working || status.offlineOnly && !ready}>
            {ready ? 'Start chatting' : status.offlineOnly ? 'Turn off Offline only' : working ? 'Downloading' : 'Download and start chatting'}
          </button>
          {(shownError || status.offlineOnly) && !ready && (
            <button className="btn btn-ghost" type="button" onClick={() => onReady(suggested)} disabled={!suggested}>Open chat anyway</button>
          )}
        </div>
      </div>
    </main>
  )
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-2xl bg-[var(--bg)] px-3 py-3">
      <dt className="text-xs text-[var(--muted)]">{k}</dt>
      <dd className="mt-1 truncate text-sm font-semibold">{v}</dd>
    </div>
  )
}
