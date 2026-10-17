import { useEffect, useState } from 'react'
import { BarChart3, Bot, Folder, Home, LogOut, Moon, Package, Plus, Search, Settings, Trash2 } from 'lucide-react'
import { StarSurf, type ThemeChoice } from '@surf/ui'
import { agentCanChat } from '../../../../../../packages/shared/src/agents'
import { agents } from '../../../../../../packages/shared/src/agent-catalog'
import type { ConversationSummary, SyncChip } from '../../../shared/ipc-contract'
import type { View } from '../types'

const MENU: { id: View; label: string; icon: typeof Home }[] = [
  { id: 'usage', label: 'Usage', icon: BarChart3 },
  { id: 'home', label: 'Home', icon: Home },
  { id: 'agents', label: 'Agents', icon: Bot },
  { id: 'library', label: 'Files', icon: Folder },
  { id: 'packs', label: 'Packs', icon: Package },
  { id: 'settings', label: 'Settings', icon: Settings },
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
  onSignOut,
  signedIn = false,
  devMode = false,
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
  onSignOut?: () => void
  signedIn?: boolean
  devMode?: boolean
  onView: (v: View) => void
  onNew: () => void
  onOpen: (id: string) => void
  onDelete: (id: string) => void
  onAgent: (id: string) => void
  sync?: SyncChip
}) {
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [name, setName] = useState(mascotName)
  useEffect(() => { setName(mascotName) }, [mascotName])
  const needle = query.trim().toLowerCase()
  const mine = conversations.filter((chat) => chat.agentId === agentId && (!needle || chat.title.toLowerCase().includes(needle) || (chat.preview ?? '').toLowerCase().includes(needle)))
  return (
    <aside className="shell-side flex h-full min-h-0 w-[280px] shrink-0 flex-col">
      <div className="flex items-center justify-between px-4 pt-4">
        <button type="button" className="icon-btn" aria-label="Search chats" data-tip="Search" aria-expanded={searchOpen} onClick={() => setSearchOpen((open) => !open)}>
          <Search size={18} />
        </button>
        <button type="button" className="icon-btn" data-new-chat="yes" aria-label="New chat" data-tip="New" onClick={onNew}>
          <Plus size={18} />
        </button>
      </div>
      {searchOpen && (
        <label className="mt-3 block px-4">
          <span className="sr-only">Search chats</span>
          <input className="field" data-chat-search="yes" aria-label="Search chats" placeholder="Search chats" value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
      )}
      <div className="mt-4 flex flex-col items-center px-4">
        <StarSurf state="idle" size={72} animate={animateMascot} clickable label={mascotName} />
        <input
          className="mascot-name"
          data-mascot-name="yes"
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
      </div>
      <div className="mt-4 flex min-h-0 flex-1 flex-col gap-1 overflow-auto px-3">
        {mine.length === 0 && <p className="px-2 py-2 text-sm text-[var(--muted)]">No chats yet.</p>}
        {mine.map((chat) => (
          <div key={chat.id} className={`chat-row ${chat.id === activeId ? 'is-on' : ''}`}>
            <button type="button" onClick={() => onOpen(chat.id)} className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left">
              <span className="chat-avatar" aria-hidden="true">{(chat.title || 'C').slice(0, 1).toUpperCase()}</span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{chat.title}</span>
                <span className="block truncate text-xs text-[var(--muted)]">{chat.preview || when(chat.updatedAt)}</span>
              </span>
            </button>
            <button type="button" className="icon-quiet shrink-0" aria-label={`Delete ${chat.title}`} data-tip="Delete" data-delete-chat={chat.id} onClick={() => onDelete(chat.id)}>
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>
      <div className="relative shrink-0 px-3 pb-4">
        {sync && (
          <p
            className="mb-2 px-1 text-[11px] leading-snug text-[var(--muted)]"
            data-sync-chip="yes"
            data-sync-state={sync.state}
            data-network-mode={sync.mode}
            data-sync-label={sync.label}
            title={sync.tooltip}
            data-tour="online"
            data-tour-target={tourId === 'online' ? 'yes' : 'no'}
          >
            <span>{sync.label}</span>
            {sync.showMode !== false && sync.modeLabel !== sync.label && <span data-network-mode-label="yes"> · {sync.modeLabel}</span>}
          </p>
        )}
        <button type="button" className="account-launch" data-account-menu="yes" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>
          <span className="chat-avatar">{(mascotName || 'S').slice(0, 1).toUpperCase()}</span>
          <span className="truncate text-sm font-semibold">{mascotName}</span>
        </button>
        {menuOpen && (
          <div className="account-menu" data-account-panel="yes">
            {MENU.map((item) => {
              const Icon = item.icon
              return (
              <button
                key={item.id}
                type="button"
                data-nav={item.id}
                data-tour-target={tourId === 'agents' && item.id === 'agents' ? 'yes' : 'no'}
                className={view === item.id ? 'is-on' : ''}
                onClick={() => { setMenuOpen(false); onView(item.id) }}
              >
                <Icon size={16} />
                {item.label}
              </button>
              )
            })}
            <div className="account-row">
              <span><Moon size={16} /> Dark mode</span>
              <button
                type="button"
                className="toggle"
                data-theme-choice={theme === 'dark' ? 'dark' : 'light'}
                aria-pressed={theme === 'dark'}
                aria-label={theme === 'dark' ? 'Dark' : 'Light'}
                data-on={theme === 'dark' ? 'yes' : 'no'}
                onClick={() => onTheme(theme === 'dark' ? 'light' : 'dark')}
              >
                <span />
              </button>
            </div>
            <p className="account-label">Switch agent</p>
            <div data-tour="agents">
              {agents.map((agent) => {
                const open = agentCanChat(agent)
                const on = agent.id === agentId
                return (
                  <button
                    key={agent.id}
                    type="button"
                    disabled={!open}
                    data-agent-card={agent.id}
                    className={on ? 'is-on' : ''}
                    onClick={() => { if (open) { setMenuOpen(false); onAgent(agent.id) } }}
                  >
                    <span className="truncate">{agent.name}</span>
                    {!open && <span className="pill pill-muted">Soon</span>}
                  </button>
                )
              })}
            </div>
            {!devMode && signedIn && onSignOut && (
              <button type="button" data-sign-out="yes" onClick={() => { setMenuOpen(false); onSignOut() }}><LogOut size={16} /> Log out</button>
            )}
            {!devMode && !signedIn && (
              <button type="button" data-sign-in="yes" onClick={() => { setMenuOpen(false); onSignIn() }}><LogOut size={16} /> Sign in</button>
            )}
          </div>
        )}
      </div>
    </aside>
  )
}

function when(ms: number): string {
  if (!ms) return ''
  try { return new Date(ms).toLocaleString() } catch { return '' }
}
