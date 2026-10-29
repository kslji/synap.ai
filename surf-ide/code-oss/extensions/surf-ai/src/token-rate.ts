/**
 * Streaming throughput, as a pure calculation.
 *
 * The status bar shows a tokens-per-second read for the last turn. A real
 * tokenizer is not worth running on the client for a display estimate, so the
 * measure uses the well-known ~4 characters-per-token heuristic against the
 * number of content characters that actually streamed. Kept vscode-free so it is
 * unit-testable in plain node.
 */

/** Rough token estimate used for the throughput read: ~4 characters per token. */
export const CHARS_PER_TOKEN = 4;

/**
 * Tokens generated per second for a turn, from the number of content characters
 * streamed and how long the stream ran. Returns 0 for an empty or instantaneous
 * measure so the status item never reads `NaN t/s`.
 */
export function tokensPerSec(contentChars: number, elapsedMs: number): number {
  if (!(contentChars > 0) || !(elapsedMs > 0)) {
    return 0;
  }
  const tokens = contentChars / CHARS_PER_TOKEN;
  const seconds = elapsedMs / 1000;
  return Math.max(0, Math.round(tokens / seconds));
}
