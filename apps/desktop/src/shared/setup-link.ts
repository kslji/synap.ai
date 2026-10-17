import { FIRST_RUN_CHAT_MODEL_IDS, STARTER_CHAT_MODEL_ID } from './starter-model'

const ALIAS: Record<string, string> = {
  'qwen3.5-2b': 'qwen3.5-2b-q4_k_m',
  'qwen3.5-4b': 'qwen3.5-4b-q4_k_m',
  'qwen3.5-9b': 'qwen3.5-9b-q4_k_m',
  '2b': 'qwen3.5-2b-q4_k_m',
  '4b': 'qwen3.5-4b-q4_k_m',
  '9b': 'qwen3.5-9b-q4_k_m',
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

/** Model the setup screen downloads. A missing or unknown choice stays on Qwen 2B. */
export function resolveSetupModel(input: string | null | undefined): string {
  return parseSetupModel(input) ?? STARTER_CHAT_MODEL_ID
}
