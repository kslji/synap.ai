/** zod schemas for IPC payloads (main process only). The _check functions below fail to compile if they drift from ipc-contract.ts. */
import { z } from 'zod';
import type { ChatSendReq as ChatSendReqT, SettingsPatch as SettingsPatchT } from './ipc-contract.js';

export const ChatSendReq = z.object({
  conversationId: z.string().uuid().nullable(),
  text: z.string().min(1).max(20_000),
  agentId: z.string().max(64).default('general'),
  // images are passed as small PNG/JPEG data (the renderer never gets file-system paths)
  images: z.array(z.object({ mime: z.enum(['image/png', 'image/jpeg']), base64: z.string().max(14_000_000) })).max(4).default([]),
  allowWeb: z.boolean().default(false),
});

export const SettingsPatch = z.object({
  offlineOnly: z.boolean().optional(),
  webSearchAllowed: z.boolean().optional(),
  telemetryOptIn: z.boolean().optional(),
  chatModelId: z.string().max(64).optional(),
}).strict();

// compile-time checks that schema output matches the shared interfaces
export const _chatCheck = (x: z.output<typeof ChatSendReq>): ChatSendReqT => x;
export const _settingsCheck = (x: z.output<typeof SettingsPatch>): SettingsPatchT => x;
