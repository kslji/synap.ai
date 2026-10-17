import { useCallback, useEffect, useRef, useState } from 'react'
import { persistThemeChoice, StarSurf, type ThemeChoice } from '@surf/ui'
import type { ChatEvent, ChunkPreview, CodeAgentModeState, CodeProjectStatus, ConversationSummary, DeviceInfo, DocScope, ExportFormat, FillPlan, LibraryFile, LicenceDevice, LicenceStatus, ModelStatus, PackRow, SettingsPatch, StoredMessage, UpdateOffer } from '../../shared/ipc-contract'
import { applyEvent, type UiMsg, type View } from './types'
import { agents } from '../../../../../packages/shared/src/agent-catalog'
import { agentCanChat } from '../../../../../packages/shared/src/agents'
import { Sidebar } from './screens/Sidebar'
import { ChatScreen } from './screens/ChatScreen'
import { readShotFile, type CodeShot } from './screens/CodeShots'
import { AgentsScreen, ChatsScreen, HomeScreen } from './screens/HomeScreen'
import { activeChatModel, activeCodeModel, ModelsScreen } from './screens/ModelsScreen'
import { TOUR } from './tour'
import { Onboarding } from './screens/Onboarding'
import { SettingsScreen } from './screens/SettingsScreen'
import { UsagePanel } from './screens/UsageStorage'
import { createFrameBatcher } from '../../shared/stream-batch'
import { LibraryScreen } from './screens/LibraryScreen'
import { ConvertDialog, FillReview, type ConvertPanelState, type FillPanelState } from './screens/DocumentPanels'
import { SignInScreen } from './screens/SignInScreen'
import { ActivationScreen } from './screens/ActivationScreen'
import { PacksScreen } from './screens/PacksScreen'
import { UpdateBanner } from './screens/UpdateBanner'

function fromStored(message: StoredMessage): UiMsg {
  const all = message.versions ?? []
  if (message.role !== 'assistant' || all.length < 2) return { ...message, tools: [] }
  return { ...message, text: all[all.length - 1] || message.text, versions: all.slice(0, -1), tools: [] }
}

