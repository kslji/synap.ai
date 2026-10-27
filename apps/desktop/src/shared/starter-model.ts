/** The chat model every laptop, tier, and agent uses by default: Qwen3.5 2B Q4_K_M. Needs 8 GB RAM. */
export const STARTER_CHAT_MODEL_ID = 'qwen3.5-2b-q4_k_m'

/** The optional "More accurate" download. Larger, slower, and never downloaded unless asked for. */
export const OPTIONAL_CHAT_MODEL_ID = 'qwen3.5-4b-q4_k_m'

/** Chat rows the first-run card offers. One default; the 4B is a Settings choice, not a first-run one. */
export const FIRST_RUN_CHAT_MODEL_IDS = [STARTER_CHAT_MODEL_ID] as const

/** A GGUF the user already has, when its size does not match a registry row. */
export const LOCAL_CHAT_MODEL_ID = 'local-gguf'
