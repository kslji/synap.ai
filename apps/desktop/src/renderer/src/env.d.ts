/// <reference types="vite/client" />
import type { SurfApi } from '../../shared/ipc-contract'

type SurfView = 'onboarding' | 'home' | 'chat' | 'code' | 'assistant' | 'models' | 'settings' | 'library' | 'signin' | 'packs'

declare global {
  interface Window {
    surf: SurfApi
    __surfNav?: (view: SurfView) => void
    __surfDemo?: (scene: 'upload' | 'processing' | 'citation' | 'library' | 'searching' | 'web' | 'refusal' | 'signin' | 'account' | 'packs' | 'packcite' | 'savedweb' | 'convert' | 'fill' | 'agents' | 'code' | 'architecture' | 'connectors' | 'approval' | 'delete') => void
  }
}

export {}
