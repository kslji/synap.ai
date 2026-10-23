import { useEffect, useRef, useState } from 'react'
import { BarChart3, Bot, Folder, Home, LogOut, Moon, Package, Plus, Search, Settings, Trash2 } from 'lucide-react'
import { BlobMascot, type ThemeChoice } from '@surf/ui'
import { useMascotActivity } from '../mascot-activity'
import { agentCanChat, agents } from '@surf/shared'
import { BOT_NAME_LIMIT, cleanMascotName } from '../../../main/core/appearance'
import { labelFromAgentId } from '../../../shared/chat-title'
import { clipWords, SIDEBAR_PREVIEW_LIMIT, SIDEBAR_TITLE_LIMIT } from '../../../shared/reply-text'
import { SURF_CHIP_IDLE, surfChipStep, surfChipText, surfChipTone, type SurfChipHold } from '../../../shared/surf-chip'
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
  onSync,
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
  onSync: () => void
  sync?: SyncChip
}) {
  const activity = useMascotActivity()
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [name, setName] = useState(mascotName)
  const opened = surfChipStep(SURF_CHIP_IDLE, sync?.state ?? 'uptodate', Date.now())
  const [hold, setHold] = useState<SurfChipHold>(opened)
  const holdRef = useRef(opened)
  const stateRef = useRef(sync?.state ?? 'uptodate')
  stateRef.current = sync?.state ?? 'uptodate'
  useEffect(() => {
    const now = Date.now()
    const next = surfChipStep(holdRef.current, stateRef.current, now)
    holdRef.current = next
    setHold(next)
    if (next.phase !== 'synced') return
    const wait = Math.max(0, next.holdUntil - now)
    const timer = window.setTimeout(() => {
      const settled = surfChipStep(holdRef.current, stateRef.current, Date.now())
      holdRef.current = settled
      setHold(settled)
    }, wait)
    return () => window.clearTimeout(timer)
  }, [sync?.state])
  const phase = hold.phase
  const text = surfChipText(phase, mascotName)
  const tone = surfChipTone(phase, theme === 'dark' ? 'dark' : 'light')
  useEffect(() => { setName(mascotName) }, [mascotName])
  const needle = query.trim().toLowerCase()
  const nameOf = (id: string) => agents.find((agent) => agent.id === id)?.name ?? labelFromAgentId(id)
  const mine = conversations.filter((chat) => {
    if (!needle) return true
    const label = nameOf(chat.agentId).toLowerCase()
    return chat.title.toLowerCase().includes(needle) || (chat.preview ?? '').toLowerCase().includes(needle) || label.includes(needle)
  })
  const chatAgents = agents.filter((agent) => agentCanChat(agent))
  const soonAgents = agents.filter((agent) => !agentCanChat(agent))
  const openName = nameOf(agentId)
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
        <BlobMascot state={activity.state} size={72} animate={animateMascot} clickable label={mascotName} caret={activity.caret} />
        <input
          className="mascot-name"
          data-mascot-name="yes"
          data-mascot-rename="yes"
          aria-label="Bot name"
          value={name}
          maxLength={BOT_NAME_LIMIT}
          onChange={(event) => setName(event.target.value)}
          onBlur={(event) => {
            const next = cleanMascotName(event.currentTarget.value)
            setName(next)
            if (next !== mascotName) onMascotName(next)
          }}
        />
      </div>
      <div className="mt-4 flex min-h-0 flex-1 flex-col gap-1 overflow-auto px-3">
        {mine.length === 0 && <p className="px-2 py-2 text-sm text-[var(--muted)]">No chats yet.</p>}
        {mine.map((chat) => {
          const label = nameOf(chat.agentId)
          return (
            <div key={chat.id} className={`chat-row ${chat.id === activeId ? 'is-on' : ''}`} data-chat-row={chat.id} data-chat-agent={chat.agentId}>
              <button type="button" onClick={() => onOpen(chat.id)} className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left">
                <span className="chat-avatar" aria-hidden="true">{label.slice(0, 1).toUpperCase()}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="min-w-0 text-sm font-semibold leading-snug" data-chat-title="yes">{clipWords(chat.title, SIDEBAR_TITLE_LIMIT)}</span>
                    <span className="agent-tag shrink-0" data-agent-tag="yes">{label}</span>
                  </span>
                  <span className="mt-0.5 block text-xs leading-snug text-[var(--muted)]">{chat.preview ? clipWords(chat.preview, SIDEBAR_PREVIEW_LIMIT) : when(chat.updatedAt)}</span>
                </span>
              </button>
              <button type="button" className="icon-quiet shrink-0" aria-label={`Delete ${chat.title}`} data-tip="Delete" data-delete-chat={chat.id} onClick={() => onDelete(chat.id)}>
                <Trash2 size={15} />
              </button>
            </div>
          )
        })}
      </div>
      <div className="relative shrink-0 px-3 pb-4">
        <div
          className={`account-launch surf-chip is-${phase}`}
          style={tone ?? undefined}
          data-sync-chip="yes"
          data-sync-state={phase}
          data-network-mode={sync?.mode ?? 'auto'}
          data-sync-label={text}
          title={sync?.tooltip}
          data-tour="online"
          data-tour-target={tourId === 'online' ? 'yes' : 'no'}
        >
          <button
            type="button"
            className="chat-avatar"
            data-account-menu="yes"
            aria-label="Account menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {(mascotName || 'S').slice(0, 1).toUpperCase()}
          </button>
          <button
            type="button"
            className="surf-chip-sync"
            data-sync-start="yes"
            aria-live="polite"
            disabled={phase === 'syncing'}
            onClick={onSync}
          >
            {text}
          </button>
        </div>
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
            <div className="account-row" data-theme-row="yes">
              <span className="theme-label"><Moon size={16} /> Dark mode</span>
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
            <div data-tour="agents">
              <p className="account-label">Agent</p>
              {chatAgents.length <= 1 ? (
                <p className="account-agent" data-agent-label="yes">Agent: {openName}</p>
              ) : (
                chatAgents.map((agent) => (
                  <button
                    key={agent.id}
                    type="button"
                    data-agent-card={agent.id}
                    className={agent.id === agentId ? 'is-on' : ''}
                    onClick={() => { setMenuOpen(false); onAgent(agent.id) }}
                  >
                    <span className="truncate">{agent.name}</span>
                  </button>
                ))
              )}
              {soonAgents.map((agent) => (
                <button key={agent.id} type="button" disabled data-agent-card={agent.id}>
                  <span className="truncate">{agent.name}</span>
                  <span className="pill pill-muted">Soon</span>
                </button>
              ))}
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
