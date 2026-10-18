/// <reference types="vite/client" />
import type { SurfApi } from '../../shared/ipc-contract'

type SurfView = 'onboarding' | 'setup' | 'home' | 'agents' | 'chats' | 'chat' | 'models' | 'settings' | 'library' | 'signin' | 'packs' | 'usage'

declare global {
  interface Window {
    surf: SurfApi
    __surfNav?: (view: SurfView) => void
    __surfTheme?: (theme: 'light' | 'dark') => void
    __surfShowCite?: (payload: { question: string; answer: string; citation: string; version: string; url: string; excerpt: string; heading: string }) => void
    __surfDemo?: (scene: 'upload' | 'processing' | 'citation' | 'library' | 'searching' | 'web' | 'refusal' | 'signin' | 'account' | 'packs' | 'packcite' | 'savedweb' | 'convert' | 'fill' | 'update' | 'home' | 'agent-general' | 'agent-code' | 'agent-assistant' | 'versions' | 'empty' | 'formatted' | 'continued' | 'sync-idle' | 'sync-syncing' | 'sync-synced' | 'sync-failed' | 'sync-offline' | 'setup-pick' | 'setup-progress' | 'setup-paused' | 'setup-offline' | 'setup-disk' | 'setup-checksum') => void
  }
}

export {}
