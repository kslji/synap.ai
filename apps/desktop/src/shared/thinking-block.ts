/**
 * The chat's "Thinking…" block.
 *
 * Qwen3.5 is a thinking model: with thinking on, every token arrives as `reasoning_content` and
 * `content` stays empty until the reasoning ends. A reply that is only reasoning would look empty,
 * so the block streams that reasoning live. It is open while the reasoning is the only thing
 * arriving, folds away once the answer starts, and never closes under a person who opened it.
 *
 * The reasoning is scratch text: it is shown, never stored, so it cannot resurface in history.
 */

export interface ThinkingView {
  /** What the toggle says: the ellipsis means it is still arriving. */
  label: 'Thinking…' | 'Thinking'
  /** Whether the reasoning is on screen. */
  expanded: boolean
  /** The reasoning to show, trimmed. Never empty when a view exists. */
  text: string
  /** Reasoning is still streaming. */
  live: boolean
}

/**
 * @param thinking  the reasoning streamed so far
 * @param pending   the reply has not finished
 * @param answered  the answer text has started to arrive
 * @param choice    what the person last did with the toggle, null until they touch it
 */
export function thinkingView(
  thinking: string | undefined,
  pending: boolean,
  answered: boolean,
  choice: boolean | null,
): ThinkingView | null {
  const text = (thinking ?? '').trim()
  if (!text) return null
  const live = pending && !answered
  return {
    label: live ? 'Thinking…' : 'Thinking',
    expanded: choice ?? live,
    text,
    live,
  }
}
