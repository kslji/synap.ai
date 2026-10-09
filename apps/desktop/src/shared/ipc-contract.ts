/**
 * The ONLY bridge between the UI (renderer) and the privileged main process.
 * Shared by main, preload and renderer. Deliberately has NO runtime dependencies so the sandboxed
 * preload can bundle it. Runtime validation lives in ipc-schemas.ts (main only, zod).
 */
export const IPC = {
  chatSend: 'chat:send',
  chatCancel: 'chat:cancel',
  chatEvent: 'chat:event',
  modelsStatus: 'models:status',
  modelsDownload: 'models:download',
  modelsEvent: 'models:event',
  packsList: 'packs:list',
  packsImportFile: 'packs:import-file',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  updatesCheck: 'updates:check',
  updatesInstallOffline: 'updates:install-offline',
  conversationsList: 'conversations:list',
  conversationsOpen: 'conversations:open',
} as const

export interface ChatSendReq {
  conversationId: string | null
  text: string
  agentId?: string
  images?: { mime: 'image/png' | 'image/jpeg'; base64: string }[]
  allowWeb?: boolean
}

export type ThemeChoice = 'system' | 'light' | 'dark'

export interface SettingsPatch {
  offlineOnly?: boolean
  webSearchAllowed?: boolean
  telemetryOptIn?: boolean
  chatModelId?: string
  onboardingComplete?: boolean
  theme?: ThemeChoice
}

export type GateName = 'answer' | 'borderline' | 'insufficient' | 'web'

export type ChatEvent =
  | { type: 'token'; messageId: string; text: string }
  | { type: 'sources'; messageId: string; sources: { title: string; url: string; pack: string }[] }
  | { type: 'tool'; messageId: string; name: string; input: string; output: string }
  | { type: 'done'; messageId: string; gate: GateName }
  | { type: 'error'; messageId: string; message: string }

export interface CatalogModel {
  id: string
  role: 'chat' | 'embedding' | 'asr' | 'vad'
  label: string
  paramsB: number | null
  sizeBytes: number
  minRamGb: number
  tiers: number[]
  installed: boolean
  recommended: boolean
  fitsRam: boolean
}

export interface ModelStatus {
  tier: 0 | 1 | 2 | 3
  ramGb: number
  cpuModel: string
  cores: number
  chatModelId: string
  installed: string[]
  downloading: { id: string; done: number; total: number } | null
  sidecars: Record<'chat' | 'embed' | 'whisper', 'stopped' | 'starting' | 'ready' | 'crashed'>
  models: CatalogModel[]
  online: boolean
  offlineOnly: boolean
  onboardingComplete: boolean
  /** encrypted = SQLCipher chat.db. session = this launch only, because OS keychain was unavailable. */
  chatPersistence: 'encrypted' | 'session'
}

export interface ConversationSummary {
  id: string
  title: string
  agentId: string
  updatedAt: number
}

export interface StoredMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  sources: { title: string; url: string; pack: string }[]
  gate?: GateName
}

export interface ModelEvent {
  id: string
  done: number
  total: number
  state: string
  error?: string
}

/** What window.surf looks like in the renderer. */
export interface SurfApi {
  chat: {
    send(req: ChatSendReq): Promise<{ conversationId: string; messageId: string }>
    cancel(messageId: string): Promise<void>
    onEvent(cb: (e: ChatEvent) => void): () => void
  }
  models: {
    status(): Promise<ModelStatus>
    download(modelId: string): Promise<void>
    onEvent(cb: (e: ModelEvent) => void): () => void
  }
  packs: {
    list(): Promise<{ id: string; version: string; niche: string }[]>
    importFromFile(): Promise<string | null>
  }
  settings: {
    get(): Promise<Required<SettingsPatch>>
    set(p: SettingsPatch): Promise<void>
  }
  updates: {
    check(): Promise<string | null>
    installOffline(): Promise<boolean>
  }
  conversations: {
    list(): Promise<ConversationSummary[]>
    open(id: string): Promise<{ id: string; messages: StoredMessage[] }>
  }
}
