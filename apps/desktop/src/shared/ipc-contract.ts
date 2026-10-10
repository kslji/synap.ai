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
  packsSync: 'packs:sync',
  packsRemove: 'packs:remove',
  packsImportFile: 'packs:import-file',
  authStatus: 'auth:status',
  authStart: 'auth:start',
  authVerify: 'auth:verify',
  authSignOut: 'auth:sign-out',
  authDevices: 'auth:devices',
  authRevoke: 'auth:revoke',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  updatesCheck: 'updates:check',
  updatesApply: 'updates:apply',
  updatesInstallOffline: 'updates:install-offline',
  conversationsList: 'conversations:list',
  conversationsOpen: 'conversations:open',
  conversationsDelete: 'conversations:delete',
  webCacheStatus: 'web-cache:status',
  webCacheClear: 'web-cache:clear',
  libraryAdd: 'library:add',
  libraryPick: 'library:pick',
  libraryList: 'library:list',
  libraryRetry: 'library:retry',
  libraryCancel: 'library:cancel',
  libraryDelete: 'library:delete',
  libraryPreview: 'library:preview',
  libraryEvent: 'library:event',
  linksOpen: 'links:open',
  documentsPick: 'documents:pick',
  documentsConvert: 'documents:convert',
  documentsPlan: 'documents:plan',
  documentsExport: 'documents:export',
  documentsCancel: 'documents:cancel',
  documentsEvent: 'documents:event',
} as const

export type DocScope = 'chat' | 'all'

export interface ChatSendReq {
  conversationId: string | null
  text: string
  agentId?: string
  images?: { mime: 'image/png' | 'image/jpeg'; base64: string }[]
  allowWeb?: boolean
  docScope?: DocScope
}

export type ThemeChoice = 'system' | 'light' | 'dark'

export interface SettingsPatch {
  offlineOnly?: boolean
  webSearchAllowed?: boolean
  telemetryOptIn?: boolean
  chatModelId?: string
  onboardingComplete?: boolean
  theme?: ThemeChoice
  /** Search service origin. Production placeholder until a VM is deployed. */
  apiBaseUrl?: string
  /** Hours between signed-in pack checks. */
  packSyncHours?: number
  /** stable hides -beta tags. beta includes them. */
  updateChannel?: 'stable' | 'beta'
}

export interface UpdateOffer {
  kind: 'nsis' | 'manual'
  version: string
  url: string
  notes: string
  steps: string[]
}

export type GateName = 'answer' | 'borderline' | 'insufficient' | 'web'

export type ChatEvent =
  | { type: 'token'; messageId: string; text: string }
  | { type: 'sources'; messageId: string; sources: Citation[] }
  | { type: 'tool'; messageId: string; name: string; input: string; output: string }
  | { type: 'status'; messageId: string; phase: 'searching' | 'reading' }
  | { type: 'done'; messageId: string; gate: GateName; text?: string; budget?: {
    counter: string
    total: number
    droppedChunks: number
    droppedTurns: number
    truncatedQuestion: boolean
    parts: Record<string, number>
    retrievedCap: number
    maxChunks: number
  } }
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
  arch: string
  platform: string
  installed: string[]
  downloading: { id: string; done: number; total: number } | null
  sidecars: Record<'chat' | 'embed' | 'whisper', 'stopped' | 'starting' | 'ready' | 'crashed'>
  models: CatalogModel[]
  online: boolean
  /** Why the pill says online, offline, or offline only. */
  onlineReason: string
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

export interface Citation {
  title: string
  url: string
  pack: string
  version?: string
  kind?: 'document' | 'web'
  domain?: string
  published?: string | null
  chunkId?: number
  fileName?: string
  locator?: string | null
  excerpt?: string
  /** When this web passage was stored on this computer. */
  savedAt?: number
  /** Set when a fresh-sensitive question is using a passage older than 24 hours. */
  staleNote?: string
  /** The passage was left out of the prompt because it contained instructions. */
  suspicious?: boolean
}

export interface WebCacheStatus {
  bytes: number
  count: number
  capBytes: number
}

export type AttachmentStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled'

