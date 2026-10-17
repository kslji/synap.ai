import { useState } from 'react'
import type { CatalogModel, ModelStatus } from '../../../shared/ipc-contract'
import { codeFileCapBytes, laptopRamClass } from '../../../shared/code-ram'
import { codeModelLine, formatModelSize, modelChoiceLabel, servesAgent } from '../../../shared/model-label'
import { formatBytes } from '../format'
import { ModelGuideButton } from './ModelGuide'

export function chatModels(status: ModelStatus, agentId = 'general'): CatalogModel[] {
  return status.models.filter((model) => model.role === 'chat' && servesAgent(model.agents, agentId))
}

export function codeModels(status: ModelStatus): CatalogModel[] {
  const laptop = laptopRamClass(status.ramGb)
  return listedCodeModels(status).filter((model) => model.minRamGb <= laptop)
}

/** Every Code row in the registry. The picker does not hide a size. */
export function listedCodeModels(status: ModelStatus): CatalogModel[] {
  return chatModels(status, 'code').slice().sort((a, b) => {
    const familyRank = (family: string) => family === 'qwen3.5' ? 0 : 1
    return familyRank(a.family) - familyRank(b.family) || (a.paramsB ?? 0) - (b.paramsB ?? 0)
  })
}

export function activeChatModel(status: ModelStatus): CatalogModel | undefined {
  return chatModels(status).find((model) => model.id === status.chatModelId)
    ?? chatModels(status).find((model) => model.recommended)
    ?? chatModels(status)[0]
}

export function activeCodeModel(status: ModelStatus): CatalogModel | undefined {
  return codeModels(status).find((model) => model.id === status.codeModelId)
    ?? codeModels(status).find((model) => model.defaultFor.includes('code'))
    ?? codeModels(status)[0]
}

export function ModelsScreen({
  status,
  progress,
  busyId,
  error,
  onDownload,
  onCancel,
  onSelect,
}: {
  status: ModelStatus
  progress: Record<string, number>
  busyId: string | null
  error: string | null
  onDownload: (id: string) => void
  onCancel: () => void
  onSelect: (id: string) => void
}) {
  const chats = chatModels(status)
  const code = listedCodeModels(status)
  const current = activeChatModel(status)
  const codeCurrent = activeCodeModel(status)
  const [open, setOpen] = useState(false)
  const [codeOpen, setCodeOpen] = useState(false)
  return (
    <section className="flex-1 overflow-auto px-8 py-8" data-screen="models">
      <div className="mx-auto flex max-w-xl flex-col gap-8">
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
          onCancel={onCancel}
          onSelect={onSelect}
        />
        {code.length > 0 && (
          <ModelPanel
            status={status}
            heading="Code"
            intro="Qwen3.5 2B is the default. Gemma 4 is optional. If you do not pick, Qwen3.5 2B downloads."
            chats={code}
            current={codeCurrent}
            progress={progress}
            busyId={busyId}
            error={null}
            detailsOpen={codeOpen}
            onToggleDetails={() => setCodeOpen((value) => !value)}
            onDownload={onDownload}
            onCancel={onCancel}
            onSelect={onSelect}
          />
        )}
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
  onCancel,
  onSelect,
  heading = 'Models',
  intro,
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
  onCancel: () => void
  onSelect: (id: string) => void
  heading?: string
  intro?: string
}) {
  const embed = heading === 'Models' ? status.models.find((model) => model.role === 'embedding') : undefined
  return (
    <div data-model-panel="yes">
      <h2 className="text-lg font-semibold tracking-tight">{heading}</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">{intro ?? `The chat model is ${current?.label ?? 'Qwen3.5'}.`}</p>
      {heading === 'Code' && (
        <p className="mt-1 text-sm text-[var(--muted)]">
          This computer reports {status.ramGb} GB of RAM ({laptopRamClass(status.ramGb)} GB tier, model file up to {formatModelSize(codeFileCapBytes(status.ramGb))}).
        </p>
      )}
      {heading === 'Code' && (
        <p className="mt-2"><ModelGuideButton /></p>
      )}
      {heading === 'Code' && (
        <p className="mt-2 text-sm text-[var(--muted)]">The screenshot add-on is the Qwen vision projector for the installed model size. It is not downloaded unless you ask, and only when the model and the projector fit this computer.</p>
      )}
      {error && <p className="mt-3 text-sm text-[var(--danger)]">{error}</p>}
      <label className="mt-4 block text-sm font-semibold">
        {heading === 'Code' ? 'Code model' : 'Chat model'}
        <select
          className="field mt-2"
          aria-label={heading === 'Code' ? 'Code model' : 'Chat model'}
          data-chat-model={current?.id ?? ''}
          value={current?.id ?? ''}
          onChange={(event) => onSelect(event.target.value)}
        >
          {chats.map((model) => (
            <option key={model.id} value={model.id}>
              {(heading === 'Code' ? codeModelLine(model) : modelChoiceLabel(model))}{model.installed ? '' : ' · not downloaded'}
            </option>
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
                  <div className="text-xs text-[var(--muted)]">{heading === 'Code' ? codeModelLine(model) : modelChoiceLabel(model)}</div>
                  <div className="text-xs text-[var(--muted)]" data-model-speed={model.id}>{speedLine(status, model)}</div>
                  {heading === 'Code' && model.note && <div className="mt-1 text-xs text-[var(--muted)]">{model.note}</div>}
                </div>
                {model.installed ? <span className="pill pill-ok"><i />Installed</span> : busy ? (
                  <button className="btn btn-ghost" type="button" data-cancel-download={model.id} onClick={onCancel}>Cancel</button>
                ) : (
                  <button className="btn btn-primary" type="button" data-download-model={model.id} onClick={() => onDownload(model.id)}>
                    Download
                  </button>
                )}
              </div>
              {heading === 'Code' && model.family === 'qwen3.5' && model.visionBytes != null && (model.visionOffer || model.visionInstalled) && (
                <div className="mt-3 flex items-center justify-between gap-3" data-vision-offer={model.visionOffer ? 'yes' : 'no'} data-vision-model={model.id}>
                  <div className="text-xs text-[var(--muted)]">Screenshot add-on · {formatModelSize(model.visionBytes)}</div>
                  {model.visionInstalled ? <span className="pill pill-ok"><i />Installed</span> : (
                    <button className="btn btn-ghost" type="button" data-vision-download={model.id} disabled={busyId === `${model.id}#mmproj` || status.offlineOnly || !model.visionOffer} onClick={() => onDownload(`${model.id}#mmproj`)}>
                      {busyId === `${model.id}#mmproj` ? `${Math.min(100, Math.round((progress[`${model.id}#mmproj`] ?? 0) * 100))}%` : 'Download'}
                    </button>
                  )}
                </div>
              )}
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
              {model.peakRamGb != null ? ` Measured peak about ${model.peakRamGb} GB.` : ''}
              {model.ramMeasured === false && model.agents.includes('code') ? ' Peak RAM has not been measured.' : ''}
              {model.note ? ` ${model.note}` : ''}
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

function speedLine(status: ModelStatus, model: CatalogModel): string {
  if (!model.installed) return 'Not installed'
  const bench = status.benchmarks?.find((row) => row.modelId === model.id && row.sizeBytes === model.sizeBytes)
  return bench ? `${bench.tokensPerSec} tok/s` : 'not measured yet'
}
