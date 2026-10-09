/**
 * The ONLY bridge between the UI (renderer) and the privileged main process.
 * Shared by main, preload and renderer. Deliberately has NO runtime dependencies so the sandboxed
 * preload can bundle it. Runtime validation lives in ipc-schemas.ts (main only, zod) - the renderer is
 * treated as untrusted because it displays model output and web content.
 */
export const IPC = {
  chatSend: 'chat:send',
  chatCancel: 'chat:cancel',
  chatEvent: 'chat:event', //          main -> renderer stream (tokens, sources, tool calls, done)
  modelsStatus: 'models:status',
  modelsDownload: 'models:download',
  modelsEvent: 'models:event', //      main -> renderer download progress
  packsList: 'packs:list',
  packsImportFile: 'packs:import-file', // USB sideload; main opens the file dialog itself
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  updatesCheck: 'updates:check',
  updatesInstallOffline: 'updates:install-offline',
} as const;

export interface ChatSendReq {
  conversationId: string | null;
  text: string;
  agentId?: string;
  images?: { mime: 'image/png' | 'image/jpeg'; base64: string }[];
  allowWeb?: boolean;
}
export interface SettingsPatch {
  offlineOnly?: boolean;
  webSearchAllowed?: boolean;
  telemetryOptIn?: boolean;
  chatModelId?: string;
}

export type ChatEvent =
  | { type: 'token'; messageId: string; text: string }
  | { type: 'sources'; messageId: string; sources: { title: string; url: string; pack: string }[] }
  | { type: 'tool'; messageId: string; name: string; input: string; output: string }
  | { type: 'done'; messageId: string; gate: 'answer' | 'borderline' | 'insufficient' | 'web' }
  | { type: 'error'; messageId: string; message: string };

export interface ModelStatus {
  tier: 0 | 1 | 2 | 3;
  chatModelId: string;
  installed: string[];
  downloading: { id: string; done: number; total: number } | null;
  sidecars: Record<'chat' | 'embed' | 'whisper', 'stopped' | 'starting' | 'ready' | 'crashed'>;
}

/** What window.harbor looks like in the renderer. */
export interface HarborApi {
  chat: {
    send(req: ChatSendReq): Promise<{ conversationId: string; messageId: string }>;
    cancel(messageId: string): Promise<void>;
    onEvent(cb: (e: ChatEvent) => void): () => void;
  };
  models: {
    status(): Promise<ModelStatus>;
    download(modelId: string): Promise<void>;
    onEvent(cb: (e: { id: string; done: number; total: number; state: string }) => void): () => void;
  };
  packs: { list(): Promise<{ id: string; version: string; niche: string }[]>; importFromFile(): Promise<string | null> };
  settings: { get(): Promise<Required<SettingsPatch>>; set(p: SettingsPatch): Promise<void> };
  updates: { check(): Promise<string | null>; installOffline(): Promise<boolean> };
}