export interface LibraryFile {
  id: string
  name: string
  mime: string
  sizeBytes: number
  addedAt: number
  conversationIds: string[]
  status: AttachmentStatus
  stage: string | null
  progress: number
  error: string | null
  jobId: string | null
  chunkCount: number
}

export interface ChunkPreview {
  chunkId: number
  fileName: string
  title: string
  heading: string | null
  locator: string | null
  text: string
}

export interface LibraryEvent {
  type: 'upsert'
  file: LibraryFile
}

export type ExportFormat = 'txt' | 'md' | 'html' | 'docx' | 'png' | 'jpeg' | 'csv' | 'xlsx' | 'pdf'

export interface FillRow {
  id: string
  label: string
  value: string
  citation: string | null
  confidence: 'high' | 'none'
  found: boolean
  locator: string
}

export interface FillPlan {
  templatePath: string | null
  templateAttachmentId: string | null
  sourcePath: string | null
  sourceAttachmentId: string | null
  templateName: string
  sourceName: string
  role: 'template-first' | 'source-first' | 'ask'
  rows: FillRow[]
  warnings: string[]
}

export interface DocumentResult {
  outputPath: string
  warnings: string[]
}

export interface DocumentEvent {
  progress: number
  stage: string
  done: boolean
  error?: string
}

export interface StoredMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  sources: Citation[]
  gate?: GateName
}

export interface ModelEvent {
  id: string
  done: number
  total: number
  state: string
  error?: string
}

export interface AuthStatus {
  signedIn: boolean
  email: string | null
  deviceId: string | null
}

export interface DeviceInfo {
  id: string
  name: string
  os: string
  status: string
  current: boolean
}

export interface PackRow {
  id: string
  title: string
  niche: string
  version: string | null
  latestVersion: string | null
  installed: boolean
  updateAvailable: boolean
  syncedAt: number | null
  progress: number | null
  error: string | null
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
    list(): Promise<PackRow[]>
    sync(): Promise<PackRow[]>
    remove(packId: string): Promise<void>
    importFromFile(): Promise<string | null>
  }
  auth: {
    status(): Promise<AuthStatus>
    start(email: string): Promise<void>
    verify(email: string, code: string): Promise<AuthStatus>
    signOut(): Promise<void>
    devices(): Promise<DeviceInfo[]>
    revoke(deviceId: string): Promise<void>
  }
  settings: {
    get(): Promise<Required<SettingsPatch>>
    set(p: SettingsPatch): Promise<void>
  }
  updates: {
    check(): Promise<UpdateOffer | null>
    apply(): Promise<void>
    installOffline(): Promise<boolean>
  }
  conversations: {
    list(): Promise<ConversationSummary[]>
    open(id: string): Promise<{ id: string; messages: StoredMessage[] }>
    remove(id: string): Promise<void>
  }
  webCache: {
    status(): Promise<WebCacheStatus>
    clear(): Promise<WebCacheStatus>
  }
  library: {
    pathForFile(file: File): string
    add(paths: string[], conversationId: string | null, createConversation?: boolean): Promise<{ conversationId: string | null; files: LibraryFile[] }>
    pick(conversationId: string | null, createConversation?: boolean): Promise<{ conversationId: string | null; files: LibraryFile[] }>
    list(): Promise<LibraryFile[]>
    retry(jobId: string): Promise<void>
    cancel(jobId: string): Promise<void>
    remove(attachmentId: string): Promise<void>
    preview(ref: { chunkId?: number; attachmentId?: string }): Promise<ChunkPreview | null>
    onEvent(cb: (e: LibraryEvent) => void): () => void
  }
  links: {
    open(url: string): Promise<void>
  }
  documents: {
    pick(title: string): Promise<string | null>
    convert(input: { path?: string; attachmentId?: string }, format: ExportFormat): Promise<DocumentResult | null>
    plan(input: { templatePath?: string; templateAttachmentId?: string; sourcePath?: string; sourceAttachmentId?: string }): Promise<FillPlan>
    export(input: { templatePath?: string; templateAttachmentId?: string; rows: FillRow[]; format: ExportFormat | 'same'; highlight: boolean }): Promise<DocumentResult | null>
    cancel(): Promise<void>
    onEvent(cb: (e: DocumentEvent) => void): () => void
  }
}
