import { SurfMark } from '@surf/ui'
import type { ConversationSummary } from '../../../shared/ipc-contract'
import type { View } from '../types'

const AGENTS = [
  { id: 'general', name: 'General', ready: true },
  { id: 'marine', name: 'Marine', ready: false },
  { id: 'construction', name: 'Construction', ready: false },
  { id: 'aviation', name: 'Aviation', ready: false },
]

export function Sidebar({
  view,
  conversations,
  activeId,
  onView,
  onNew,
  onOpen,
}: {
  view: View
  conversations: ConversationSummary[]
  activeId: string | null
  onView: (v: View) => void
  onNew: () => void
  onOpen: (id: string) => void
}) {
  return (
    <aside className="flex h-full w-[272px] shrink-0 flex-col border-r border-[var(--line)] bg-[var(--bg-side)] px-3 py-4">
      <div className="flex items-center gap-2 px-2">
        <SurfMark size={42} />
        <div>
          <div className="text-[15px] font-semibold tracking-tight">Surf AI</div>
          <div className="text-[11px] text-[var(--muted)]">On this computer</div>
        </div>
      </div>
      <button className="btn btn-primary mt-4 w-full" onClick={onNew} type="button">New chat</button>
      <p className="mt-5 px-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Agents</p>
      <div className="mt-1 flex flex-col gap-0.5">
        {AGENTS.map((a) => (
          <button
            key={a.id}
            type="button"
            disabled={!a.ready}
            className="flex items-center justify-between rounded-xl px-2 py-2 text-left text-sm hover:bg-[var(--bg-elev)] disabled:cursor-default disabled:opacity-70"
            onClick={() => { if (a.ready) onView('chat') }}
          >
            <span>{a.name}</span>
            {!a.ready && <span className="pill pill-muted">Soon</span>}
          </button>
        ))}
      </div>
      <p className="mt-4 px-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Chats</p>
      <div className="mt-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-auto">
        {conversations.length === 0 && <p className="px-2 py-2 text-sm text-[var(--muted)]">Nothing saved yet.</p>}
        {conversations.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onOpen(c.id)}
            className={`truncate rounded-xl px-2 py-2 text-left text-sm ${c.id === activeId ? 'bg-[var(--bg-elev)]' : 'hover:bg-[var(--bg-elev)]'}`}
          >
            {c.title}
          </button>
        ))}
      </div>
      <div className="mt-2 flex flex-col gap-1 border-t border-[var(--line)] pt-2">
        <NavButton current={view} id="models" onView={onView}>Models</NavButton>
        <NavButton current={view} id="settings" onView={onView}>Settings</NavButton>
      </div>
    </aside>
  )
}

function NavButton({ current, id, onView, children }: { current: View; id: View; onView: (v: View) => void; children: string }) {
  return (
    <button
      type="button"
      onClick={() => onView(id)}
      className={`rounded-xl px-2 py-2 text-left text-sm ${current === id ? 'bg-[var(--bg-elev)] font-semibold' : 'hover:bg-[var(--bg-elev)]'}`}
    >
      {children}
    </button>
  )
}
