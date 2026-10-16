/**
 * Longest-edge caps for screenshot preprocessing.
 * Gemma limits are here so a later General-agent path can reuse them.
 * General chat does not call this module.
 */
export interface VisionLimits {
  maxEdge: number
  maxBytes: number
}

/** Qwen3.5 mmproj in llama.cpp. The long edge stays at or under 1024 and the aspect ratio is kept. */
export const QWEN35_VISION: VisionLimits = { maxEdge: 1024, maxBytes: 1_200_000 }

/** Reserved for a later Gemma general-agent integration. Not used by chat today. */
export const GEMMA4_VISION: VisionLimits = { maxEdge: 896, maxBytes: 1_200_000 }

export function limitsForFamily(family: string): VisionLimits {
  if (family === 'gemma4' || family === 'gemma-4') return GEMMA4_VISION
  return QWEN35_VISION
}
