import { BlobMascot, ThemeSwitch, type ThemeChoice } from '@surf/ui'
import {
  formatByteCount,
  formatByteRate,
  setupChoiceNote,
  setupErrorCopy,
} from '../../../shared/setup-choice'
import type { SetupSnapshot } from '../../../shared/setup-choice'

export function SetupScreen({
  snapshot,
  theme,
  onTheme,
  onPause,
  onResume,
  onRetry,
  onUseSmaller,
}: {
  snapshot: SetupSnapshot
  theme: ThemeChoice
  onTheme: (theme: ThemeChoice) => void
  onPause: () => void
  onResume: () => void
  onRetry: () => void
  onUseSmaller: (modelId: string) => void
}) {
  const busy = snapshot.phase === 'downloading' || snapshot.phase === 'copying' || snapshot.phase === 'checking'
  const mascot = snapshot.error?.code === 'offline' ? 'offline' : snapshot.error ? 'oops' : 'working'
  const note = setupChoiceNote(snapshot.source, snapshot.modelName || 'Qwen', snapshot.ramGb)
  const errorCopy = snapshot.error ? setupErrorCopy(snapshot.error) : null
  const percent = snapshot.total > 0 ? Math.min(100, Math.round((snapshot.done / snapshot.total) * 100)) : 0
  const speed = snapshot.bytesPerSecond != null ? formatByteRate(snapshot.bytesPerSecond) : ''
  const amounts = snapshot.total > 0 ? `${formatByteCount(snapshot.done)} of ${formatByteCount(snapshot.total)}` : ''

  return (
    <main className="relative flex h-full items-center justify-center bg-[var(--bg)] px-6" data-screen="setup" data-setup-phase={snapshot.phase} data-setup-model={snapshot.modelId} data-mascot-state={mascot}>
      <div className="absolute right-4 top-4">
        <ThemeSwitch value={theme} onChange={onTheme} />
      </div>
      <div className="card w-full max-w-xl px-8 py-8">
        <BlobMascot state={mascot} size={180} />
        <p className="mt-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">First open</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          {errorCopy ? errorCopy.title : snapshot.phase === 'paused' ? 'Paused' : `Setting up ${snapshot.modelName || 'Qwen'}`}
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-[var(--muted)]" data-setup-note="yes">{errorCopy ? errorCopy.body : note}</p>
        {amounts && (
          <p className="mt-4 text-sm font-semibold" data-setup-bytes={snapshot.done} data-setup-total={snapshot.total}>
            {amounts}
            {speed ? <span data-setup-speed={snapshot.bytesPerSecond}> · {speed}</span> : null}
          </p>
        )}
        {snapshot.total > 0 && (busy || snapshot.phase === 'paused') && (
          <div className="progress mt-3" aria-hidden="true"><b style={{ width: `${percent}%` }} /></div>
        )}
        <div className="mt-6 flex flex-wrap gap-2">
          {busy && snapshot.phase !== 'checking' && (
            <button className="btn btn-ghost" type="button" data-setup-pause="yes" onClick={onPause}>Pause</button>
          )}
          {snapshot.phase === 'paused' && (
            <button className="btn btn-primary" type="button" data-setup-resume="yes" onClick={onResume}>Resume</button>
          )}
          {snapshot.error && snapshot.error.code !== 'ram' && (
            <button className="btn btn-primary" type="button" data-setup-retry="yes" onClick={onRetry}>Retry</button>
          )}
          {snapshot.error?.code === 'ram' && snapshot.error.suggestId && snapshot.error.suggestName && (
            <button className="btn btn-primary" type="button" data-setup-smaller={snapshot.error.suggestId} onClick={() => onUseSmaller(snapshot.error?.suggestId || '')}>
              Use {snapshot.error.suggestName}
            </button>
          )}
        </div>
      </div>
    </main>
  )
}
