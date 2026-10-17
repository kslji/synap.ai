import { useEffect, useState } from 'react'
import { StarSurf, ThemeSwitch, type ThemeChoice } from '@surf/ui'
import { product } from '@surf/shared'
import { agentCanChat } from '../../../../../../packages/shared/src/agents'
import { agents } from '../../../../../../packages/shared/src/agent-catalog'
import type { ConversationSummary, SyncChip } from '../../../shared/ipc-contract'
import type { View } from '../types'

const NAV: { id: View; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'agents', label: 'Agents' },
  { id: 'chats', label: 'Chats' },
  { id: 'usage', label: 'Usage' },
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
  mascotName,
  animateMascot,
  onMascotName,
  onSignIn,
  onView,
  onNew,
  onOpen,
  onDelete,
  onAgent,
  sync,
}: {
  view: View
  conversations: ConversationSummary[]
  activeId: string | null
  agentId: string
  theme: ThemeChoice
  onTheme: (theme: ThemeChoice) => void
  tourId: string | null
  mascotName: string
  animateMascot: boolean
  onMascotName: (name: string) => void
  onSignIn: () => void
  onView: (v: View) => void
  onNew: () => void
  onOpen: (id: string) => void
  onDelete: (id: string) => void
  onAgent: (id: string) => void
  sync?: SyncChip
}) {
  const [query, setQuery] = useState('')
  const [name, setName] = useState(mascotName)
  useEffect(() => { setName(mascotName) }, [mascotName])
  const needle = query.trim().toLowerCase()
  const mine = conversations.filter((chat) => chat.agentId === agentId && (!needle || chat.title.toLowerCase().includes(needle)))
  const current = agents.find((agent) => agent.id === agentId)
  return (
    <aside className="flex h-full min-h-0 w-[248px] shrink-0 flex-col overflow-hidden border-r border-[var(--line)] bg-[var(--bg-side)] px-3 py-4">
      <div className="flex items-center gap-2 px-2">
        <StarSurf state="idle" size={36} animate={animateMascot} clickable label={mascotName} />
        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold tracking-tight" data-mascot-name="yes">{mascotName}</div>
          <div className="text-[11px] text-[var(--muted)]">{product.name}</div>
        </div>
      </div>
      <div className="mt-3 flex min-h-0 flex-1 flex-col overflow-auto">
      <label className="block px-2">
        <span className="sr-only">Rename {mascotName}</span>
        <input
          className="field"
          data-mascot-rename="yes"
          aria-label="Mascot name"
          value={name}
          maxLength={40}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => {
            const next = name.trim() || mascotName
            setName(next)
            if (next !== mascotName) onMascotName(next)
          }}
        />
      </label>
      <button className="btn btn-primary mt-3" type="button" data-new-chat="yes" onClick={onNew}>New chat</button>
      <label className="mt-3 block px-2">
        <span className="sr-only">Search chats</span>
        <input className="field" data-chat-search="yes" aria-label="Search chats" placeholder="Search chats" value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>
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
      <div className="mt-1 flex flex-col gap-0.5">
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
      </div>
      <div className="mt-2 flex shrink-0 flex-col gap-2 border-t border-[var(--line)] pt-3">
        {sync && (
          <p
            className="px-1 text-[11px] leading-snug text-[var(--muted)]"
            data-sync-chip="yes"
            data-sync-state={sync.state}
            data-network-mode={sync.mode}
            data-sync-label={sync.label}
            title={sync.tooltip}
            data-tour="online"
            data-tour-target={tourId === 'online' ? 'yes' : 'no'}
          >
            <span>{sync.label}</span>
            {sync.modeLabel !== sync.label && <span data-network-mode-label="yes"> · {sync.modeLabel}</span>}
          </p>
        )}
        <ThemeSwitch value={theme} onChange={onTheme} compact />
        <button className="btn btn-ghost" type="button" data-sign-in="yes" onClick={onSignIn}>Sign in</button>
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
