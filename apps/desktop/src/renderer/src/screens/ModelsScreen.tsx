import { useState } from 'react'
import type { CatalogModel, ModelStatus } from '../../../shared/ipc-contract'
import { formatBytes } from '../format'

export function chatModels(status: ModelStatus): CatalogModel[] {
  return status.models.filter((model) => model.role === 'chat')
}

export function activeChatModel(status: ModelStatus): CatalogModel | undefined {
  return chatModels(status).find((model) => model.id === status.chatModelId)
    ?? chatModels(status).find((model) => model.recommended)
    ?? chatModels(status)[0]
}

export function ModelsScreen({
  status,
  progress,
  busyId,
  error,
  onDownload,
  onSelect,
}: {
  status: ModelStatus
  progress: Record<string, number>
  busyId: string | null
  error: string | null
  onDownload: (id: string) => void
  onSelect: (id: string) => void
}) {
  const chats = chatModels(status)
  const current = activeChatModel(status)
  const [open, setOpen] = useState(false)
  return (
    <section className="flex-1 overflow-auto px-8 py-8" data-screen="models">
      <div className="mx-auto max-w-xl">
        <ModelPanel
          status={status}
          chats={chats}
          current={current}
          progress={progress}
          busyId={busyId}
          error={error}
          detailsOpen={open}
          onToggleDetails={() => setOpen((value) => !value)}
          onDownload={onDownload}
          onSelect={onSelect}
        />
      </div>
    </section>
  )
}

export function ModelPanel({
  status,
  chats,
  current,
  progress,
  busyId,
  error,
  detailsOpen,
  onToggleDetails,
  onDownload,
  onSelect,
}: {
  status: ModelStatus
  chats: CatalogModel[]
  current: CatalogModel | undefined
  progress: Record<string, number>
  busyId: string | null
  error: string | null
  detailsOpen: boolean
  onToggleDetails: () => void
  onDownload: (id: string) => void
  onSelect: (id: string) => void
}) {
  const embed = status.models.find((model) => model.role === 'embedding')
  return (
    <div data-model-panel="yes">
      <h2 className="text-lg font-semibold tracking-tight">Models</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">The chat model is {current?.label ?? 'Qwen3.5'}.</p>
      {error && <p className="mt-3 text-sm text-[var(--danger)]">{error}</p>}
      <label className="mt-4 block text-sm font-semibold">
        Chat model
        <select
          className="field mt-2"
          aria-label="Chat model"
          data-chat-model={current?.id ?? ''}
          value={current?.id ?? ''}
          onChange={(event) => onSelect(event.target.value)}
        >
          {chats.map((model) => (
            <option key={model.id} value={model.id}>{model.label}{model.installed ? '' : ' · not downloaded'}</option>
          ))}
        </select>
      </label>
      <ul className="mt-4 flex flex-col gap-2">
        {chats.map((model) => {
          const pct = progress[model.id] != null ? Math.min(100, Math.round(progress[model.id] * 100)) : 0
          const busy = busyId === model.id
          return (
            <li key={model.id} className="card px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">{model.label}</div>
                  <div className="text-xs text-[var(--muted)]">{model.recommended ? 'Fits this computer' : model.fitsRam ? 'Also fits' : 'Needs more memory'}</div>
                </div>
                {model.installed ? <span className="pill pill-ok"><i />Installed</span> : (
                  <button className="btn btn-primary" type="button" disabled={busy || status.offlineOnly} onClick={() => onDownload(model.id)}>
                    {busy ? `${pct}%` : 'Download'}
                  </button>
                )}
              </div>
              {busy && <div className="progress mt-3"><b style={{ width: `${pct}%` }} /></div>}
            </li>
          )
        })}
      </ul>
      <button className="btn btn-ghost mt-4" type="button" data-model-details={detailsOpen ? 'open' : 'closed'} aria-expanded={detailsOpen} onClick={onToggleDetails}>
        {detailsOpen ? 'Hide details' : 'Details'}
      </button>
      {detailsOpen && (
        <div className="card mt-3 px-4 py-4 text-sm leading-relaxed text-[var(--muted)]" data-model-details-body="yes">
          {chats.map((model) => (
            <p key={model.id} className="mt-2 first:mt-0">
              <span className="font-semibold text-[var(--ink)]">{model.label}.</span>
              {' '}File {model.file ?? 'unknown'}.
              {model.quant ? ` Quant ${model.quant}.` : ''}
              {' '}Size {formatBytes(model.sizeBytes)}.
            </p>
          ))}
          {embed && (
            <p className="mt-3">
              <span className="font-semibold text-[var(--ink)]">Helper.</span>
              {' '}{embed.label} is used in the background and is not a chat model.
              {embed.file ? ` File ${embed.file}.` : ''}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
