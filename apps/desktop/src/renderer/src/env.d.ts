/// <reference types="vite/client" />
import type { SurfApi } from '../../shared/ipc-contract'

type SurfView = 'onboarding' | 'home' | 'agents' | 'chats' | 'chat' | 'models' | 'settings' | 'library' | 'signin' | 'packs' | 'usage'

declare global {
  interface Window {
    surf: SurfApi
    __surfNav?: (view: SurfView) => void
    __surfDemo?: (scene: 'upload' | 'processing' | 'citation' | 'library' | 'searching' | 'web' | 'refusal' | 'signin' | 'account' | 'packs' | 'packcite' | 'savedweb' | 'convert' | 'fill' | 'update' | 'home' | 'agent-general' | 'agent-code' | 'agent-assistant' | 'versions' | 'empty' | 'formatted' | 'continued') => void
  }
}

export {}
