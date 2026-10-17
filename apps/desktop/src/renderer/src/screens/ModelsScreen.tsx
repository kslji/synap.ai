import type { CatalogModel, ModelStatus } from '../../../shared/ipc-contract'
import { laptopRamClass } from '../../../shared/code-ram'
import { friendlyModelName, servesAgent } from '../../../shared/model-label'
import { MODEL_ANOTHER_COPY, modelSiteUrl } from '../model-site'
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

export function ModelsScreen({ status }: { status: ModelStatus }) {
  const chats = chatModels(status)
  const code = listedCodeModels(status)
  return (
    <section className="flex-1 overflow-auto px-8 py-8" data-screen="models">
      <div className="mx-auto flex max-w-xl flex-col gap-8">
        <ModelPanel status={status} chats={chats} />
        <ModelPanel status={status} heading="Code" chats={code} />
      </div>
    </section>
  )
}

export function ModelPanel({
  status,
  chats,
  heading = 'Models',
}: {
  status: ModelStatus
  chats: CatalogModel[]
  heading?: string
}) {
  const installed = chats.filter((model) => model.installed)
  return (
    <div data-model-panel="yes">
      <h2 className="text-lg font-semibold tracking-tight">{heading === 'Code' ? 'Code' : 'Chat'}</h2>
      {heading === 'Code' && (
        <p className="mt-2"><ModelGuideButton /></p>
      )}
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
      {heading !== 'Code' && (
        <button className="btn btn-ghost mt-4" type="button" data-open-site="yes" onClick={() => { void window.surf.links.open(modelSiteUrl()) }}>
          {MODEL_ANOTHER_COPY}
        </button>
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
