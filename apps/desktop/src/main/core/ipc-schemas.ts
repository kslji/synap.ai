/** zod schemas for IPC payloads (main process only). The _check functions fail to compile if they drift from ipc-contract.ts. */
import { z } from 'zod'
import type { ChatSendReq as ChatSendReqT, CodeAgentDecideReq as CodeAgentDecideReqT, CodeAgentReviseReq as CodeAgentReviseReqT, CodeAgentSetModeReq as CodeAgentSetModeReqT, CodeAgentUndoReq as CodeAgentUndoReqT, CodeCompleteReq as CodeCompleteReqT, DevWebRunReq as DevWebRunReqT, SettingsPatch as SettingsPatchT } from './ipc-contract.js'

export const ChatSendReq = z.object({
  conversationId: z.string().uuid().nullable(),
  text: z.string().min(1).max(20_000),
  agentId: z.string().max(64).default('general'),
  images: z.array(z.object({ mime: z.enum(['image/png', 'image/jpeg']), base64: z.string().max(14_000_000) })).max(4).default([]),
  allowWeb: z.boolean().default(false),
  docScope: z.enum(['chat', 'all']).default('chat'),
})

export const SettingsPatch = z.object({
  offlineOnly: z.boolean().optional(),
  webSearchAllowed: z.boolean().optional(),
  telemetryOptIn: z.boolean().optional(),
  chatModelId: z.string().max(80).optional(),
  codeModelId: z.string().max(80).optional(),
  onboardingComplete: z.boolean().optional(),
  theme: z.union([z.enum(['light', 'dark']), z.literal('system').transform(() => 'light' as const)]).optional(),
  apiBaseUrl: z.string().max(200).regex(/^https?:\/\/\S+$/).optional(),
  packSyncHours: z.number().int().min(1).max(168).optional(),
  updateChannel: z.enum(['stable', 'beta']).optional(),
  codeAgentMode: z.enum(['ask', 'auto']).optional(),
  codeAgentAllowlist: z.array(z.string().trim().min(1).max(200)).max(40).optional(),
  codeAgentAutoConfirmed: z.boolean().optional(),
  tabSuggestions: z.boolean().optional(),
  tabSuggestionsOff: z.array(z.string().trim().min(1).max(32).regex(/^[a-z0-9_+-]+$/i)).max(40).optional(),
}).strict()

const Email = z.string().trim().max(200).regex(/^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/)
export const EmailBody = z.object({ email: Email })
export const OtpVerifyBody = z.object({
  email: Email,
  code: z.string().regex(/^\d{6}$/),
})
export const DeviceId = z.string().uuid()
export const LicenceActivateBody = z.object({
  key: z.string().trim().min(8).max(80).optional(),
}).strict()
export const LicenceActivationId = z.string().uuid().nullable()
export const PackId = z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/)

export const HttpLink = z.string().max(2000).regex(/^https?:\/\/\S+$/)

export const DevWebRun = z.object({
  tool: z.enum(['web_search', 'fetch_page']),
  query: z.string().max(300).optional(),
  url: z.string().max(2000).optional(),
}).strict()

export const ModelId = z.string().min(1).max(80)
export const ConversationId = z.string().uuid()
export const JobId = z.string().uuid()
export const AttachmentId = z.string().uuid()
export const LibraryPick = z.object({
  conversationId: z.string().uuid().nullable(),
  createConversation: z.boolean().default(false),
})
export const LibraryAdd = z.object({
  paths: z.array(z.string().min(1).max(4096)).min(1).max(20),
  conversationId: z.string().uuid().nullable(),
  createConversation: z.boolean().default(false),
})
export const ExportFormatName = z.enum(['txt', 'md', 'html', 'docx', 'png', 'jpeg', 'csv', 'xlsx', 'pdf'])
export const DocumentConvert = z.object({
  path: z.string().min(1).max(4096).optional(),
  attachmentId: AttachmentId.optional(),
  format: ExportFormatName,
})
export const DocumentPlan = z.object({
  templatePath: z.string().min(1).max(4096).optional(),
  templateAttachmentId: AttachmentId.optional(),
  sourcePath: z.string().min(1).max(4096).optional(),
  sourceAttachmentId: AttachmentId.optional(),
})
export const FillRowBody = z.object({
  id: z.string().max(80),
  label: z.string().max(200),
  value: z.string().max(4000),
  citation: z.string().max(200).nullable(),
  confidence: z.enum(['high', 'none']),
  found: z.boolean(),
  locator: z.string().max(80),
})
export const DocumentExport = z.object({
  templatePath: z.string().min(1).max(4096).optional(),
  templateAttachmentId: AttachmentId.optional(),
  rows: z.array(FillRowBody).max(200),
  format: z.union([ExportFormatName, z.literal('same')]),
  highlight: z.boolean(),
})
export const LibraryPreview = z.object({
  chunkId: z.number().int().positive().optional(),
  attachmentId: z.string().uuid().optional(),
}).strict()
export const CodeAgentDecideReq = z.object({
  messageId: z.string().uuid(),
  id: z.string().min(1).max(320),
  allow: z.boolean(),
  remember: z.boolean().optional(),
  all: z.boolean().optional(),
}).strict()
export const CodeAgentReviseReq = z.object({
  messageId: z.string().uuid(),
  order: z.array(z.string().min(1).max(80)).max(40),
  edits: z.array(z.object({
    id: z.string().min(1).max(80),
    goal: z.string().min(1).max(400),
  })).max(40).optional(),
}).strict()
export const CodeAgentUndoReq = z.object({
  messageId: z.string().uuid(),
  stepId: z.string().min(1).max(80),
  all: z.boolean().optional(),
}).strict()
export const CodeAgentSetModeReq = z.object({
  mode: z.enum(['ask', 'auto']),
  confirmAuto: z.boolean().optional(),
}).strict()
export const CodeCompleteReq = z.object({
  sessionId: z.string().min(1).max(80),
  path: z.string().max(4096),
  language: z.string().max(32),
  text: z.string().max(600_000),
  cursor: z.number().int().min(0).max(600_000),
}).strict()
export const CodeFilePath = z.object({
  path: z.string().min(1).max(4096),
}).strict()
export const CodeFileSave = z.object({
  path: z.string().min(1).max(4096),
  text: z.string().max(600_000),
}).strict()

export type ParsedChat = z.output<typeof ChatSendReq>

export const _chatCheck = (x: z.output<typeof ChatSendReq>): ChatSendReqT => x
export const _settingsCheck = (x: z.output<typeof SettingsPatch>): SettingsPatchT => x
export const _codeDecideCheck = (x: z.output<typeof CodeAgentDecideReq>): CodeAgentDecideReqT => x
export const _codeReviseCheck = (x: z.output<typeof CodeAgentReviseReq>): CodeAgentReviseReqT => x
export const _codeUndoCheck = (x: z.output<typeof CodeAgentUndoReq>): CodeAgentUndoReqT => x
export const _codeModeCheck = (x: z.output<typeof CodeAgentSetModeReq>): CodeAgentSetModeReqT => x
export const _devWebCheck = (x: z.output<typeof DevWebRun>): DevWebRunReqT => x
export const _codeCompleteCheck = (x: z.output<typeof CodeCompleteReq>): CodeCompleteReqT => x