export default function App() {
  const api = window.surf
  const [status, setStatus] = useState<ModelStatus | null>(null)
  const [settings, setSettings] = useState<Required<SettingsPatch> | null>(null)
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [view, setView] = useState<View>('onboarding')
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [agentId, setAgentId] = useState('general')
  const [codeProject, setCodeProject] = useState<CodeProjectStatus | null>(null)
  const [codeMode, setCodeMode] = useState<CodeAgentModeState | null>(null)
  const [tourStep, setTourStep] = useState<number | null>(null)
  const [messages, setMessages] = useState<UiMsg[]>([])
  const [shots, setShots] = useState<CodeShot[]>([])
  const [streaming, setStreaming] = useState(false)
  const [progress, setProgress] = useState<Record<string, number>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [updateOffer, setUpdateOffer] = useState<UpdateOffer | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [files, setFiles] = useState<LibraryFile[]>([])
  const [scope, setScope] = useState<DocScope>('chat')
  const [chatWeb, setChatWeb] = useState(true)
  const [preview, setPreview] = useState<ChunkPreview | null>(null)
  const [account, setAccount] = useState<{ email: string; deviceId: string | null; plan?: string | null } | null>(null)
  const [licence, setLicence] = useState<LicenceStatus | null>(null)
  const [licenceDevices, setLicenceDevices] = useState<LicenceDevice[]>([])
  const [packs, setPacks] = useState<PackRow[]>([])
  const [packBusy, setPackBusy] = useState(false)
  const [demoAccount, setDemoAccount] = useState<{ email: string; deviceId: string | null; plan?: string | null } | null>(null)
  const [demoDevices, setDemoDevices] = useState<DeviceInfo[] | null>(null)
  const [demoPacks, setDemoPacks] = useState<PackRow[] | null>(null)
  const [convertJob, setConvertJob] = useState<(ConvertPanelState & { path: string | null; attachmentId: string | null }) | null>(null)
  const [fillJob, setFillJob] = useState<(FillPanelState & { templatePath: string | null; templateAttachmentId: string | null; sourcePath: string | null }) | null>(null)

  const refresh = useCallback(async () => {
    const [st, se, conv, auth, listed, lic] = await Promise.all([
      api.models.status(),
      api.settings.get(),
      api.conversations.list(),
      api.auth.status(),
      api.packs.list(),
      api.licence.status(),
    ])
    setStatus(st)
    setSettings(se)
    setConversations(conv)
    setAccount(auth.signedIn && auth.email ? { email: auth.email, deviceId: auth.deviceId, plan: lic.plan } : null)
    setLicence(lic)
    setPacks(listed)
    const open = lic.state === 'valid' || lic.state === 'grace' || lic.state === 'dev'
    if (open) setLicenceDevices(await api.licence.devices().catch(() => []))
    else setLicenceDevices([])
    return st
  }, [api])

  useEffect(() => {
    window.__surfNav = (next) => setView(next)
    void refresh().catch((e: unknown) => setError((e as Error).message))
    const frames = createFrameBatcher<ChatEvent>(
      (events) => {
        setMessages((prev) => events.reduce(applyEvent, prev))
        for (const e of events) {
          if (e.type === 'token' || e.type === 'tool' || e.type === 'sources' || e.type === 'status' || e.type === 'code-step' || e.type === 'code-diff') setStreaming(true)
          if (e.type === 'done' || e.type === 'error') {
            setStreaming(false)
            void api.conversations.list().then(setConversations).catch(() => undefined)
          }
        }
      },
      (fn) => window.requestAnimationFrame(fn),
      (id) => window.cancelAnimationFrame(id),
      (event) => event.type === 'done' || event.type === 'error',
    )
    const offChat = api.chat.onEvent((e) => frames.push(e))
    const offLib = api.library.onEvent((e) => {
      setFiles((prev) => [e.file, ...prev.filter((file) => file.id !== e.file.id)])
    })
    const offCode = api.code.onEvent(setCodeProject)
    const offDocs = api.documents.onEvent((event) => {
      const patch = { progress: event.progress, stage: event.stage, error: event.error ?? null }
      setConvertJob((job) => (job?.busy ? { ...job, ...patch, busy: !event.done } : job))
      setFillJob((job) => (job?.busy ? { ...job, ...patch, busy: !event.done } : job))
    })
    void api.library.list().then(setFiles).catch(() => undefined)
    const offModels = api.models.onEvent((e) => {
      setProgress((p) => ({ ...p, [e.id]: e.total ? e.done / e.total : 0 }))
      if (e.state === 'error' && e.error) setError(e.error)
      if (e.state === 'cancelled') setError(null)
      if (e.state === 'done' || e.state === 'error' || e.state === 'cancelled') {
        setBusyId(null)
        void refresh()
      }
    })
    const timer = window.setInterval(() => { void refresh().catch(() => undefined) }, 8000)
    return () => { frames.cancel(); offChat(); offModels(); offLib(); offDocs(); offCode(); window.clearInterval(timer) }
  }, [api, refresh])

  const booted = useRef(false)
  useEffect(() => {
    if (!status || !licence || booted.current) return
    booted.current = true
    if (licence.state === 'dev') setView('chat')
    else if (status.onboardingComplete) setView('home')
  }, [status, licence])

  useEffect(() => {
    if (agentId !== 'code') return
    void api.code.status().then(setCodeProject).catch(() => setCodeProject(null))
    void api.codeAgent.mode().then(setCodeMode).catch(() => setCodeMode(null))
  }, [agentId, api, codeProject?.root])

  useEffect(() => {
    if (!settings) return
    persistThemeChoice(settings.theme)
    document.documentElement.dataset.accent = settings.accent || 'orange'
    document.documentElement.dataset.density = settings.density || 'comfortable'
  }, [settings])

  useEffect(() => {
    if (tourStep == null) return
    const next = TOUR[tourStep]
    if (next) setView(next.view)
  }, [tourStep])

  function chooseTheme(theme: ThemeChoice) {
    persistThemeChoice(theme)
    void patch({ theme })
  }

  async function patch(p: SettingsPatch) {
    if (p.theme) persistThemeChoice(p.theme)
    await api.settings.set(p)
    await refresh()
    if (p.codeAgentMode !== undefined || p.codeAgentAutoConfirmed !== undefined || p.codeAgentAllowlist !== undefined) {
      const next = await api.codeAgent.mode().catch(() => null)
      if (next) setCodeMode(next)
    }
  }

  function downloadCancelled(error: unknown): boolean {
    const name = error instanceof Error ? error.name : ''
    const message = error instanceof Error ? error.message : String(error)
    return name === 'AbortError' || message === 'Download cancelled.'
  }

  async function download(id: string): Promise<'ok' | 'cancelled'> {
    setError(null)
    setBusyId(id)
    setProgress((p) => ({ ...p, [id]: 0 }))
    try {
      await api.models.download(id)
      return 'ok'
    } catch (e) {
      if (downloadCancelled(e)) {
        setBusyId(null)
        return 'cancelled'
      }
      setError((e as Error).message)
      setBusyId(null)
      throw e
    }
  }

  function cancelDownload() {
    void api.models.cancel().catch(() => undefined)
  }

  async function downloadChatAndEmbed(chatId: string) {
    const st = status ?? await refresh()
    const embed = st.models.find((m) => m.role === 'embedding')
    if (!st.models.find((m) => m.id === chatId)?.installed && await download(chatId) === 'cancelled') return
    if (embed && !embed.installed && await download(embed.id) === 'cancelled') return
    await refresh()
  }

  async function addShots(files: File[]) {
    const read = (await Promise.all(files.map((file) => readShotFile(file)))).filter((shot): shot is Omit<CodeShot, 'id'> => shot !== null)
    if (!read.length) return
    setShots((current) => {
      const added: CodeShot[] = read.map((shot) => ({
        id: `shot-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        name: shot.name,
        mime: shot.mime,
        base64: shot.base64,
      }))
      return current.concat(added).slice(0, 4)
    })
  }

  async function captureShot() {
    try {
      const shot = await api.codeVision.capture({ explicit: true })
      const added: CodeShot = { id: `shot-${Date.now()}`, name: 'Screenshot', mime: 'image/png', base64: shot.base64 }
      setShots((current) => current.concat(added).slice(0, 4))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function saveShot(id: string) {
    const shot = shots.find((item) => item.id === id)
    if (!shot) return
    try {
      await api.codeVision.save({ explicit: true, base64: shot.base64, mime: shot.mime })
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function send(text: string, images: { mime: CodeShot['mime']; base64: string }[] = []) {
    const note = images.length ? `\n[${images.length} screenshot${images.length === 1 ? '' : 's'} kept on this computer]` : ''
    const body = `${text.trim() || (images.length ? 'Look at this screenshot.' : '')}${note}`.trim()
    if (!body) return
    const user: UiMsg = { id: `u-${Date.now()}`, role: 'user', text: body, sources: [], tools: [] }
    const modelId = (agentId === 'code' ? status?.codeModelId : status?.chatModelId) || ''
    const pending: UiMsg = { id: `p-${Date.now()}`, role: 'assistant', text: '', sources: [], tools: [], pending: true, startedAt: Date.now(), modelId }
    setMessages((m) => [...m, user, pending])
    setStreaming(true)
    setView('chat')
    try {
      const res = await api.chat.send({ conversationId, text: body, agentId, images, allowWeb: Boolean(settings?.webSearchAllowed && chatWeb && !settings.offlineOnly), docScope: scope })
      if (images.length) setShots([])
      setConversationId(res.conversationId)
      setMessages((m) => m.map((msg) => (msg.pending ? { ...msg, id: res.messageId } : msg)))
    } catch (e) {
      setStreaming(false)
      setMessages((m) => m.map((msg) => (msg.pending ? { ...msg, pending: false, error: true, text: (e as Error).message } : msg)))
    }
  }

  async function regenerate(messageId: string) {
    const current = messages.find((msg) => msg.id === messageId)
    if (!current || current.role !== 'assistant' || current.pending || streaming) return
    const index = messages.findIndex((msg) => msg.id === messageId)
    const user = [...messages.slice(0, index)].reverse().find((msg) => msg.role === 'user')
    if (!user?.text.trim()) return
    const prior = current.versions ?? []
    const versions = prior[prior.length - 1] === current.text ? prior : [...prior, current.text]
    const modelId = (agentId === 'code' ? status?.codeModelId : status?.chatModelId) || current.modelId || ''
    setMessages((list) => list.map((msg) => (msg.id === messageId ? { ...msg, text: '', sources: [], tools: [], pending: true, versions, startedAt: Date.now(), modelId, error: false } : msg)))
    setStreaming(true)
    try {
      const res = await api.chat.send({ conversationId, text: user.text, agentId, allowWeb: Boolean(settings?.webSearchAllowed && chatWeb && !settings.offlineOnly), docScope: scope, replaceMessageId: messageId })
      setConversationId(res.conversationId)
      setMessages((list) => list.map((msg) => (msg.id === messageId ? { ...msg, id: res.messageId, versions } : msg)))
    } catch (e) {
      setStreaming(false)
      setMessages((list) => list.map((msg) => (msg.id === messageId ? { ...msg, pending: false, error: true, text: (e as Error).message, versions } : msg)))
    }
  }

  async function openConversation(id: string) {
    const opened = await api.conversations.open(id)
    const summary = conversations.find((chat) => chat.id === id)
    if (summary) setAgentId(summary.agentId)
    setConversationId(id)
    setShots([])
    setMessages(opened.messages.map((m) => fromStored(m)))
    setChatWeb(true)
    setView('chat')
  }

  function newChat(nextAgent = agentId) {
    const agent = agents.find((item) => item.id === nextAgent)
    if (!agent || !agentCanChat(agent)) return
    setAgentId(agent.id)
    setConversationId(null)
    setMessages([])
    setShots([])
    setPreview(null)
    setChatWeb(true)
    setView('chat')
  }

  async function chooseChatModel(id: string) {
    const model = status?.models.find((item) => item.id === id && item.role === 'chat')
    if (!model) return
    if (!model.installed && await download(id) === 'cancelled') return
    const codeOnly = model.agents.includes('code') && !model.agents.includes('general')
    await patch(codeOnly ? { codeModelId: id } : { chatModelId: id })
  }

  const codeAuto = useRef(false)
  useEffect(() => {
    if (codeAuto.current || agentId !== 'code' || !status || !settings) return
    if (settings.codeModelId || status.offlineOnly) return
    const def = status.models.find((model) => model.defaultFor?.includes('code'))
    if (!def || def.installed) return
    codeAuto.current = true
    void download(def.id).catch((e: unknown) => setError((e as Error).message))
  }, [agentId, status, settings])

  async function deleteConversation(id: string) {
    await api.conversations.remove(id)
    setConversations(await api.conversations.list())
    if (conversationId === id) {
      setConversationId(null)
      setMessages([])
      setShots([])
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
    void api.updates.check().then((offer) => { if (offer) setUpdateOffer(offer) }).catch(() => undefined)
  }, [api])

  useEffect(() => {
    window.__surfDemo = (scene) => {
      setConvertJob(null)
      setFillJob(null)
      setUpdateOffer(null)
      if (scene === 'home') {
        setView('home')
        setConversations([
          { id: 'c-general', title: 'Harbor ferry', agentId: 'general', updatedAt: 3, preview: 'On this computer.' },
          { id: 'c-code', title: 'Button spacing', agentId: 'code', updatedAt: 2, preview: 'Ask mode is on.' },
          { id: 'c-assistant', title: 'Invoice draft', agentId: 'assistant', updatedAt: 1, preview: 'The draft stays here.' },
        ])
        return
      }
      const agentScene = scene === 'agent-general' ? 'general' : scene === 'agent-code' ? 'code' : scene === 'agent-assistant' ? 'assistant' : null
      if (agentScene) {
        setAgentId(agentScene)
        setView('chat')
        setPreview(null)
        setFiles([])
        setMessages([
          { id: `u-${agentScene}`, role: 'user', text: 'Hello', sources: [], tools: [] },
          { id: `a-${agentScene}`, role: 'assistant', text: 'On this computer.', sources: [], tools: [] },
        ])
        return
      }
      if (scene === 'update') {
        setView('chat')
        setUpdateOffer({
          kind: 'manual',
          version: '0.2.0',
          url: 'https://github.com/kslji/synap.ai/releases/latest',
          notes: '',
          steps: [
            'Download the new .dmg and open it.',
            'Drag Synap.surf to Applications. Replace the old app when asked.',
            'If macOS says the app is from an unidentified developer, open it once, then go to System Settings → Privacy & Security and click Open Anyway. You only need to do this once.',
          ],
        })
        return
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
      if (scene === 'versions') {
        setView('chat')
        setPreview(null)
        setFiles([])
        setMessages([
          { id: '11111111-1111-4111-8111-111111111111', role: 'user', text: 'Hello', sources: [], tools: [] },
          { id: '22222222-2222-4222-8222-222222222222', role: 'assistant', text: 'Second answer', sources: [], tools: [], versions: ['First answer'] },
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
        setDemoAccount({ email: 'ada@example.com', deviceId: '11111111-1111-4111-8111-111111111111', plan: 'Pro' })
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

  if (!status || !settings || !licence) {
    return (
      <main className="flex h-full flex-col items-center justify-center gap-2" data-ready="no">
        <StarSurf state="searching" size={160} />
        <p className="text-sm text-[var(--muted)]">{error ?? 'Starting Synap.surf'}</p>
      </main>
    )
  }

  const unlocked = licence.state === 'valid' || licence.state === 'grace' || licence.state === 'dev'
  if (!unlocked && !demoAccount) {
    return (
      <div className="h-full" data-ready="yes" data-screen={licence.state === 'subscription_ended' ? 'renew' : 'activate'}>
        <ActivationScreen
          theme={settings.theme}
          onTheme={chooseTheme}
          status={licence}
          offlineOnly={settings.offlineOnly}
          renewal={licence.state === 'subscription_ended'}
          onAllowNetwork={async () => { await patch({ networkMode: 'auto' }) }}
          onStart={(email) => api.auth.start(email)}
          onVerify={async (email, code) => {
            await api.auth.verify(email, code)
            await api.licence.activate()
            await refresh()
          }}
          onKey={async (key) => {
            await api.licence.activate(key)
            await refresh()
          }}
        />
      </div>
    )
  }

  const shownAccount = demoAccount ?? account
  const shownPacks = demoPacks ?? packs
  const devMode = licence.state === 'dev'
  const screen: View = devMode && view === 'onboarding' ? 'chat' : view

  if (screen === 'signin') {
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

  if (screen === 'onboarding') {
    return (
      <div className="h-full" data-ready="yes" data-screen="onboarding">
        <Onboarding
          status={status}
          progress={busyId ? (progress[busyId] ?? 0) : 0}
          error={error}
          theme={settings.theme}
          onTheme={chooseTheme}
          onDownload={downloadChatAndEmbed}
          onReady={(chatId) => { void patch({ onboardingComplete: true, chatModelId: chatId }).then(() => { setView('home'); setTourStep(0) }) }}
        />
      </div>
    )
  }

  return (
    <div className="app-shell relative flex h-full flex-col" data-ready="yes" data-screen={screen}>
      {licence.subscriptionWarning && licence.subscriptionEndsAt && (
        <div className="border-b border-[var(--line)] px-4 py-2 text-center text-sm" data-licence-ending="yes">
          This subscription ends on {licence.subscriptionEndsAt.slice(0, 10)}. Renew to keep using Synap.surf.
        </div>
      )}
      {licence.state === 'grace' && (
        <div className="border-b border-[var(--line)] px-4 py-2 text-center text-sm" data-licence-grace="yes">{licence.message}</div>
      )}
      {updateOffer && <UpdateBanner offer={updateOffer} onApply={() => { void api.updates.apply().catch((e: unknown) => setError((e as Error).message)) }} />}
      <div className="flex min-h-0 flex-1">
      <Sidebar
        view={screen}
        devMode={devMode}
        conversations={conversations}
        activeId={conversationId}
        agentId={agentId}
        onView={setView}
        theme={settings.theme}
        onTheme={chooseTheme}
        mascotName={settings.mascotName || 'Surf Bot'}
        animateMascot={settings.animateMascot !== false}
        onMascotName={(mascotName) => { void patch({ mascotName }) }}
        onSignIn={() => setView('signin')}
        signedIn={Boolean(shownAccount)}
        onSignOut={() => {
          setDemoAccount(null)
          setDemoDevices(null)
          void api.auth.signOut().then(() => refresh()).catch((e: unknown) => setError((e as Error).message))
        }}
        tourId={tourStep != null ? TOUR[tourStep]?.id ?? null : null}
        onNew={() => newChat()}
        onOpen={(id) => { void openConversation(id) }}
        onDelete={(id) => { void deleteConversation(id) }}
        onAgent={(id) => newChat(id)}
        sync={status.sync}
      />
      {screen === 'home' && (
        <HomeScreen
          agents={agents}
          conversations={conversations}
          onStart={(id) => newChat(id)}
          onOpen={(id) => { void openConversation(id) }}
          onAsk={() => newChat('general')}
          onDocument={() => { newChat(agentId); void api.library.pick(null, true).then((res) => { if (res.conversationId) setConversationId(res.conversationId); return api.library.list() }).then(setFiles).catch((e: unknown) => setError((e as Error).message)) }}
          onFill={() => { void openFill({ id: '', name: 'Choose a file', mime: '', sizeBytes: 0, addedAt: 0, conversationIds: [], status: 'done', stage: null, progress: 0, error: null, jobId: null, chunkCount: 0 }).catch((e: unknown) => setError((e as Error).message)) }}
          onConvert={() => { void openConvert({ id: '', name: 'Choose a file', mime: '', sizeBytes: 0, addedAt: 0, conversationIds: [], status: 'done', stage: null, progress: 0, error: null, jobId: null, chunkCount: 0 }).catch((e: unknown) => setError((e as Error).message)) }}
          onSearch={() => setView('library')}
        />
      )}
      {screen === 'agents' && <AgentsScreen agents={agents} onStart={(id) => newChat(id)} />}
      {screen === 'chats' && (
        <ChatsScreen agents={agents} conversations={conversations} agentId={agentId} onOpen={(id) => { void openConversation(id) }} onNew={() => newChat()} />
      )}
      {screen === 'chat' && (
        <ChatScreen
          messages={messages}
          streaming={streaming}
          status={status}
          files={conversationId ? files.filter((file) => file.conversationIds.includes(conversationId)) : []}
          scope={scope}
          preview={preview}
          webSearchAllowed={settings.webSearchAllowed}
          chatWeb={chatWeb}
          agentName={agents.find((agent) => agent.id === agentId)?.name ?? 'General'}
          agentNote={agents.find((agent) => agent.id === agentId)?.notes}
          title={conversations.find((chat) => chat.id === conversationId)?.title}
          modelLabel={(agentId === 'code' ? activeCodeModel(status) : activeChatModel(status))?.label ?? 'Qwen3.5'}
          tourAttach={tourStep != null && TOUR[tourStep]?.id === 'attach'}
          onSend={(t, images) => { void send(t, images) }}
          shots={agentId === 'code' ? shots : []}
          onAddShots={agentId === 'code' ? (files) => { void addShots(files) } : undefined}
          onRemoveShot={agentId === 'code' ? (id) => setShots((current) => current.filter((shot) => shot.id !== id)) : undefined}
          onSaveShot={agentId === 'code' ? (id) => { void saveShot(id) } : undefined}
          onCaptureShot={agentId === 'code' ? () => { void captureShot() } : undefined}
          onToggleChatWeb={() => { if (settings.webSearchAllowed) setChatWeb((on) => !on) }}
          onAttach={(paths) => { void attach(paths, true).catch((e: unknown) => setError((e as Error).message)) }}
          onPick={() => { void api.library.pick(conversationId, true).then((res) => { if (res.conversationId) setConversationId(res.conversationId); return api.library.list() }).then(setFiles).catch((e: unknown) => setError((e as Error).message)) }}
          onScope={setScope}
          onOpenCitation={(id) => { void openCitation(id) }}
          onClosePreview={() => setPreview(null)}
          modelGuide={agentId === 'code'}
          onSwitchSmaller={(id) => { void chooseChatModel(id).catch((e: unknown) => setError((e as Error).message)) }}
          project={agentId === 'code' ? codeProject : undefined}
          onOpenProject={() => { void api.code.pick().then(setCodeProject).catch((e: unknown) => setError((e as Error).message)) }}
          onCodeDecide={(messageId, id, allow, remember, all) => { void api.codeAgent.decide({ messageId, id, allow, remember, all }).catch((e: unknown) => setError((e as Error).message)) }}
          onCodeRevise={(messageId, order, edits) => { void api.codeAgent.revise({ messageId, order, edits }).catch((e: unknown) => setError((e as Error).message)) }}
          onCodeUndo={(messageId, stepId) => { void api.codeAgent.undo({ messageId, stepId }).catch((e: unknown) => setError((e as Error).message)) }}
          onCodeUndoAll={(messageId) => { void api.codeAgent.undo({ messageId, stepId: 'all', all: true }).catch((e: unknown) => setError((e as Error).message)) }}
          codeMode={codeMode?.mode ?? 'ask'}
          autoConfirmed={codeMode?.autoConfirmed ?? false}
          onCodeMode={(mode, confirmAuto) => {
            void api.codeAgent.setMode({ mode, confirmAuto }).then((result) => {
              if (result.needsConfirm) return
              return api.codeAgent.mode()
            }).then((next) => { if (next) setCodeMode(next) }).catch((e: unknown) => setError((e as Error).message))
          }}
          tabSuggestions={settings.tabSuggestions}
          tabSuggestionsOff={settings.tabSuggestionsOff}
          animateMascot={settings.animateMascot !== false}
          onRegenerate={(id) => { void regenerate(id) }}
          downloadBusyId={busyId}
          downloadProgress={progress}
          setupError={error}
          onDownloadModel={(id) => {
            void download(id).then((result) => {
              if (result !== 'ok') return
              return patch({ chatModelId: id, onboardingComplete: true })
            }).catch(() => undefined)
          }}
          onCancelDownload={cancelDownload}
          onStop={agentId === 'code' ? () => {
            const pending = messages.find((msg) => msg.pending && msg.role === 'assistant')
            if (pending && !pending.id.startsWith('p-')) void api.chat.cancel(pending.id)
          } : undefined}
        />
      )}
      {screen === 'library' && (
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
      {screen === 'packs' && (
        <PacksScreen
          packs={shownPacks}
          busy={packBusy}
          syncOff={devMode}
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
      {screen === 'models' && (
        <ModelsScreen
          status={status}
          progress={progress}
          busyId={busyId}
          error={error}
          onDownload={(id) => { void download(id).catch(() => undefined) }}
          onCancel={cancelDownload}
          onSelect={(id) => { void chooseChatModel(id).catch((e: unknown) => setError((e as Error).message)) }}
        />
      )}
      {screen === 'usage' && (
        <UsagePanel machine={{ cpuModel: status.cpuModel, ramGb: status.ramGb }} />
      )}
      {screen === 'settings' && (
        <SettingsScreen
          status={status}
          settings={settings}
          account={shownAccount}
          devices={demoDevices ?? licenceDevices.map((device) => ({ ...device, status: 'active' }))}
          licenceState={licence.state}
          termMonths={demoAccount ? null : licence.termMonths}
          subscriptionEndsAt={demoAccount ? null : licence.subscriptionEndsAt}
          knowledgePack={(() => {
            const installed = (demoPacks ?? packs).find((row) => row.installed && row.version)
            return installed ? { version: installed.version, syncedAt: installed.syncedAt } : null
          })()}
          licenceNote={licence.state === 'dev' || licence.state === 'grace' ? licence.message : null}
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
            void api.licence.deactivate(id).then(() => refresh()).catch((e: unknown) => setError((e as Error).message))
          }}
          onDeactivate={() => {
            if (demoDevices) {
              setDemoDevices([])
              setDemoAccount(null)
              return
            }
            void api.licence.deactivate().then(() => refresh()).catch((e: unknown) => setError((e as Error).message))
          }}
          onPatch={(p) => { void patch(p) }}
          progress={progress}
          busyId={busyId}
          error={error}
          onDownload={(id) => { void download(id).catch(() => undefined) }}
          onCancelDownload={cancelDownload}
          onSelectModel={(id) => { void chooseChatModel(id).catch((e: unknown) => setError((e as Error).message)) }}
          onBack={() => setView('chat')}
          onSave={() => { void patch({}) }}
          onRestore={() => {
            void patch({
              theme: 'light',
              accent: 'orange',
              density: 'comfortable',
              mascotName: 'Surf Bot',
              animateMascot: true,
              networkMode: 'auto',
              webSearchAllowed: false,
              telemetryOptIn: false,
            })
          }}
          onImportLocal={() => { void api.models.importLocal().catch((e: unknown) => setError((e as Error).message)) }}
          onCheckUpdates={async () => {
            const offer = await api.updates.check()
            setUpdateOffer(offer)
            if (!offer) return 'You are up to date.'
            return offer.kind === 'manual'
              ? `Version ${offer.version} is available. Download the disk image from the banner.`
              : `Version ${offer.version} can install over this copy.`
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
      {tourStep != null && TOUR[tourStep] && (
        <div className="tour-shade" role="dialog" aria-label="Guided tour">
          <div className="tour-card card px-5 py-5">
            <StarSurf state="guiding" size={72} />
            <p className="mt-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Step {tourStep + 1} of {TOUR.length}</p>
            <h2 className="mt-1 text-lg font-semibold">{TOUR[tourStep].title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">{TOUR[tourStep].body}</p>
            <div className="mt-4 flex gap-2">
              <button className="btn btn-ghost" type="button" onClick={() => setTourStep(null)}>Skip</button>
              <button className="btn btn-primary" type="button" onClick={() => setTourStep((step) => (step == null || step + 1 >= TOUR.length ? null : step + 1))}>
                {tourStep + 1 >= TOUR.length ? 'Done' : 'Next'}
              </button>
            </div>
          </div>
        </div>
      )}
      {error && (
        <div className="pointer-events-none absolute left-0 right-0 top-3 z-20 flex justify-center px-4">
          <div className="card pointer-events-auto flex items-center gap-3 px-4 py-3 text-sm" role="alert">
            <StarSurf state="error" size={40} />
            <span>{error}</span>
            <button className="btn btn-ghost" type="button" onClick={() => setError(null)}>Dismiss</button>
          </div>
        </div>
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
    </div>
  )
}
