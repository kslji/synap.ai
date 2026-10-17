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
  modelsCancel: 'models:cancel',
  modelsImportLocal: 'models:import-local',
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
  licenceStatus: 'licence:status',
  licenceActivate: 'licence:activate',
  licenceDeactivate: 'licence:deactivate',
  licenceDevices: 'licence:devices',
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
  codePick: 'code:pick',
  codeStatus: 'code:status',
  codeStorage: 'code:storage',
  codeEvent: 'code:event',
  codeAgentRoot: 'code-agent:root',
  codeAgentPick: 'code-agent:pick',
  codeAgentDecide: 'code-agent:decide',
  codeAgentRevise: 'code-agent:revise',
  codeAgentUndo: 'code-agent:undo',
  codeAgentMode: 'code-agent:mode',
  codeAgentSetMode: 'code-agent:set-mode',
  codeCompleteSuggest: 'code-complete:suggest',
  codeCompleteFiles: 'code-complete:files',
  codeCompleteRead: 'code-complete:read',
  codeCompleteSave: 'code-complete:save',
  codeVisionCapture: 'code-vision:capture',
  codeVisionSave: 'code-vision:save',
  devWebRun: 'dev-web:run',
  usageGet: 'usage:get',
  usageReset: 'usage:reset',
  usageCsv: 'usage:csv',
  modelsBenchmark: 'models:benchmark',
  storageReport: 'storage:report',
  storageClear: 'storage:clear',
  storageOpen: 'storage:open',
} as const

export type DocScope = 'chat' | 'all'

export interface ChatSendReq {
  conversationId: string | null
  text: string
  agentId?: string
  images?: { mime: 'image/png' | 'image/jpeg' | 'image/webp'; base64: string }[]
  allowWeb?: boolean
  docScope?: DocScope
  /** When set, the new answer is another version of this assistant reply. No new user turn is stored. */
  replaceMessageId?: string
}

export type ThemeChoice = 'light' | 'dark'

export interface SettingsPatch {
  offlineOnly?: boolean
  webSearchAllowed?: boolean
  telemetryOptIn?: boolean
  chatModelId?: string
  /** Code agent model. Empty means the smallest Code model. */
  codeModelId?: string
  onboardingComplete?: boolean
  theme?: ThemeChoice
  /** Account, licence, and pack server. Production web search does not call this. */
  apiBaseUrl?: string
  /** Country or ISO code. Overrides the public-IP lookup when a VPN is in use. Empty uses IP, then worldwide. */
  myRegion?: string
  /** Hours between signed-in pack checks. */
  packSyncHours?: number
  /** stable hides -beta tags. beta includes them. */
  updateChannel?: 'stable' | 'beta'
  /** Default Code agent mode for a project that has no saved choice. Ask until the user opts in. */
  codeAgentMode?: 'ask' | 'auto'
  /** Extra commands Auto may run, one exact command each. Detected test, lint, typecheck, and build commands are added per project. */
  codeAgentAllowlist?: string[]
  /** True after the user has read what Auto mode can do and turned it on. */
  codeAgentAutoConfirmed?: boolean
  /** Ghost-text Tab suggestions in the code editor. When omitted, the default follows RAM. */
  tabSuggestions?: boolean
  /** Languages where Tab suggestions stay off, such as markdown. */
  tabSuggestionsOff?: string[]
  /** Load the selected model when the app opens, when it fits this computer. */
  keepWarm?: boolean
  /** Unload the model after this many quiet minutes. */
  idleUnloadMinutes?: number
  /** Prefer speculative decoding when a draft model is installed and RAM allows it. */
  speculativeDecoding?: boolean
  /** Display name for the star mascot. Saved on this computer. */
  mascotName?: string
  accent?: 'orange' | 'blue' | 'indigo' | 'navy'
  density?: 'compact' | 'comfortable' | 'relaxed'
  /** SVG motion for the mascot. There is no audio. */
  animateMascot?: boolean
  /** Offline blocks every network call. Online allows web and pack sync. Auto follows the connection. */
  networkMode?: 'offline' | 'online' | 'auto'
}

/** Shown before Auto mode is allowed to write or run commands. */
export const AUTO_MODE_SUMMARY =
  'Auto mode writes files inside this project and runs test, lint, typecheck, and build commands from the allowlist without asking each time. It still asks before install, network, or other commands, and before destructive operations. It does not delete files outside its own undo checkpoints. Stop ends the run and leaves undo available.'

