/// <reference types="vite/client" />
import type { SurfApi } from '../../shared/ipc-contract'

type SurfView = 'onboarding' | 'chat' | 'models' | 'settings' | 'library'

declare global {
  interface Window {
    surf: SurfApi
    __surfNav?: (view: SurfView) => void
    __surfDemo?: (scene: 'upload' | 'processing' | 'citation' | 'library') => void
  }
}

export {}
