import type { CatalogModel, ModelStatus } from '../../../shared/ipc-contract'
import { friendlyModelName, servesAgent } from '../../../shared/model-label'

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

export function ModelsScreen({ status }: { status: ModelStatus }) {
  return (
    <section className="flex-1 overflow-auto px-8 py-8" data-screen="models">
      <div className="mx-auto flex max-w-xl flex-col gap-8">
        <ModelPanel status={status} chats={chatModels(status)} />
      </div>
    </section>
  )
}

export function ModelPanel({ status, chats }: { status: ModelStatus; chats: CatalogModel[] }) {
  const installed = chats.filter((model) => model.installed)
  return (
    <div data-model-panel="yes">
      <h2 className="text-lg font-semibold tracking-tight">Model</h2>
      <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">One model for every agent. It needs 8 GB of memory.</p>
      {installed.length > 0 && (
        <ul className="mt-4 flex flex-col gap-2">
          {installed.map((model) => (
            <li key={model.id} className="card px-4 py-3" data-installed-model={model.id}>
              <div className="text-sm font-semibold">{shownName(model)}, on this computer</div>
              <div className="text-xs text-[var(--muted)]" data-model-speed={model.id}>{speedLine(status, model)}</div>
            </li>
          ))}
        </ul>
      )}
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
