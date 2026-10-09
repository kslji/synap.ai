/// <reference types="vite/client" />
import type { SurfApi } from '../../shared/ipc-contract'

type SurfView = 'onboarding' | 'chat' | 'models' | 'settings'

declare global {
  interface Window {
    surf: SurfApi
    __surfNav?: (view: SurfView) => void
  }
}

export {}
