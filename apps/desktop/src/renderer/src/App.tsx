import { useCallback, useEffect, useRef, useState } from 'react'
import { persistThemeChoice, SurfCrew, type ThemeChoice } from '@surf/ui'
import type { AgentCardView, ChunkPreview, ConversationSummary, DeviceInfo, DocScope, ExportFormat, FillPlan, LibraryFile, ModelStatus, PackRow, SettingsPatch } from '../../shared/ipc-contract'
import { applyEvent, type UiMsg, type View } from './types'
import { Sidebar } from './screens/Sidebar'
import { ChatScreen } from './screens/ChatScreen'
import { ModelsScreen } from './screens/ModelsScreen'
import { Onboarding } from './screens/Onboarding'
import { SettingsScreen } from './screens/SettingsScreen'
import { LibraryScreen } from './screens/LibraryScreen'
import { ConvertDialog, FillReview, type ConvertPanelState, type FillPanelState } from './screens/DocumentPanels'
import { SignInScreen } from './screens/SignInScreen'
import { PacksScreen } from './screens/PacksScreen'
import { HomeScreen } from './screens/HomeScreen'
import { CodeScreen } from './screens/CodeScreen'
import { AssistantScreen } from './screens/AssistantScreen'

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
  const [agentId, setAgentId] = useState('general')
  const [agentCards, setAgentCards] = useState<AgentCardView[]>([])
  const [codeTab, setCodeTab] = useState<'preview' | 'architecture'>('preview')
  const [codeKind, setCodeKind] = useState<'html' | 'react' | 'python'>('html')
  const [assistantMode, setAssistantMode] = useState<'connectors' | 'approval' | 'delete' | 'google' | 'outbox' | 'invoice'>('connectors')
  const [convertJob, setConvertJob] = useState<(ConvertPanelState & { path: string | null; attachmentId: string | null }) | null>(null)
  const [fillJob, setFillJob] = useState<(FillPanelState & { templatePath: string | null; templateAttachmentId: string | null; sourcePath: string | null }) | null>(null)

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
    void api.agents.list().then(setAgentCards).catch(() => undefined)
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
    const offDocs = api.documents.onEvent((event) => {
      const patch = { progress: event.progress, stage: event.stage, error: event.error ?? null }
      setConvertJob((job) => (job?.busy ? { ...job, ...patch, busy: !event.done } : job))
      setFillJob((job) => (job?.busy ? { ...job, ...patch, busy: !event.done } : job))
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
    return () => { offChat(); offModels(); offLib(); offDocs(); window.clearInterval(timer) }
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
      const res = await api.chat.send({ conversationId, text, agentId, allowWeb: Boolean(settings?.webSearchAllowed && chatWeb), docScope: scope })
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
    setAgentId(conversations.find((row) => row.id === id)?.agentId || 'general')
    setMessages(opened.messages.map((m) => ({ ...m, tools: [] })))
    setChatWeb(true)
    setView('chat')
  }

  function selectAgent(id: string) {
    setAgentId(id)
    setConversationId(null)
    setMessages([])
    setPreview(null)
    if (id === 'code') { setCodeTab('preview'); setView('code'); return }
    if (id === 'assistant') { setAssistantMode('connectors'); setView('assistant'); return }
    setView('chat')
  }

  function newChat() {
    setConversationId(null)
    setMessages([])
    setPreview(null)
    setChatWeb(true)
    setView('chat')
  }

  async function deleteConversation(id: string) {
    await api.conversations.remove(id)
    setConversations(await api.conversations.list())
    if (conversationId === id) {
      setConversationId(null)
      setMessages([])
      setPreview(null)
    }
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

  function blankConvert(name: string, path: string | null, attachmentId: string | null): NonNullable<typeof convertJob> {
    return { name, path, attachmentId, format: 'docx', progress: 0, stage: 'Ready', warnings: [], output: null, error: null, busy: false }
  }

  async function openConvert(file: LibraryFile) {
    if (!file.id) {
      const path = await api.documents.pick('Convert a document')
      if (!path) return
      setConvertJob(blankConvert(path.split(/[/\\]/).pop() ?? path, path, null))
      setView('library')
      return
    }
    setConvertJob(blankConvert(file.name, null, file.id))
    setView('library')
  }

  async function runConvert() {
    if (!convertJob || convertJob.attachmentId === 'demo') return
    setConvertJob({ ...convertJob, busy: true, error: null, output: null })
    try {
      const result = await api.documents.convert(
        convertJob.attachmentId ? { attachmentId: convertJob.attachmentId } : { path: convertJob.path ?? '' },
        convertJob.format,
      )
      setConvertJob((job) => job && { ...job, busy: false, output: result?.outputPath ?? null, warnings: result?.warnings ?? [] })
    } catch (e) {
      setConvertJob((job) => job && { ...job, busy: false, error: (e as Error).message })
    }
  }

  function blankFill(name: string, path: string | null, attachmentId: string | null): NonNullable<typeof fillJob> {
    return {
      templateName: name,
      templatePath: path,
      templateAttachmentId: attachmentId,
      sourceName: null,
      sourcePath: null,
      plan: null,
      highlight: false,
      format: 'same',
      progress: 0,
      stage: 'Ready',
      output: null,
      error: null,
      busy: false,
      accepted: {},
    }
  }

  async function openFill(file: LibraryFile) {
    if (!file.id) {
      const path = await api.documents.pick('Choose the form')
      if (!path) return
      setFillJob(blankFill(path.split(/[/\\]/).pop() ?? path, path, null))
    } else {
      setFillJob(blankFill(file.name, null, file.id))
    }
    setView('library')
  }

  async function chooseFillSource() {
    if (!fillJob || fillJob.templateAttachmentId === 'demo') return
    const path = await api.documents.pick('Choose the source document')
    if (!path) return
    setFillJob({ ...fillJob, busy: true, sourcePath: path, sourceName: path.split(/[/\\]/).pop() ?? path, error: null })
    try {
      const plan = await api.documents.plan({
        templatePath: fillJob.templatePath ?? undefined,
        templateAttachmentId: fillJob.templateAttachmentId ?? undefined,
        sourcePath: path,
      })
      setFillJob((job) => job && { ...job, busy: false, plan, templateName: plan.templateName, sourceName: plan.sourceName, templatePath: plan.templatePath, templateAttachmentId: plan.templateAttachmentId, sourcePath: plan.sourcePath })
    } catch (e) {
      setFillJob((job) => job && { ...job, busy: false, error: (e as Error).message })
    }
  }

  async function swapFill() {
    if (!fillJob?.plan || fillJob.templateAttachmentId === 'demo') return
    const plan = fillJob.plan
    setFillJob({ ...fillJob, busy: true })
    try {
      const next = await api.documents.plan({
        templatePath: plan.sourcePath ?? undefined,
        templateAttachmentId: plan.sourceAttachmentId ?? undefined,
        sourcePath: plan.templatePath ?? undefined,
        sourceAttachmentId: plan.templateAttachmentId ?? undefined,
      })
      setFillJob((job) => job && { ...job, busy: false, plan: next, templateName: next.templateName, sourceName: next.sourceName, templatePath: next.templatePath, templateAttachmentId: next.templateAttachmentId, sourcePath: next.sourcePath })
    } catch (e) {
      setFillJob((job) => job && { ...job, busy: false, error: (e as Error).message })
    }
  }

  function editFill(id: string, value: string) {
    setFillJob((job) => {
      if (!job?.plan) return job
      const rows = job.plan.rows.map((row) => {
        if (row.id !== id) return row
        const found = value.trim() !== '' && value !== 'not found in source'
        return { ...row, value, found, confidence: found ? 'high' as const : 'none' as const, citation: found ? (row.citation ?? 'edited') : null }
      })
      return { ...job, plan: { ...job.plan, rows } }
    })
  }

  async function exportFill() {
    if (!fillJob?.plan || fillJob.templateAttachmentId === 'demo') return
    setFillJob({ ...fillJob, busy: true, error: null, output: null })
    try {
      const result = await api.documents.export({
        templatePath: fillJob.plan.templatePath ?? undefined,
        templateAttachmentId: fillJob.plan.templateAttachmentId ?? undefined,
        rows: fillJob.plan.rows,
        format: fillJob.format,
        highlight: fillJob.highlight,
      })
      setFillJob((job) => job && { ...job, busy: false, output: result?.outputPath ?? null, plan: job.plan && result ? { ...job.plan, warnings: [...job.plan.warnings, ...result.warnings] } : job.plan })
    } catch (e) {
      setFillJob((job) => job && { ...job, busy: false, error: (e as Error).message })
    }
  }

  useEffect(() => {
    window.__surfDemo = (scene) => {
      setConvertJob(null)
      setFillJob(null)
      if (scene === 'agents') {
        setView('home')
        setAgentId('general')
      }
      if (scene === 'code') {
        setView('code')
        setAgentId('code')
        setCodeTab('preview')
        setCodeKind('html')
      }
      if (scene === 'react') {
        setView('code')
        setAgentId('code')
        setCodeTab('preview')
        setCodeKind('react')
      }
      if (scene === 'python') {
        setView('code')
        setAgentId('code')
        setCodeTab('preview')
        setCodeKind('python')
      }
      if (scene === 'architecture') {
        setView('code')
        setAgentId('code')
        setCodeTab('architecture')
      }
      if (scene === 'connectors') {
        setView('assistant')
        setAgentId('assistant')
        setAssistantMode('connectors')
      }
      if (scene === 'approval') {
        setView('assistant')
        setAgentId('assistant')
        setAssistantMode('approval')
      }
      if (scene === 'delete') {
        setView('assistant')
        setAgentId('assistant')
        setAssistantMode('delete')
      }
      if (scene === 'google') {
        setView('assistant')
        setAgentId('assistant')
        setAssistantMode('google')
      }
      if (scene === 'outbox') {
        setView('assistant')
        setAgentId('assistant')
        setAssistantMode('outbox')
      }
      if (scene === 'invoice') {
        setView('assistant')
        setAgentId('assistant')
        setAssistantMode('invoice')
      }
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
      if (scene === 'savedweb') {
        setView('chat')
        setPreview(null)
        setFiles([])
        setMessages([
          { id: 'u-saved', role: 'user', text: 'What is the price of the pier 9 beacon today?', sources: [], tools: [] },
          {
            id: 'a-saved', role: 'assistant', tools: [],
            text: 'The Surf beacon code for pier 9 is SB-4417. [S1]',
            sources: [{
              kind: 'web',
              title: 'Pier 9 beacon',
              url: 'https://example.com/beacon',
              domain: 'example.com',
              published: '8 Oct 2026',
              pack: 'Web, saved 8 Oct 2026',
              savedAt: Date.UTC(2026, 9, 8, 12, 0),
              staleNote: 'Saved more than 24 hours ago. Prices and news may have changed.',
              excerpt: 'The Surf beacon code for pier 9 today is SB-4417.',
            }],
          },
        ])
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
      if (scene === 'convert') {
        setView('library')
        setPreview(null)
        setFiles([{ id: 'demo-ready', name: 'harbor-ferry.pdf', mime: 'application/pdf', sizeBytes: 12000, addedAt: 1, conversationIds: [], status: 'done', stage: 'Ready', progress: 1, error: null, jobId: null, chunkCount: 1 }])
        setConvertJob({
          name: 'harbor-ferry.pdf',
          path: null,
          attachmentId: 'demo',
          format: 'docx',
          progress: 0.62,
          stage: 'Reading page 2',
          warnings: ['Headings and simple lines are kept. Columns, images, and the original page layout are not.'],
          output: null,
          error: null,
          busy: true,
        })
      }
      if (scene === 'fill') {
        const plan: FillPlan = {
          templatePath: null,
          templateAttachmentId: 'demo',
          sourcePath: null,
          sourceAttachmentId: null,
          templateName: 'berth-form.docx',
          sourceName: 'harbor-notes.docx',
          role: 'template-first',
          warnings: ['Only the blank is replaced. The surrounding font, size, color, and emphasis stay.'],
          rows: [
            { id: 'vessel', label: 'Vessel', value: 'Sea Lark', citation: 'line 1', confidence: 'high', found: true, locator: 'line 1' },
            { id: 'port', label: 'Port', value: 'Bergen', citation: 'line 2', confidence: 'high', found: true, locator: 'line 2' },
            { id: 'call', label: 'Call sign', value: 'not found in source', citation: null, confidence: 'none', found: false, locator: 'line 3' },
          ],
        }
        setView('library')
        setPreview(null)
        setFiles([{ id: 'demo-form', name: 'berth-form.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', sizeBytes: 8000, addedAt: 1, conversationIds: [], status: 'done', stage: 'Ready', progress: 1, error: null, jobId: null, chunkCount: 1 }])
        setFillJob({
          templateName: 'berth-form.docx',
          templatePath: null,
          templateAttachmentId: 'demo',
          sourceName: 'harbor-notes.docx',
          sourcePath: null,
          plan,
          highlight: true,
          format: 'same',
          progress: 1,
          stage: 'Ready to save',
          output: null,
          error: null,
          busy: false,
          accepted: { vessel: true },
        })
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
        agents={agentCards}
        agentId={agentId}
        onAgent={selectAgent}
        onOpen={(id) => { void openConversation(id) }}
        onDelete={(id) => { void deleteConversation(id) }}
      />
      {view === 'home' && <HomeScreen cards={agentCards} onOpen={selectAgent} />}
      {view === 'code' && <CodeScreen key={codeKind} tab={codeTab} kind={codeKind} onTab={setCodeTab} onAsk={(text) => { setAgentId('code'); void send(text) }} />}
      {view === 'assistant' && <AssistantScreen mode={assistantMode} />}
      {view === 'chat' && (
        <ChatScreen
          agentName={agentCards.find((card) => card.id === agentId)?.name ?? 'General'}
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
          onConvert={(file) => { void openConvert(file).catch((e: unknown) => setError((e as Error).message)) }}
          onFill={(file) => { void openFill(file).catch((e: unknown) => setError((e as Error).message)) }}
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
      {convertJob && (
        <ConvertDialog
          state={convertJob}
          onFormat={(format: ExportFormat) => setConvertJob({ ...convertJob, format })}
          onRun={() => { void runConvert() }}
          onCancel={() => { void api.documents.cancel(); setConvertJob({ ...convertJob, busy: false, stage: 'Cancelled' }) }}
          onClose={() => setConvertJob(null)}
        />
      )}
      {fillJob && (
        <FillReview
          state={fillJob}
          onPickSource={() => { void chooseFillSource() }}
          onSwap={() => { void swapFill() }}
          onEdit={editFill}
          onAccept={(id) => setFillJob({ ...fillJob, accepted: { ...fillJob.accepted, [id]: !fillJob.accepted[id] } })}
          onHighlight={(highlight) => setFillJob({ ...fillJob, highlight })}
          onFormat={(format) => setFillJob({ ...fillJob, format })}
          onExport={() => { void exportFill() }}
          onCancel={() => { void api.documents.cancel(); setFillJob({ ...fillJob, busy: false, stage: 'Cancelled' }) }}
          onClose={() => setFillJob(null)}
        />
      )}
    </div>
  )
}
