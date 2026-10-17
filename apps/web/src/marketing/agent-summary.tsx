import type { AgentMeta } from '../../../../packages/shared/src/agents'
import { Shell } from './shell'

export function AgentSummary({ agent }: { agent: AgentMeta }) {
  return (
    <Shell>
      <article className="mx-auto max-w-3xl px-6 pb-20 pt-10" data-page={`agent-${agent.id}`} data-agent-card={agent.id}>
        <p className="pill pill-muted">Coming soon</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight">{agent.name}</h1>
        <p className="mt-3 text-lg">{agent.tagline}</p>
        <p className="mt-3 text-[15px] leading-relaxed text-[var(--muted)]">{agent.description}</p>
        {agent.notes && <p className="mt-3 text-sm text-[var(--muted)]">{agent.notes}</p>}
        <p className="mt-4 text-sm leading-relaxed text-[var(--muted)]">This agent does not open in this build. Code is the one you can use.</p>
        <p className="mt-6 flex flex-wrap gap-4 text-sm font-semibold">
          <a href="/agents/code">Read about Code</a>
          <a href="/#agents">All agents</a>
        </p>
      </article>
    </Shell>
  )
}
