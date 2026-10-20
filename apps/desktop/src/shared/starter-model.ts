/** The one chat model every laptop and every agent uses. Qwen3.5 4B Q4_K_M in models.registry.json. Needs 8 GB RAM. */
export const STARTER_CHAT_MODEL_ID = 'qwen3.5-4b-q4_k_m'

/** Chat rows the first-run card downloads. There is a single generic model, no size picker. */
export const FIRST_RUN_CHAT_MODEL_IDS = [STARTER_CHAT_MODEL_ID] as const

/** A GGUF the user already has, when its size does not match a registry row. */
export const LOCAL_CHAT_MODEL_ID = 'local-gguf'
