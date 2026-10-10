/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly SITE_CONTACT_EMAIL?: string
  readonly SITE_FORM_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