export interface CodeVisionCaptureReq {
  explicit: true
}

export interface CodeVisionCaptureResult {
  base64: string
  mime: 'image/png'
}

export interface CodeVisionSaveReq {
  explicit: true
  base64: string
  mime: 'image/png' | 'image/jpeg' | 'image/webp'
}

export interface CodeVisionSaveResult {
  saved: boolean
}

export interface CodeCompleteReq {
  sessionId: string
  path: string
  language: string
  text: string
  cursor: number
}

export interface CodeCompleteResult {
  text: string
  mode: 'fim' | 'prefix' | 'none'
  cached: boolean
  latencyMs: number
  span: 'line' | 'block' | 'none'
}

export interface CodeEditorFile {
  path: string
  language: string
}

export interface CodeEditorText {
  path: string
  language: string
  text: string
}

export interface DevWebRunReq {
  tool: 'web_search' | 'fetch_page'
  query?: string
  url?: string
}

export interface DevWebRunResult {
  text: string
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
  | { type: 'code-step'; messageId: string; step: CodeStepView }
  | { type: 'code-diff'; messageId: string; diff: CodeDiffView }
  | { type: 'code-plan'; messageId: string; plan: CodePlanView }
  | { type: 'error'; messageId: string; message: string; smallerModelId?: string }

export type CodeStepStatus = 'running' | 'ok' | 'error' | 'waiting' | 'rejected' | 'applied'

export interface CodeDiagnosticView {
  file: string
  line: number
  column: number
  message: string
  rule: string
  source: string
}

export interface CodeStepView {
  id: string
  index: number
  tool: string
  status: CodeStepStatus
  title: string
  detail: string
  /** Live check log. The tail is kept so the row stays small. */
  output?: string
  diagnostics?: CodeDiagnosticView[]
  /** 1-based attempt or candidate counter. */
  attempt?: number
  attempts?: number
  /** Best-effort sandbox note. Present when a command actually ran. */
  note?: string
}

export type CodeDiffStatus = 'pending' | 'applied' | 'rejected' | 'error'

export interface CodeDiffView {
  id: string
  stepId: string
  path: string
  diff: string
  status: CodeDiffStatus
}

export interface CodePlanStepView {
  id: string
  index: number
  goal: string
  files: string[]
  symbols: string[]
  dependsOn: string[]
  check: string
  create: boolean
}

export interface CodeUndoView {
  stepId: string
  title: string
}

export interface CodePlanView {
  status: 'review' | 'running' | 'done'
  steps: CodePlanStepView[]
  undos?: CodeUndoView[]
}

export interface CodeAgentRoot {
  root: string | null
}

export interface CodePlanGoalEdit {
  id: string
  goal: string
}

export interface CodeAgentReviseReq {
  messageId: string
  order: string[]
  edits?: CodePlanGoalEdit[]
}

export interface CodeAgentUndoReq {
  messageId: string
  stepId: string
  /** Restore every checkpoint for this run, last step first. */
  all?: boolean
}

export interface CodeAgentDecideReq {
  messageId: string
  id: string
  allow: boolean
  remember?: boolean
  /** Apply this yes to every later file write in the same run. */
  all?: boolean
}

export interface CodeAgentModeState {
  mode: 'ask' | 'auto'
  autoConfirmed: boolean
  allowlist: string[]
  defaultMode: 'ask' | 'auto'
  /** Saved choice for the open project. Null when the project follows the default. */
  projectMode: 'ask' | 'auto' | null
}

export interface CodeAgentSetModeReq {
  mode: 'ask' | 'auto'
  /** Set on the first switch to Auto, after the user accepts the explanation. */
  confirmAuto?: boolean
}

export interface CodeAgentSetModeResult {
  ok: boolean
  needsConfirm: boolean
  mode: 'ask' | 'auto'
}

export interface CatalogModel {
  id: string
  role: 'chat' | 'embedding' | 'asr' | 'vad'
  label: string
  family: string
  /** Picker size token, such as 2B or E2B. */
  sizeName: string
  paramsB: number | null
  sizeBytes: number
  minRamGb: number
  tiers: number[]
  installed: boolean
  recommended: boolean
  fitsRam: boolean
  /** Installer file. Shown only under Settings → Models → Details. */
  file?: string
  /** Quant string such as Q4_K_M. Shown only under Details. */
  quant?: string | null
  /** Empty means General and Assistant. `code` is the Code agent list. */
  agents: string[]
  defaultFor: string[]
  peakRamGb: number | null
  /** false when the RAM figure is a tier, not a measurement. */
  ramMeasured: boolean
  note?: string
  visionBytes: number | null
  visionInstalled: boolean
  /** True when this installed Qwen3.5 Code model and its mmproj fit the laptop. Nothing downloads until the user asks. */
  visionOffer: boolean
  /** Code list only. Recommended is Qwen3.5 2B. Null on General and Assistant rows. */
  fitMark: 'recommended' | 'fits' | 'too-big' | null
}

export interface ModelStatus {
  tier: 0 | 1 | 2 | 3
  ramGb: number
  cpuModel: string
  cores: number
  chatModelId: string
  /** First-run model from synap://setup, or the Qwen 2B default when no link arrived. */
  setupModelId?: string
  /** Code agent selection. The smallest Code model when the user has not picked. */
  codeModelId: string
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
  /** True only when NODE_ENV=development or SYNAP_DEV_WEB=1. Omitted tools stay off. */
  devWeb?: boolean
  /** Search origin while dev web is on. Omitted in production builds. */
  devApiUrl?: string
  live?: {
    keepWarm: boolean
    warmModelId: string | null
    speculative: 'on' | 'off' | 'offer'
    speculativeReason: 'on' | 'off' | 'runtime' | 'missing' | 'ram'
    draftModelId: string
    draftInstalled: boolean
  }
  /** electron app.getVersion(). Empty only in a stub that did not set it. */
  appVersion?: string
  gpus?: { vendor: string; model: string; vramMb: number | null }[]
  /** llama-server -c for this machine's tier. */
  contextTokens?: number
  /** Configured prompt-cache RAM. Zero means the cache is off. Not a file size. */
  promptCacheMiB?: number
  freeRamGb?: number
  benchmarks?: { modelId: string; tokensPerSec: number; measuredAt: number; sizeBytes: number }[]
  /** Background pack sync. Absent only on a stub that did not build it. */
  sync?: SyncChip
}

export interface SyncChip {
  label: string
  state: 'uptodate' | 'syncing' | 'failed' | 'offline'
  mode: 'offline' | 'online' | 'auto'
  modeLabel: 'Offline' | 'Online' | 'Auto'
  packVersion: string | null
  lastSyncAt: number | null
  tooltip: string
  detail: string
  refreshWarning: string | null
  /** False in dev mode. The chip then shows only its label. */
  showMode?: boolean
}

export interface BenchmarkResult {
  measured: boolean
  modelId: string
  tokensPerSec: number | null
  tokens: number | null
  elapsedMs: number | null
  measuredAt: number | null
  reason?: string
}

export interface ConversationSummary {
  id: string
  title: string
  agentId: string
  updatedAt: number
  /** Last message on this computer, trimmed. Empty when the chat has no messages. */
  preview?: string
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

export type StorageCategoryId = 'models' | 'packs' | 'indexes' | 'chats' | 'web' | 'logs' | 'shots'

export interface UsageModelRow {
  modelId: string
  tasks: number
  steps: number
  tokensIn: number
  tokensOut: number
  tokensPerSec: number | null
  ttftP50Ms: number | null
  ttftP95Ms: number | null
  ramMb: number | null
  cpuPercent: number | null
}

export interface UsageDayRow {
  day: string
  tasks: number
  steps: number
  tokensIn: number
  tokensOut: number
  tokensPerSec: number | null
  ttftP50Ms: number | null
  ttftP95Ms: number | null
}

export interface UsageAgentRow {
  agentId: string
  tasks: number
  tokensIn: number
  tokensOut: number
}

export interface UsageEntryRow {
  day: string
  agentId: string
  modelId: string
  tasks: number
  tokensIn: number
  tokensOut: number
  tokensPerSec: number | null
}

export interface UsageReport {
  tasks: number
  steps: number
  tokensIn: number
  tokensOut: number
  tokensPerSec: number | null
  ttftP50Ms: number | null
  ttftP95Ms: number | null
  ramMb: number | null
  cpuPercent: number | null
  models: UsageModelRow[]
  days: UsageDayRow[]
  agents: UsageAgentRow[]
  entries: UsageEntryRow[]
  localOnly: true
}

export interface StorageItemView {
  id: string
  label: string
  bytes: number
  version?: string
}

export interface StorageCategoryView {
  id: StorageCategoryId
  label: string
  bytes: number
  items: StorageItemView[]
}

export interface StorageReport {
  categories: StorageCategoryView[]
  totalBytes: number
  freeBytes: number
  diskBytes: number
}

export interface StorageClearReq {
  category: StorageCategoryId
  itemId?: string
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
  /** Every sibling text of this reply, including the current one. Empty on older rows. */
  versions?: string[]
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

export type LicenceState = 'valid' | 'grace' | 'missing' | 'invalid' | 'expired' | 'subscription_ended' | 'device_mismatch' | 'clock_rollback' | 'dev'

export interface LicenceStatus {
  state: LicenceState
  message: string
  plan: string | null
  email: string | null
  refreshBy: string | null
  expiresAt: string | null
  subscriptionEndsAt: string | null
  termMonths: number | null
  subscriptionWarning: boolean
  features: string[]
  deviceIdHash: string | null
  buyUrl: string
  licenceId: string | null
}

export interface LicenceDevice {
  id: string
  name: string
  os: string
  current: boolean
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

/** One opened project. The index lives in the app private data folder, not in the project. */
export interface CodeProjectStatus {
  id: string
  root: string
  state: 'idle' | 'indexing' | 'ready' | 'error'
  files: number
  done: number
  symbols: number
  bytes: number
  embeddings: 'ready' | 'pending' | 'off'
  encrypted: boolean
  error: string | null
}

export interface CodeStorageUsage {
  totalBytes: number
  projects: { id: string; root: string; bytes: number }[]
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
    /** Stop the current download and keep the partial file so it can resume. */
    cancel(): Promise<void>
    /** Point chat at a .gguf already on this computer. Omit the path to open the file dialog. */
    importLocal(path?: string): Promise<{ id: string } | null>
    benchmark(modelId: string): Promise<BenchmarkResult>
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
  licence: {
    status(): Promise<LicenceStatus>
    activate(key?: string): Promise<LicenceStatus>
    deactivate(activationId?: string): Promise<LicenceStatus>
    devices(): Promise<LicenceDevice[]>
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
  usage: {
    get(): Promise<UsageReport>
    reset(): Promise<UsageReport>
    csv(): Promise<string>
  }
  storage: {
    report(): Promise<StorageReport>
    clear(req: StorageClearReq): Promise<StorageReport>
    open(category: StorageCategoryId): Promise<void>
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
  codeAgent: {
    root(): Promise<CodeAgentRoot>
    pick(): Promise<CodeAgentRoot>
    decide(req: CodeAgentDecideReq): Promise<{ ok: boolean }>
    revise(req: CodeAgentReviseReq): Promise<{ ok: boolean }>
    undo(req: CodeAgentUndoReq): Promise<{ ok: boolean }>
    mode(): Promise<CodeAgentModeState>
    setMode(req: CodeAgentSetModeReq): Promise<CodeAgentSetModeResult>
  }
  documents: {
    pick(title: string): Promise<string | null>
    convert(input: { path?: string; attachmentId?: string }, format: ExportFormat): Promise<DocumentResult | null>
    plan(input: { templatePath?: string; templateAttachmentId?: string; sourcePath?: string; sourceAttachmentId?: string }): Promise<FillPlan>
    export(input: { templatePath?: string; templateAttachmentId?: string; rows: FillRow[]; format: ExportFormat | 'same'; highlight: boolean }): Promise<DocumentResult | null>
    cancel(): Promise<void>
    onEvent(cb: (e: DocumentEvent) => void): () => void
  }
  code: {
    pick(): Promise<CodeProjectStatus | null>
    status(): Promise<CodeProjectStatus | null>
    storage(): Promise<CodeStorageUsage>
    onEvent(cb: (status: CodeProjectStatus) => void): () => void
  }
  codeComplete: {
    suggest(req: CodeCompleteReq): Promise<CodeCompleteResult>
    files(): Promise<CodeEditorFile[]>
    read(path: string): Promise<CodeEditorText>
    save(path: string, text: string): Promise<{ path: string }>
  }
  codeVision: {
    capture(req: CodeVisionCaptureReq): Promise<CodeVisionCaptureResult>
    save(req: CodeVisionSaveReq): Promise<CodeVisionSaveResult>
  }
  devWeb: {
    run(req: DevWebRunReq): Promise<DevWebRunResult>
  }
}
