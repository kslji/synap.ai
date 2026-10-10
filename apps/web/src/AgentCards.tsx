import React from 'react'
import { agentCanOpen, type AgentMeta } from '../../../packages/shared/src/agents'

export function AgentCards({ agents, onOpen }: { agents: AgentMeta[]; onOpen?: (id: string) => void }) {
  return (
    <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {agents.map((agent) => {
        const open = agentCanOpen(agent)
        return (
          <article key={agent.id} className="card flex flex-col px-5 py-5" data-agent-card={agent.id} data-agent-status={agent.status}>
            <div className="flex items-center justify-between gap-3">
              <span
                className="inline-flex h-10 w-10 items-center justify-center rounded-2xl text-sm font-semibold text-[var(--accent-ink)]"
                style={{ background: agent.accent }}
                aria-hidden="true"
              >
                {(agent.icon || agent.name).slice(0, 1).toUpperCase()}
              </span>
              {agent.status !== 'available' && <span className="pill pill-muted">{agent.status === 'beta' ? 'Beta' : 'Coming soon'}</span>}
            </div>
            <h3 className="mt-4 text-xl font-semibold tracking-tight">{agent.name}</h3>
            <p className="mt-1 text-sm font-medium">{agent.tagline}</p>
            <p className="mt-2 flex-1 text-sm leading-relaxed text-[var(--muted)]">{agent.description}</p>
            {agent.notes && <p className="mt-3 text-xs leading-relaxed text-[var(--muted)]">{agent.notes}</p>}
            {open && onOpen && (
              <button type="button" className="btn btn-primary mt-4" onClick={() => onOpen(agent.id)}>Open</button>
            )}
            {open && !onOpen && (
              <a className="btn btn-primary mt-4 no-underline" href="#download">Download</a>
            )}
          </article>
        )
      })}
    </div>
  )
}
