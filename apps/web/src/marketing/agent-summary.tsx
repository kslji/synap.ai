import type { AgentMeta } from '../../../../packages/shared/src/agents'
import { Shell } from './shell'

export function AgentSummary({ agent }: { agent: AgentMeta }) {
  const soon = agent.status === 'coming soon'
  return (
    <Shell>
      <article className="mx-auto max-w-3xl px-6 pb-20 pt-10" data-page={`agent-${agent.id}`} data-agent-card={agent.id}>
        <p className="pill">{soon ? 'Coming soon' : agent.status === 'beta' ? 'Beta' : 'On this computer'}</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight">{agent.name}</h1>
        <p className="mt-3 text-lg">{agent.tagline}</p>
        <p className="mt-3 text-[15px] leading-relaxed text-[var(--muted)]">{agent.description}</p>
        {agent.notes && <p className="mt-3 text-sm text-[var(--muted)]">{agent.notes}</p>}
        {soon && <p className="mt-4 text-sm leading-relaxed text-[var(--muted)]">This agent is listed in the app as coming soon. It does not open in this build.</p>}
        <p className="mt-6"><a href="/#agents">All agents</a></p>
      </article>
    </Shell>
  )
}
