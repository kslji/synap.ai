/** Chat model the first-run card downloads. Qwen3.5 2B Q4_K_M in models.registry.json. */
export const STARTER_CHAT_MODEL_ID = 'qwen3.5-2b-q4_k_m'

/** Q4_K_M chat rows offered on the first-run card, in the order the card shows them. */
export const FIRST_RUN_CHAT_MODEL_IDS = [
  'qwen3.5-2b-q4_k_m',
  'qwen3.5-4b-q4_k_m',
  'qwen3.5-9b-q4_k_m',
] as const

/** A GGUF the user already has, when its size does not match a registry row. */
export const LOCAL_CHAT_MODEL_ID = 'local-gguf'
