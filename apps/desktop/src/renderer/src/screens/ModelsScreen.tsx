import { useState } from 'react'
import type { CatalogModel, ModelStatus } from '../../../shared/ipc-contract'
import { friendlyModelName, servesAgent } from '../../../shared/model-label'
import { formatIndexBytes } from '../format'

/** Chat rows for an agent. The registry holds one generic chat model, shared by every agent. */
export function chatModels(status: ModelStatus, agentId = 'general'): CatalogModel[] {
  return status.models.filter((model) => model.role === 'chat' && servesAgent(model.agents, agentId))
}

export function activeChatModel(status: ModelStatus): CatalogModel | undefined {
  return chatModels(status).find((model) => model.id === status.chatModelId)
    ?? chatModels(status).find((model) => model.recommended)
    ?? chatModels(status)[0]
}

export function activeCodeModel(status: ModelStatus): CatalogModel | undefined {
  return chatModels(status, 'code').find((model) => model.id === status.codeModelId)
    ?? chatModels(status, 'code').find((model) => model.defaultFor.includes('code'))
    ?? chatModels(status, 'code')[0]
}

export function ModelsScreen({ status, onRefresh }: { status: ModelStatus; onRefresh?: () => void }) {
  return (
    <section className="flex-1 overflow-auto px-8 py-8" data-screen="models">
      <div className="mx-auto flex max-w-xl flex-col gap-8">
        <ModelPanel status={status} chats={chatModels(status)} onRefresh={onRefresh} />
      </div>
    </section>
  )
}

export function ModelPanel({ status, chats, onRefresh }: { status: ModelStatus; chats: CatalogModel[]; onRefresh?: () => void }) {
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState('')
  const recommended = chats.find((model) => model.defaultFor.includes('*')) ?? chats.find((model) => model.recommended) ?? chats[0]
  if (!recommended) return null
  const act = (model: CatalogModel, run: Promise<unknown>, doing: string) => {
    setBusy(model.id)
    setNote('')
    void run.then(() => {
      setNote(doing === 'remove' ? `${shownName(model)} deleted.` : `${shownName(model)} is on this computer.`)
      onRefresh?.()
    }).catch((error: unknown) => setNote((error as Error).message)).finally(() => setBusy(''))
  }
  return (
    <div data-model-panel="yes">
      <h2 className="text-lg font-semibold tracking-tight">Model</h2>
      <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">Qwen 2B is the default for every agent and needs 8 GB of memory. Qwen 4B is optional, larger, and more accurate. Nothing downloads until you ask.</p>
      <ul className="mt-4 flex flex-col gap-2">
        {chats.map((model) => {
          const isDefault = model.id === recommended.id
          return (
            <li key={model.id} className="card px-4 py-3" data-model-choice={model.id} data-model-default={isDefault ? 'yes' : 'no'} data-installed-model={model.installed ? model.id : undefined}>
              <div className="text-sm font-semibold">
                {shownName(model)}
                {' · '}
                <span data-model-mark={model.id}>{isDefault ? 'Recommended' : 'More accurate'}</span>
              </div>
              <div className="text-xs text-[var(--muted)]" data-model-size={model.id}>
                {formatIndexBytes(model.sizeBytes)} · needs {model.minRamGb} GB memory · {model.installed ? 'on this computer' : 'not downloaded'}
              </div>
              {model.installed && <div className="text-xs text-[var(--muted)]" data-model-speed={model.id}>{speedLine(status, model)}</div>}
              <div className="mt-2 flex flex-wrap gap-2">
                {model.installed ? (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    data-remove-model={model.id}
                    disabled={busy === model.id}
                    onClick={() => act(model, window.surf.models.remove(model.id), 'remove')}
                  >Delete</button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-primary"
                    data-download-model={model.id}
                    disabled={busy === model.id || !model.fitsRam}
                    onClick={() => act(model, window.surf.models.download(model.id), 'download')}
                  >Download</button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
      {note && <p className="mt-2 text-xs" data-model-note="yes">{note}</p>}
    </div>
  )
}

function shownName(model: CatalogModel): string {
  return friendlyModelName({ id: model.id, family: model.family, paramsB: model.paramsB })
}

function speedLine(status: ModelStatus, model: CatalogModel): string {
  const bench = status.benchmarks?.find((row) => row.modelId === model.id && row.sizeBytes === model.sizeBytes)
  return bench ? `${bench.tokensPerSec} tok/s` : 'not measured yet'
}
