/**
 * SSE parsing shared by every Surf streaming backend.
 *
 * Both the local `llama-server` sidecar and the Surf gateway stream OpenAI
 * compatible `text/event-stream` bodies: `data:` frames carrying
 * `{choices:[{delta:{content,reasoning_content}}]}`, a terminal `data: [DONE]`
 * (gateway only), and — on the gateway — extra frames for billing and errors.
 * This module knows nothing about vscode or fetch so it can be unit-tested
 * against canned frame sequences.
 */

/** What one SSE frame contributed to the assistant turn. */
export interface StreamDelta {
  /** Prose tokens to render inline in the reply bubble. */
  content: string;
  /** Reasoning tokens; the UI renders them in a collapsible Thinking… block. */
  reasoning: string;
  /** Set when the backend streamed a terminal error frame instead of a reply. */
  error?: string;
}

const NO_DELTA: StreamDelta = { content: '', reasoning: '' };

/**
 * Parse one `data:` payload (the bytes after `data: `, without the frame
 * boundary). Unknown, billing, and usage frames yield an empty delta; error
 * frames yield their message so the caller can surface it rather than hang up
 * on a half-finished reply.
 */
export function parseStreamFrame(payload: string): StreamDelta {
  const trimmed = payload.trim();
  if (!trimmed || trimmed === '[DONE]') {
    return NO_DELTA;
  }
  let json: unknown;
  try {
    json = JSON.parse(trimmed);
  } catch {
    return NO_DELTA;
  }
  if (!json || typeof json !== 'object') {
    return NO_DELTA;
  }
  const frame = json as {
    choices?: Array<{ delta?: { content?: unknown; reasoning_content?: unknown } }>;
    error?: { message?: unknown };
  };
  if (frame.error) {
    const message = typeof frame.error.message === 'string' ? frame.error.message : 'The model stream failed.';
    return { ...NO_DELTA, error: message };
  }
  const delta = frame.choices?.[0]?.delta;
  if (!delta) {
    return NO_DELTA;
  }
  return {
    content: typeof delta.content === 'string' ? delta.content : '',
    reasoning: typeof delta.reasoning_content === 'string' ? delta.reasoning_content : ''
  };
}

interface BodyStream {
  getReader(): {
    read(): Promise<{ done: boolean; value?: Uint8Array }>;
    cancel(): Promise<void> | void;
    releaseLock(): void;
  };
}

/**
 * Turn a streaming response body into deltas. Text is buffered across reads so
 * a frame split over two network chunks is still parsed whole; the trailing
 * half frame is flushed at the end of the stream.
 */
export async function* streamDeltas(
  body: BodyStream,
  decode: (bytes: Uint8Array, final: boolean) => string
): AsyncGenerator<StreamDelta> {
  const reader = body.getReader();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value) {
        continue;
      }
      buffer += decode(value, false);
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const delta = frameDelta(frame);
        if (delta.content || delta.reasoning || delta.error) {
          yield delta;
        }
        if (delta.error) {
          return;
        }
        boundary = buffer.indexOf('\n\n');
      }
    }
    const tail = frameDelta(buffer);
    if (tail.content || tail.reasoning || tail.error) {
      yield tail;
    }
  } finally {
    // Release the lock without cancelling: the loop above already drained the
    // stream, and cancelling mid-read is how aborted turns used to hang.
    try { reader.releaseLock(); } catch { /* already released */ }
  }
}

/** Extract the `data:` lines of one frame and merge their deltas. */
export function frameDelta(frame: string): StreamDelta {
  let content = '';
  let reasoning = '';
  let error: string | undefined;
  for (const line of frame.split('\n')) {
    if (!line.startsWith('data:')) {
      continue;
    }
    const delta = parseStreamFrame(line.slice(5));
    content += delta.content;
    reasoning += delta.reasoning;
    if (delta.error) {
      error = delta.error;
    }
  }
  return error ? { content, reasoning, error } : { content, reasoning };
}
