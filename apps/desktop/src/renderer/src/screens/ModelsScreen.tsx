import type { CatalogModel, ModelStatus } from '../../../shared/ipc-contract'
import { formatBytes, tierLabel } from '../format'

export function ModelsScreen({
  status,
  progress,
  busyId,
  error,
  onDownload,
}: {
  status: ModelStatus
  progress: Record<string, number>
  busyId: string | null
  error: string | null
  onDownload: (id: string) => void
}) {
  const chat = status.models.filter((m) => m.role === 'chat' || m.role === 'embedding')
  const later = status.models.filter((m) => m.role === 'asr' || m.role === 'vad')
  return (
    <section className="flex-1 overflow-auto px-8 py-8">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight">Models</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {status.ramGb} GB RAM · {tierLabel(status.tier)} · {status.cores} cores. Files download from Hugging Face and stay on this computer.
        </p>
        {error && <p className="mt-3 text-sm text-[var(--danger)]">{error}</p>}
        <div className="mt-6 flex flex-col gap-3">
          {chat.map((m) => (
            <ModelCard key={m.id} model={m} progress={progress[m.id]} busy={busyId === m.id} offlineOnly={status.offlineOnly} onDownload={onDownload} />
          ))}
        </div>
        <h2 className="mt-8 text-sm font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Later</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">Speech models land in week 2. Images in your documents are read with on-device OCR. The Qwen vision projector is optional and is not downloaded automatically.</p>
        <div className="mt-3 flex flex-col gap-2">
          {later.map((m) => (
            <div key={m.id} className="card flex items-center justify-between px-4 py-3 opacity-70">
              <span className="text-sm">{m.label}</span>
              <span className="pill pill-muted">Week 2</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function ModelCard({
  model, progress, busy, offlineOnly, onDownload,
}: {
  model: CatalogModel
  progress?: number
  busy: boolean
  offlineOnly: boolean
  onDownload: (id: string) => void
}) {
  const pct = progress != null ? Math.min(100, Math.round(progress * 100)) : 0
  return (
    <article className="card px-5 py-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{model.label}</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">{formatBytes(model.sizeBytes)} · needs about {model.minRamGb} GB</p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {model.recommended && <span className="pill">Suggested</span>}
          {model.installed && <span className="pill pill-ok"><i />Installed</span>}
          <span className={`pill ${model.fitsRam ? 'pill-ok' : 'pill-warn'}`}>{model.fitsRam ? 'Fits this computer' : 'Needs more RAM'}</span>
        </div>
      </div>
      {busy && (
        <div className="mt-3">
          <div className="progress"><b style={{ width: `${pct}%` }} /></div>
          <p className="mt-1 text-xs text-[var(--muted)]">{pct}%</p>
        </div>
      )}
      {!model.installed && (
        <button className="btn btn-primary mt-3" type="button" disabled={busy || offlineOnly || !model.fitsRam && model.role === 'chat' && !model.recommended} onClick={() => onDownload(model.id)}>
          {offlineOnly ? 'Offline only is on' : busy ? 'Downloading' : 'Download'}
        </button>
      )}
    </article>
  )
}
