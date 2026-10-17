import type { AgentMeta } from '../../../../packages/shared/src/agents'
import { agents } from '../../../../packages/shared/src/agent-catalog'

const PAGE: Record<string, string> = {
  general: '/agents/general',
  code: '/agents/code',
  assistant: '/features#assistant',
}

export function AgentSuite({ list = agents }: { list?: AgentMeta[] }) {
  return (
    <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {list.map((agent) => {
        const href = PAGE[agent.id]
        const soon = agent.status === 'coming soon'
        return (
          <article key={agent.id} className="card flex flex-col px-5 py-5" data-agent-card={agent.id} data-agent-status={agent.status}>
            <div className="flex items-center justify-between gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl text-sm font-semibold text-[var(--accent-ink)]" style={{ background: agent.accent }} aria-hidden="true">
                {agent.name.slice(0, 1)}
              </span>
              {agent.status !== 'available' && <span className="pill pill-muted">{soon ? 'Coming soon' : 'Beta'}</span>}
            </div>
            <h3 className="mt-4 text-xl font-semibold tracking-tight">{agent.name}</h3>
            <p className="mt-1 text-sm font-medium">{agent.tagline}</p>
            <p className="mt-2 flex-1 text-sm leading-relaxed text-[var(--muted)]">{agent.description}</p>
            {agent.notes && <p className="mt-3 text-xs leading-relaxed text-[var(--muted)]">{agent.notes}</p>}
            {href && <a className="mt-4 text-sm font-semibold" href={href}>Read about {agent.name}</a>}
            {soon && <p className="mt-4 text-sm text-[var(--muted)]">Shown here the same way the app lists it. It does not open yet.</p>}
          </article>
        )
      })}
    </div>
  )
}
