/**
 * Shapes shared by the chat sidebar and both model clients.
 *
 * A turn is one message in the conversation; the clients stream a whole turn
 * array so the model sees the discussion, not just the last line. Options stay
 * optional so a caller that only knows about Stop buttons can pass a signal.
 */

export interface ChatTurn {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  /** Aborting the signal must kill the in-flight stream and the agent loop. */
  signal?: AbortSignal;
  /**
   * Surf's thinking policy: false (the default) for fast chat, inline edits and
   * Tab autocomplete; true only where the user asked the model to reason.
   */
  enableThinking?: boolean;
}

/** Progress callbacks a streaming caller uses to render tokens live. */
export interface StreamSinks {
  onContent?: (text: string) => void;
  onReasoning?: (text: string) => void;
}
