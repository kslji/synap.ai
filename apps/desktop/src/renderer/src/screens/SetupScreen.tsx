import { BlobMascot, ThemeSwitch, type ThemeChoice } from '@surf/ui'
import {
  formatByteCount,
  formatByteRate,
  setupErrorCopy,
} from '../../../shared/setup-choice'
import type { SetupFileView, SetupSnapshot } from '../../../shared/setup-choice'

export function SetupScreen({
  snapshot,
  theme,
  onTheme,
  onPause,
  onResume,
  onRetry,
  onDownload,
  onUseFile,
}: {
  snapshot: SetupSnapshot
  theme: ThemeChoice
  onTheme: (theme: ThemeChoice) => void
  onPause: () => void
  onResume: () => void
  onRetry: () => void
  onDownload: (modelId: string) => void
  onUseFile: (modelId: string) => void
}) {
  const picking = snapshot.phase === 'pick'
  const mascot = snapshot.error?.code === 'offline' ? 'offline' : snapshot.error ? 'oops' : picking ? 'guiding' : 'working'
  const errorCopy = snapshot.error ? setupErrorCopy(snapshot.error) : null
  const title = errorCopy
    ? errorCopy.title
    : snapshot.phase === 'paused'
      ? 'Paused'
      : picking
        ? 'Choose a model'
        : snapshot.phase === 'checking'
          ? 'Checking this computer'
          : `Setting up ${snapshot.modelName || 'Qwen'}`
  const chatPending = snapshot.files.some((file) => file.role === 'chat' && file.state !== 'done')
  const note = errorCopy
    ? errorCopy.body
    : picking
      ? 'Pick Qwen 2B, 4B, or 9B. The search model downloads with it.'
      : snapshot.phase === 'paused'
        ? 'The part that already arrived is kept. Resume continues from there.'
        : snapshot.phase === 'checking'
          ? (snapshot.localCopy
            ? 'Checking the models that came with this installer.'
            : 'Looking at free space and any copy already in Downloads.')
          : snapshot.localCopy
            ? 'Copying Qwen and the search model from this installer. Chat opens when both check out.'
            : chatPending
              ? 'Qwen and the search model download together. Chat opens when both check out.'
              : 'The search model is downloading. Chat opens when it checks out.'

  return (
    <main className="relative flex h-full items-center justify-center bg-[var(--bg)] px-6" data-screen="setup" data-setup-phase={snapshot.phase} data-setup-model={snapshot.modelId} data-mascot-state={mascot}>
      <div className="absolute right-4 top-4">
        <ThemeSwitch value={theme} onChange={onTheme} />
      </div>
      <div className="card w-full max-w-xl px-8 py-6">
        <BlobMascot state={mascot} size={picking ? 88 : 140} />
        <p className="mt-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">{picking || chatPending || (snapshot.files.length === 0 && snapshot.modelName !== 'Search model') ? 'First open' : 'Search model'}</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-[var(--muted)]" data-setup-note="yes">{note}</p>
        {picking && (
          <ul className="mt-4 flex flex-col gap-2">
            {snapshot.choices.map((choice) => (
              <li key={choice.id} className="rounded-xl border border-[var(--line)] px-4 py-3" data-setup-choice={choice.id} data-recommended={choice.recommended ? 'yes' : 'no'}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">{choice.name}</span>
                  {choice.recommended && <span className="pill" data-setup-recommended="yes">Recommended for your laptop</span>}
                </div>
                <p className="mt-1 text-xs text-[var(--muted)]" data-setup-size={choice.id}>
                  {formatByteCount(choice.withSearchBytes)} · needs {choice.minRamGb} GB RAM
                </p>
                <p className="mt-0.5 text-xs text-[var(--muted)]" data-setup-parts={choice.id}>
                  {formatByteCount(choice.sizeBytes)} model + {formatByteCount(choice.withSearchBytes - choice.sizeBytes)} search model
                </p>
                {choice.warning && <p className="mt-1 text-xs leading-relaxed" data-setup-warning={choice.id}>{choice.warning}</p>}
                <div className="mt-2 flex flex-wrap gap-2">
                  {choice.inDownloads && (
                    <button className="btn btn-ghost" type="button" data-setup-use-file={choice.id} onClick={() => onUseFile(choice.id)}>
                      Use the file in Downloads
                    </button>
                  )}
                  <button className="btn btn-primary" type="button" data-setup-download={choice.id} onClick={() => onDownload(choice.id)}>
                    Download
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {!picking && snapshot.files.length > 0 && snapshot.total > 0 && (
          <p className="mt-4 text-sm font-semibold" data-setup-combined="yes">
            {formatByteCount(snapshot.done)} of {formatByteCount(snapshot.total)}
          </p>
        )}
        {!picking && snapshot.files.length > 0 && (
          <ul className={snapshot.total > 0 ? 'mt-3 flex flex-col gap-3' : 'mt-4 flex flex-col gap-3'}>
            {snapshot.files.map((file) => (
              <FileRow key={file.id} file={file} speed={file.state === 'active' && snapshot.phase === 'downloading' ? snapshot.bytesPerSecond : null} showBar={file.state === 'active'} />
            ))}
          </ul>
        )}
        <div className="mt-5 flex flex-wrap gap-2">
          {snapshot.phase === 'downloading' && (
            <button className="btn btn-ghost" type="button" data-setup-pause="yes" onClick={onPause}>Pause</button>
          )}
          {snapshot.phase === 'paused' && (
            <button className="btn btn-primary" type="button" data-setup-resume="yes" onClick={onResume}>Resume</button>
          )}
          {snapshot.error && (
            <button className="btn btn-primary" type="button" data-setup-retry="yes" onClick={onRetry}>Retry</button>
          )}
        </div>
      </div>
    </main>
  )
}

function FileRow({ file, speed, showBar }: { file: SetupFileView; speed: number | null; showBar: boolean }) {
  const percent = file.total > 0 ? Math.min(100, Math.round((file.done / file.total) * 100)) : 0
  const rate = speed != null ? formatByteRate(speed) : ''
  const label = file.state === 'waiting' ? 'Waiting' : file.state === 'done' ? 'Done' : ''
  return (
    <li data-setup-file={file.id} data-setup-file-state={file.state}>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-semibold">{file.name}</span>
        <span data-setup-bytes={file.done} data-setup-total={file.total}>
          {formatByteCount(file.done)} of {formatByteCount(file.total)}
          {rate ? <span data-setup-speed={speed}> · {rate}</span> : null}
          {label ? <span> · {label}</span> : null}
        </span>
      </div>
      {showBar && <div className="progress mt-2" aria-hidden="true"><b style={{ width: `${percent}%` }} /></div>}
    </li>
  )
}
