import { useCallback, useEffect, useRef, useState } from 'react'
import { persistThemeChoice, SurfCrew, type ThemeChoice } from '@surf/ui'
import type { ConversationSummary, ModelStatus, SettingsPatch } from '../../shared/ipc-contract'
import { applyEvent, type UiMsg, type View } from './types'
import { Sidebar } from './screens/Sidebar'
import { ChatScreen } from './screens/ChatScreen'
import { ModelsScreen } from './screens/ModelsScreen'
import { Onboarding } from './screens/Onboarding'
import { SettingsScreen } from './screens/SettingsScreen'

export default function App() {
  const api = window.surf
  const [status, setStatus] = useState<ModelStatus | null>(null)
  const [settings, setSettings] = useState<Required<SettingsPatch> | null>(null)
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [view, setView] = useState<View>('onboarding')
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [messages, setMessages] = useState<UiMsg[]>([])
  const [streaming, setStreaming] = useState(false)
  const [progress, setProgress] = useState<Record<string, number>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const [st, se, conv] = await Promise.all([api.models.status(), api.settings.get(), api.conversations.list()])
    setStatus(st)
    setSettings(se)
    setConversations(conv)
    return st
  }, [api])

  useEffect(() => {
    window.__surfNav = (next) => setView(next)
    void refresh().catch((e: unknown) => setError((e as Error).message))
    const offChat = api.chat.onEvent((e) => {
      setMessages((prev) => applyEvent(prev, e))
      if (e.type === 'token' || e.type === 'tool' || e.type === 'sources') setStreaming(true)
      if (e.type === 'done' || e.type === 'error') {
        setStreaming(false)
        void api.conversations.list().then(setConversations).catch(() => undefined)
      }
    })
    const offModels = api.models.onEvent((e) => {
      setProgress((p) => ({ ...p, [e.id]: e.total ? e.done / e.total : 0 }))
      if (e.state === 'error' && e.error) setError(e.error)
      if (e.state === 'done' || e.state === 'error') {
        setBusyId(null)
        void refresh()
      }
    })
    const timer = window.setInterval(() => { void refresh().catch(() => undefined) }, 8000)
    return () => { offChat(); offModels(); window.clearInterval(timer) }
  }, [api, refresh])

  const booted = useRef(false)
  useEffect(() => {
    if (!status || booted.current) return
    booted.current = true
    if (status.onboardingComplete) setView('chat')
  }, [status])

  useEffect(() => {
    if (settings) persistThemeChoice(settings.theme)
  }, [settings])

  function chooseTheme(theme: ThemeChoice) {
    persistThemeChoice(theme)
    void patch({ theme })
  }

  async function patch(p: SettingsPatch) {
    if (p.theme) persistThemeChoice(p.theme)
    await api.settings.set(p)
    await refresh()
  }

  async function download(id: string) {
    setError(null)
    setBusyId(id)
    setProgress((p) => ({ ...p, [id]: 0 }))
    try {
      await api.models.download(id)
    } catch (e) {
      setError((e as Error).message)
      setBusyId(null)
      throw e
    }
  }

  async function downloadChatAndEmbed(chatId: string) {
    const st = status ?? await refresh()
    const embed = st.models.find((m) => m.role === 'embedding')
    if (!st.models.find((m) => m.id === chatId)?.installed) await download(chatId)
    if (embed && !embed.installed) await download(embed.id)
    await refresh()
  }

  async function send(text: string) {
    const user: UiMsg = { id: `u-${Date.now()}`, role: 'user', text, sources: [], tools: [] }
    const pending: UiMsg = { id: `p-${Date.now()}`, role: 'assistant', text: '', sources: [], tools: [], pending: true }
    setMessages((m) => [...m, user, pending])
    setStreaming(true)
    setView('chat')
    try {
      const res = await api.chat.send({ conversationId, text, agentId: 'general', allowWeb: settings?.webSearchAllowed ?? false })
      setConversationId(res.conversationId)
      setMessages((m) => m.map((msg) => (msg.pending ? { ...msg, id: res.messageId } : msg)))
    } catch (e) {
      setStreaming(false)
      setMessages((m) => m.map((msg) => (msg.pending ? { ...msg, pending: false, error: true, text: (e as Error).message } : msg)))
    }
  }

  async function openConversation(id: string) {
    const opened = await api.conversations.open(id)
    setConversationId(id)
    setMessages(opened.messages.map((m) => ({ ...m, tools: [] })))
    setView('chat')
  }

  function newChat() {
    setConversationId(null)
    setMessages([])
    setView('chat')
  }

  if (!status || !settings) {
    return (
      <main className="flex h-full flex-col items-center justify-center gap-2" data-ready="no">
        <SurfCrew mood="thinking" size={180} />
        <p className="text-sm text-[var(--muted)]">{error ?? 'Starting Surf AI'}</p>
      </main>
    )
  }

  if (view === 'onboarding') {
    return (
      <div className="h-full" data-ready="yes" data-screen="onboarding">
        <Onboarding
          status={status}
          progress={busyId ? (progress[busyId] ?? 0) : 0}
          error={error}
          theme={settings.theme}
          onTheme={chooseTheme}
          onDownload={downloadChatAndEmbed}
          onReady={(chatId) => { void patch({ onboardingComplete: true, chatModelId: chatId }).then(() => setView('chat')) }}
        />
      </div>
    )
  }

  return (
    <div className="flex h-full" data-ready="yes" data-screen={view}>
      <Sidebar
        view={view}
        conversations={conversations}
        activeId={conversationId}
        onView={setView}
        theme={settings.theme}
        onTheme={chooseTheme}
        onNew={newChat}
        onOpen={(id) => { void openConversation(id) }}
      />
      {view === 'chat' && (
        <ChatScreen
          messages={messages}
          streaming={streaming}
          status={status}
          onSend={(t) => { void send(t) }}
          onToggleOffline={() => { void patch({ offlineOnly: !settings.offlineOnly }) }}
        />
      )}
      {view === 'models' && (
        <ModelsScreen status={status} progress={progress} busyId={busyId} error={error} onDownload={(id) => { void download(id).catch(() => undefined) }} />
      )}
      {view === 'settings' && (
        <SettingsScreen
          status={status}
          settings={settings}
          onPatch={(p) => { void patch(p) }}
          onCheckUpdates={async () => {
            const v = await api.updates.check()
            return v ? `Update ${v} is available.` : 'You are on 0.1.0. Signed updates land with the first GitHub release.'
          }}
        />
      )}
    </div>
  )
}
