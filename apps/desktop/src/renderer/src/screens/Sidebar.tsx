import { StarSurf, ThemeSwitch, type ThemeChoice } from '@surf/ui'
import { product } from '@surf/shared'
import { agentCanChat } from '../../../../../../packages/shared/src/agents'
import { agents } from '../../../../../../packages/shared/src/agent-catalog'
import type { ConversationSummary } from '../../../shared/ipc-contract'
import type { View } from '../types'

const NAV: { id: View; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'agents', label: 'Agents' },
  { id: 'chats', label: 'Chats' },
  { id: 'library', label: 'Files' },
  { id: 'packs', label: 'Packs' },
  { id: 'settings', label: 'Settings' },
]

export function Sidebar({
  view,
  conversations,
  activeId,
  agentId,
  theme,
  onTheme,
  tourId,
  onView,
  onNew,
  onOpen,
  onDelete,
  onAgent,
}: {
  view: View
  conversations: ConversationSummary[]
  activeId: string | null
  agentId: string
  theme: ThemeChoice
  onTheme: (theme: ThemeChoice) => void
  tourId: string | null
  onView: (v: View) => void
  onNew: () => void
  onOpen: (id: string) => void
  onDelete: (id: string) => void
  onAgent: (id: string) => void
}) {
  const mine = conversations.filter((chat) => chat.agentId === agentId)
  const current = agents.find((agent) => agent.id === agentId)
  return (
    <aside className="flex h-full w-[248px] shrink-0 flex-col border-r border-[var(--line)] bg-[var(--bg-side)] px-3 py-4">
      <div className="flex items-center gap-2 px-2">
        <StarSurf state="idle" size={36} />
        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold tracking-tight">{product.name}</div>
          <div className="text-[11px] text-[var(--muted)]">On this computer</div>
        </div>
      </div>
      <nav className="mt-4 flex flex-col gap-0.5" aria-label="Main">
        {NAV.map((item) => (
          <NavButton key={item.id} current={view} id={item.id} onView={onView} tour={tourId === 'agents' && item.id === 'agents'}>{item.label}</NavButton>
        ))}
      </nav>
      <p className="mt-5 px-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Switch agent</p>
      <div className="mt-1 flex flex-col gap-0.5" data-tour="agents" data-tour-target={tourId === 'agents' ? 'yes' : 'no'}>
        {agents.map((agent) => {
          const open = agentCanChat(agent)
          const on = agent.id === agentId
          return (
            <button
              key={agent.id}
              type="button"
              disabled={!open}
              data-agent-card={agent.id}
              className={`flex items-center justify-between rounded-xl px-2 py-2 text-left text-sm ${on ? 'bg-[var(--bg-elev)] font-semibold' : 'hover:bg-[var(--bg-elev)]'} disabled:cursor-default disabled:opacity-70`}
              onClick={() => { if (open) onAgent(agent.id) }}
            >
              <span className="truncate">{agent.name}</span>
              {!open && <span className="pill pill-muted">Soon</span>}
            </button>
          )
        })}
      </div>
      <div className="mt-4 flex items-center justify-between px-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">{current?.name ?? 'Chats'}</p>
        <button className="text-xs font-semibold text-[var(--accent-text)]" type="button" onClick={onNew}>New</button>
      </div>
      <div className="mt-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-auto">
        {mine.length === 0 && <p className="px-2 py-2 text-sm text-[var(--muted)]">No chats yet.</p>}
        {mine.map((c) => (
          <div key={c.id} className={`flex items-center rounded-xl ${c.id === activeId ? 'bg-[var(--bg-elev)]' : 'hover:bg-[var(--bg-elev)]'}`}>
            <button type="button" onClick={() => onOpen(c.id)} className="min-w-0 flex-1 truncate px-2 py-2 text-left text-sm">
              {c.title}
            </button>
            <button type="button" className="shrink-0 px-2 py-2 text-xs text-[var(--muted)]" aria-label={`Delete ${c.title}`} data-delete-chat={c.id} onClick={() => onDelete(c.id)}>
              Delete
            </button>
          </div>
        ))}
      </div>
      <div className="mt-2 border-t border-[var(--line)] pt-3">
        <ThemeSwitch value={theme} onChange={onTheme} compact />
      </div>
    </aside>
  )
}

function NavButton({ current, id, onView, tour, children }: { current: View; id: View; onView: (v: View) => void; tour?: boolean; children: string }) {
  return (
    <button
      type="button"
      onClick={() => onView(id)}
      data-nav={id}
      data-tour-target={tour ? 'yes' : 'no'}
      className={`rounded-xl px-2 py-2 text-left text-sm ${current === id ? 'bg-[var(--bg-elev)] font-semibold' : 'hover:bg-[var(--bg-elev)]'}`}
    >
      {children}
    </button>
  )
}
