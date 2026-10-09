import { useCallback, useEffect, useRef, useState } from 'react'
import { persistThemeChoice, SurfCrew, type ThemeChoice } from '@surf/ui'
import type { ChunkPreview, ConversationSummary, DeviceInfo, DocScope, LibraryFile, ModelStatus, PackRow, SettingsPatch } from '../../shared/ipc-contract'
import { applyEvent, type UiMsg, type View } from './types'
import { Sidebar } from './screens/Sidebar'
import { ChatScreen } from './screens/ChatScreen'
import { ModelsScreen } from './screens/ModelsScreen'
import { Onboarding } from './screens/Onboarding'
import { SettingsScreen } from './screens/SettingsScreen'
import { LibraryScreen } from './screens/LibraryScreen'
import { SignInScreen } from './screens/SignInScreen'
import { PacksScreen } from './screens/PacksScreen'

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
  const [files, setFiles] = useState<LibraryFile[]>([])
  const [scope, setScope] = useState<DocScope>('chat')
  const [chatWeb, setChatWeb] = useState(true)
  const [preview, setPreview] = useState<ChunkPreview | null>(null)
  const [account, setAccount] = useState<{ email: string; deviceId: string | null } | null>(null)
  const [devices, setDevices] = useState<DeviceInfo[]>([])
  const [packs, setPacks] = useState<PackRow[]>([])
  const [packBusy, setPackBusy] = useState(false)
  const [demoAccount, setDemoAccount] = useState<{ email: string; deviceId: string | null } | null>(null)
  const [demoDevices, setDemoDevices] = useState<DeviceInfo[] | null>(null)
  const [demoPacks, setDemoPacks] = useState<PackRow[] | null>(null)

  const refresh = useCallback(async () => {
    const [st, se, conv, auth, listed] = await Promise.all([
      api.models.status(),
      api.settings.get(),
      api.conversations.list(),
      api.auth.status(),
      api.packs.list(),
    ])
    setStatus(st)
    setSettings(se)
    setConversations(conv)
    setAccount(auth.signedIn && auth.email ? { email: auth.email, deviceId: auth.deviceId } : null)
    setPacks(listed)
    if (auth.signedIn) setDevices(await api.auth.devices().catch(() => []))
    else setDevices([])
    return st
  }, [api])

  useEffect(() => {
    window.__surfNav = (next) => setView(next)
    void refresh().catch((e: unknown) => setError((e as Error).message))
    const offChat = api.chat.onEvent((e) => {
      setMessages((prev) => applyEvent(prev, e))
      if (e.type === 'token' || e.type === 'tool' || e.type === 'sources' || e.type === 'status') setStreaming(true)
      if (e.type === 'done' || e.type === 'error') {
        setStreaming(false)
        void api.conversations.list().then(setConversations).catch(() => undefined)
      }
    })
    const offLib = api.library.onEvent((e) => {
      setFiles((prev) => [e.file, ...prev.filter((file) => file.id !== e.file.id)])
    })
    void api.library.list().then(setFiles).catch(() => undefined)
    const offModels = api.models.onEvent((e) => {
      setProgress((p) => ({ ...p, [e.id]: e.total ? e.done / e.total : 0 }))
      if (e.state === 'error' && e.error) setError(e.error)
      if (e.state === 'done' || e.state === 'error') {
        setBusyId(null)
        void refresh()
      }
    })
    const timer = window.setInterval(() => { void refresh().catch(() => undefined) }, 8000)
    return () => { offChat(); offModels(); offLib(); window.clearInterval(timer) }
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
      const res = await api.chat.send({ conversationId, text, agentId: 'general', allowWeb: Boolean(settings?.webSearchAllowed && chatWeb), docScope: scope })
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
    setChatWeb(true)
    setView('chat')
  }

  function newChat() {
    setConversationId(null)
    setMessages([])
    setPreview(null)
    setChatWeb(true)
    setView('chat')
  }

  async function attach(paths: string[], createConversation: boolean) {
    const res = await api.library.add(paths, createConversation ? conversationId : null, createConversation)
    if (res.conversationId) setConversationId(res.conversationId)
    setFiles(await api.library.list())
    if (createConversation) setView('chat')
  }

  async function openCitation(chunkId: number) {
    setPreview(await api.library.preview({ chunkId }))
  }

  useEffect(() => {
    window.__surfDemo = (scene) => {
      if (scene === 'upload') {
        setView('chat')
        setMessages([])
        setPreview(null)
        setConversationId('demo')
        setFiles([{ id: 'demo-upload', name: 'harbor-ferry.pdf', mime: 'application/pdf', sizeBytes: 12000, addedAt: 1, conversationIds: ['demo'], status: 'queued', stage: 'Waiting', progress: 0, error: null, jobId: 'job-upload', chunkCount: 0 }])
      }
      if (scene === 'processing') {
        setView('chat')
        setMessages([])
        setPreview(null)
        setConversationId('demo')
        setFiles([{ id: 'demo-run', name: 'harbor-ferry.pdf', mime: 'application/pdf', sizeBytes: 12000, addedAt: 1, conversationIds: ['demo'], status: 'running', stage: 'Page 1 of 2', progress: 0.45, error: null, jobId: 'job-run', chunkCount: 0 }])
      }
      if (scene === 'citation') {
        setView('chat')
        setFiles([])
        setMessages([
          { id: 'u1', role: 'user', text: 'What time does the harbor ferry leave?', sources: [], tools: [] },
          {
            id: 'a1', role: 'assistant', tools: [],
            text: 'The harbor ferry leaves Pier 4 at 06:40. [S1]',
            sources: [{ title: 'harbor-ferry.pdf · page 1', url: '', pack: 'library', chunkId: 1, fileName: 'harbor-ferry.pdf', locator: 'page 1', excerpt: 'The harbor ferry leaves Pier 4 at 06:40.' }],
          },
        ])
        setPreview({ chunkId: 1, fileName: 'harbor-ferry.pdf', title: 'harbor-ferry.pdf', heading: null, locator: 'page 1', text: 'The harbor ferry leaves Pier 4 at 06:40. Tickets cost 120 rupees.' })
      }
      if (scene === 'searching') {
        setView('chat')
        setPreview(null)
        setFiles([])
        setMessages([
          { id: 'u-search', role: 'user', text: 'What is the Surf beacon code for pier 9 today?', sources: [], tools: [] },
          { id: 'a-search', role: 'assistant', text: '', sources: [], tools: [], pending: true, phase: 'searching' },
        ])
      }
      if (scene === 'web') {
        setView('chat')
        setPreview(null)
        setFiles([])
        setMessages([
          { id: 'u-web', role: 'user', text: 'What is the Surf beacon code for pier 9 today?', sources: [], tools: [] },
          {
            id: 'a-web', role: 'assistant', tools: [],
            text: 'The Surf beacon code for pier 9 today is SB-4417. [S1]',
            sources: [{ kind: 'web', title: 'Pier 9 beacon', url: 'https://example.com/beacon', domain: 'example.com', published: '9 Oct 2026', pack: 'web', excerpt: 'Pier 9 beacon · example.com · 9 Oct 2026' }],
          },
        ])
      }
      if (scene === 'refusal') {
        setView('chat')
        setPreview(null)
        setFiles([])
        setMessages([
          { id: 'u-no', role: 'user', text: 'What is the Surf beacon code for pier 9 today?', sources: [], tools: [] },
          {
            id: 'a-no', role: 'assistant', tools: [],
            text: "I don't have enough information to answer that from the sources on this computer. Add a document. Turn on web search when you are online.",
            sources: [],
          },
        ])
      }
      if (scene === 'signin') {
        setDemoAccount(null)
        setView('signin')
      }
      if (scene === 'account') {
        setDemoAccount({ email: 'ada@example.com', deviceId: '11111111-1111-4111-8111-111111111111' })
        setDemoDevices([
          { id: '11111111-1111-4111-8111-111111111111', name: 'This computer', os: 'linux', status: 'active', current: true },
          { id: '22222222-2222-4222-8222-222222222222', name: 'Studio laptop', os: 'macos', status: 'active', current: false },
        ])
        setView('settings')
      }
      if (scene === 'packs') {
        setDemoPacks([{
          id: 'general-starter',
          title: 'General starter',
          niche: 'general',
          version: '2026.10.01',
          latestVersion: '2026.10.09',
          installed: true,
          updateAvailable: true,
          syncedAt: Date.UTC(2026, 9, 8, 9, 0),
          progress: null,
          error: null,
        }])
        setView('packs')
      }
      if (scene === 'packcite') {
        setView('chat')
        setPreview(null)
        setFiles([])
        setMessages([
          { id: 'u-pack', role: 'user', text: 'What is the harbor lantern code?', sources: [], tools: [] },
          {
            id: 'a-pack', role: 'assistant', tools: [],
            text: 'The harbor lantern code is GL-2201. [S1]',
            sources: [{
              kind: 'document',
              title: 'Harbor lantern',
              url: 'pack://general-starter/harbor-lantern.txt',
              pack: 'General starter · 2026.10.09',
              version: '2026.10.09',
              excerpt: 'The general starter pack says the harbor lantern code is GL-2201.',
            }],
          },
        ])
      }
      if (scene === 'library') {
        setView('library')
        setPreview(null)
        setFiles([
          { id: 'demo-ready', name: 'northwind-invoice.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', sizeBytes: 8000, addedAt: 2, conversationIds: [], status: 'done', stage: 'Ready', progress: 1, error: null, jobId: 'job-done', chunkCount: 1 },
          { id: 'demo-run', name: 'shelf.png', mime: 'image/png', sizeBytes: 4000, addedAt: 1, conversationIds: [], status: 'running', stage: 'Reading the image', progress: 0.62, error: null, jobId: 'job-img', chunkCount: 0 },
        ])
      }
    }
  }, [])

  if (!status || !settings) {
    return (
      <main className="flex h-full flex-col items-center justify-center gap-2" data-ready="no">
        <SurfCrew mood="thinking" size={180} />
        <p className="text-sm text-[var(--muted)]">{error ?? 'Starting Surf AI'}</p>
      </main>
    )
  }

  const shownAccount = demoAccount ?? account
  const shownDevices = demoDevices ?? devices
  const shownPacks = demoPacks ?? packs

  if (view === 'signin') {
    return (
      <div className="h-full" data-ready="yes" data-screen="signin">
        <SignInScreen
          theme={settings.theme}
          onTheme={chooseTheme}
          onClose={() => setView('chat')}
          onStart={(email) => api.auth.start(email)}
          onVerify={async (email, code) => {
            await api.auth.verify(email, code)
            setDemoAccount(null)
            setDemoDevices(null)
            await refresh()
            setView('settings')
          }}
        />
      </div>
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
        signedIn={Boolean(shownAccount)}
        onNew={newChat}
        onOpen={(id) => { void openConversation(id) }}
      />
      {view === 'chat' && (
        <ChatScreen
          messages={messages}
          streaming={streaming}
          status={status}
          files={conversationId ? files.filter((file) => file.conversationIds.includes(conversationId)) : []}
          scope={scope}
          preview={preview}
          webSearchAllowed={settings.webSearchAllowed}
          chatWeb={chatWeb}
          onSend={(t) => { void send(t) }}
          onToggleOffline={() => { void patch({ offlineOnly: !settings.offlineOnly }) }}
          onToggleChatWeb={() => { if (settings.webSearchAllowed) setChatWeb((on) => !on) }}
          onAttach={(paths) => { void attach(paths, true).catch((e: unknown) => setError((e as Error).message)) }}
          onPick={() => { void api.library.pick(conversationId, true).then((res) => { if (res.conversationId) setConversationId(res.conversationId); return api.library.list() }).then(setFiles).catch((e: unknown) => setError((e as Error).message)) }}
          onScope={setScope}
          onOpenCitation={(id) => { void openCitation(id) }}
          onClosePreview={() => setPreview(null)}
        />
      )}
      {view === 'library' && (
        <LibraryScreen
          files={files}
          preview={preview}
          onAdd={() => { void api.library.pick(null, false).then(() => api.library.list()).then(setFiles).catch((e: unknown) => setError((e as Error).message)) }}
          onRetry={(jobId) => { void api.library.retry(jobId).then(() => api.library.list()).then(setFiles).catch((e: unknown) => setError((e as Error).message)) }}
          onCancel={(jobId) => { void api.library.cancel(jobId).catch((e: unknown) => setError((e as Error).message)) }}
          onRemove={(id) => { void api.library.remove(id).then(() => api.library.list()).then((rows) => { setFiles(rows); setPreview(null) }).catch((e: unknown) => setError((e as Error).message)) }}
          onPreview={(id) => { void api.library.preview({ attachmentId: id }).then(setPreview) }}
          onClosePreview={() => setPreview(null)}
        />
      )}
      {view === 'packs' && (
        <PacksScreen
          packs={shownPacks}
          busy={packBusy}
          error={error}
          onSync={() => {
            setPackBusy(true)
            setError(null)
            void api.packs.sync().then((rows) => { setDemoPacks(null); setPacks(rows) }).catch((e: unknown) => setError((e as Error).message)).finally(() => setPackBusy(false))
          }}
          onRemove={(id) => {
            void api.packs.remove(id).then(() => api.packs.list()).then((rows) => { setDemoPacks(null); setPacks(rows) }).catch((e: unknown) => setError((e as Error).message))
          }}
        />
      )}
      {view === 'models' && (
        <ModelsScreen status={status} progress={progress} busyId={busyId} error={error} onDownload={(id) => { void download(id).catch(() => undefined) }} />
      )}
      {view === 'settings' && (
        <SettingsScreen
          status={status}
          settings={settings}
          account={shownAccount}
          devices={shownDevices}
          onSignIn={() => setView('signin')}
          onSignOut={() => {
            setDemoAccount(null)
            setDemoDevices(null)
            void api.auth.signOut().then(() => refresh()).catch((e: unknown) => setError((e as Error).message))
          }}
          onRevoke={(id) => {
            if (demoDevices) {
              setDemoDevices(demoDevices.filter((device) => device.id !== id))
              return
            }
            void api.auth.revoke(id).then(() => refresh()).catch((e: unknown) => setError((e as Error).message))
          }}
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
