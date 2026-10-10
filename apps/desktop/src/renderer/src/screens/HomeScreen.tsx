import { StarSurf } from '@surf/ui'
import { agentCanChat, type AgentMeta } from '../../../../../../packages/shared/src/agents'
import type { ConversationSummary } from '../../../shared/ipc-contract'

function greeting(now = new Date()): string {
  const hour = now.getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

export function HomeScreen({
  agents,
  conversations,
  onStart,
  onOpen,
  onAsk,
  onDocument,
  onFill,
  onConvert,
  onSearch,
}: {
  agents: AgentMeta[]
  conversations: ConversationSummary[]
  onStart: (agentId: string) => void
  onOpen: (id: string) => void
  onAsk: () => void
  onDocument: () => void
  onFill: () => void
  onConvert: () => void
  onSearch: () => void
}) {
  const recent = conversations.slice(0, 5)
  return (
    <section className="flex-1 overflow-auto px-8 py-8" data-screen="home">
      <div className="mx-auto max-w-4xl">
        <div className="flex items-center gap-4">
          <StarSurf state="idle" size={88} />
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">{greeting()}</h1>
            <p className="mt-1 text-sm text-[var(--muted)]">Pick an agent, or jump back into a chat.</p>
          </div>
        </div>
        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Quick label="Ask anything" onClick={onAsk} />
          <Quick label="Chat with a document" onClick={onDocument} />
          <Quick label="Fill a document" onClick={onFill} />
          <Quick label="Convert a file" onClick={onConvert} />
          <Quick label="Search my files" onClick={onSearch} />
        </div>
        <h2 className="mt-10 text-sm font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Agents</h2>
        <AgentGrid agents={agents} onStart={onStart} />
        <h2 className="mt-10 text-sm font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Recent chats</h2>
        {recent.length === 0 ? (
          <div className="mt-3 flex items-center gap-3 rounded-2xl border border-dashed border-[var(--line)] px-4 py-6">
            <StarSurf state="idle" size={56} />
            <p className="text-sm text-[var(--muted)]">No chats yet. Start with General.</p>
          </div>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {recent.map((chat) => {
              const agent = agents.find((item) => item.id === chat.agentId)
              return (
                <li key={chat.id}>
                  <button type="button" className="card flex w-full items-center justify-between px-4 py-3 text-left" onClick={() => onOpen(chat.id)}>
                    <span className="truncate text-sm font-medium">{chat.title}</span>
                    <span className="shrink-0 text-xs text-[var(--muted)]">{agent?.name ?? chat.agentId}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}

export function AgentsScreen({ agents, onStart }: { agents: AgentMeta[]; onStart: (agentId: string) => void }) {
  return (
    <section className="flex-1 overflow-auto px-8 py-8" data-screen="agents">
      <div className="mx-auto max-w-4xl">
        <h1 className="text-2xl font-semibold tracking-tight">Agents</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">Each agent keeps its own chats.</p>
        <AgentGrid agents={agents} onStart={onStart} />
      </div>
    </section>
  )
}

export function ChatsScreen({
  agents,
  conversations,
  agentId,
  onOpen,
  onNew,
}: {
  agents: AgentMeta[]
  conversations: ConversationSummary[]
  agentId: string
  onOpen: (id: string) => void
  onNew: () => void
}) {
  const agent = agents.find((item) => item.id === agentId)
  const mine = conversations.filter((chat) => chat.agentId === agentId)
  return (
    <section className="flex-1 overflow-auto px-8 py-8" data-screen="chats">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{agent?.name ?? 'Chats'}</h1>
            <p className="mt-1 text-sm text-[var(--muted)]">Only this agent’s history is listed here.</p>
          </div>
          <button className="btn btn-primary" type="button" onClick={onNew}>Start chat</button>
        </div>
        {mine.length === 0 ? (
          <div className="mt-8 flex flex-col items-center px-6 py-10 text-center">
            <StarSurf state="idle" size={120} />
            <p className="mt-2 text-sm text-[var(--muted)]">No chats with {agent?.name ?? 'this agent'} yet.</p>
          </div>
        ) : (
          <ul className="mt-6 flex flex-col gap-2">
            {mine.map((chat) => (
              <li key={chat.id}>
                <button type="button" className="card w-full px-4 py-3 text-left text-sm font-medium" onClick={() => onOpen(chat.id)}>{chat.title}</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

function AgentGrid({ agents, onStart }: { agents: AgentMeta[]; onStart: (agentId: string) => void }) {
  return (
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      {agents.map((agent) => {
        const open = agentCanChat(agent)
        return (
          <article key={agent.id} className="card flex flex-col px-5 py-5" data-agent-card={agent.id} data-agent-status={agent.status}>
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-lg font-semibold tracking-tight">{agent.name}</h3>
              {agent.status !== 'available' && <span className="pill pill-muted">{agent.status === 'beta' ? 'Beta' : 'Coming soon'}</span>}
            </div>
            <p className="mt-1 text-sm font-medium">{agent.tagline}</p>
            <p className="mt-2 flex-1 text-sm leading-relaxed text-[var(--muted)]">{agent.description}</p>
            {agent.notes && <p className="mt-2 text-xs text-[var(--muted)]">{agent.notes}</p>}
            {open ? (
              <button type="button" className="btn btn-primary mt-4 self-start" data-start-chat={agent.id} onClick={() => onStart(agent.id)}>Start chat</button>
            ) : null}
          </article>
        )
      })}
    </div>
  )
}

function Quick({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="card px-4 py-4 text-left text-sm font-semibold" data-quick={label} onClick={onClick}>
      {label}
    </button>
  )
}
