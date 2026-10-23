import { FIRST_RUN_CHAT_MODEL_IDS, OPTIONAL_CHAT_MODEL_ID, STARTER_CHAT_MODEL_ID } from './starter-model'

/**
 * Old links named a size. A 2B link opens the 2B, a 4B link opens the optional 4B, and a 9B link
 * (a model we no longer ship) opens the 2B.
 */
const ALIAS: Record<string, string> = {
  'qwen3.5-2b': STARTER_CHAT_MODEL_ID,
  'qwen3.5-4b': OPTIONAL_CHAT_MODEL_ID,
  'qwen3.5-9b': STARTER_CHAT_MODEL_ID,
  'qwen3.5-2b-q4_k_m': STARTER_CHAT_MODEL_ID,
  'qwen3.5-4b-q4_k_m': OPTIONAL_CHAT_MODEL_ID,
  'qwen3.5-9b-q4_k_m': STARTER_CHAT_MODEL_ID,
  '2b': STARTER_CHAT_MODEL_ID,
  '4b': OPTIONAL_CHAT_MODEL_ID,
  '9b': STARTER_CHAT_MODEL_ID,
}

export interface SetupLink {
  modelId: string | null
  filePath: string | null
}

/** Registry id from a synap://setup link, a short alias, or a full id. Unknown values are ignored. */
export function parseSetupModel(input: string | null | undefined): string | null {
  if (!input) return null
  let value = input.trim()
  if (!value) return null
  if (value.toLowerCase().startsWith('synap:')) {
    let url: URL
    try { url = new URL(value) } catch { return null }
    const host = url.hostname.toLowerCase()
    if (host !== 'setup') return null
    value = url.searchParams.get('model') ?? ''
  }
  const key = value.trim().toLowerCase()
  if ((FIRST_RUN_CHAT_MODEL_IDS as readonly string[]).includes(key)) return key
  return ALIAS[key] ?? null
}

/** Model id plus an optional absolute file path from synap://setup?model=&file=. */
export function parseSetupLink(input: string | null | undefined): SetupLink {
  if (!input?.trim()) return { modelId: null, filePath: null }
  const value = input.trim()
  if (!value.toLowerCase().startsWith('synap:')) return { modelId: parseSetupModel(value), filePath: null }
  let url: URL
  try { url = new URL(value) } catch { return { modelId: null, filePath: null } }
  if (url.hostname.toLowerCase() !== 'setup') return { modelId: null, filePath: null }
  return {
    modelId: parseSetupModel(url.searchParams.get('model')),
    filePath: filePathFromQuery(url.searchParams.get('file')),
  }
}

function filePathFromQuery(raw: string | null): string | null {
  if (!raw?.trim()) return null
  const value = raw.trim()
  if (value.toLowerCase().startsWith('file:')) {
    try {
      const url = new URL(value)
      let path = decodeURIComponent(url.pathname)
      if (/^\/[A-Za-z]:\//.test(path)) path = path.slice(1)
      return absolutePath(path)
    } catch {
      return null
    }
  }
  return absolutePath(value)
}

function absolutePath(value: string): string | null {
  if (value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value)) return value
  return null
}

/** Known model id, or the generic model when a link omitted one. The first open downloads that file. */
export function resolveSetupModel(input: string | null | undefined): string {
  return parseSetupModel(input) ?? STARTER_CHAT_MODEL_ID
}
