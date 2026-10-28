/**
 * Surf local (offline) model client.
 *
 * The Surf desktop app runs a local llama.cpp `llama-server` sidecar on a
 * random 127.0.0.1 port with a random API key, exposing an OpenAI-compatible
 * API. At IDE launch the desktop injects SURF_LOCAL_BRIDGE_FILE: a path to a
 * small JSON descriptor it keeps updated with the current sidecar endpoint.
 * This client reads that descriptor on demand and talks to the local model
 * directly. When no local model is running the descriptor is empty and the
 * offline dropdown simply reports that.
 *
 * Turns stream by default (`stream: true`): tokens arrive through
 * `sse.streamDeltas` so the chat renders them live, the caller's AbortSignal
 * kills the fetch immediately, and the thinking policy is passed to the sidecar
 * as `chat_template_kwargs.enable_thinking` — off for fast chat, edits and
 * Tab autocomplete; reasoning tokens still render when a model emits them.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import { streamDeltas } from './sse';
import type { ChatOptions, ChatTurn, StreamSinks } from './chat-types';

export interface LocalModel {
  id: string;
  label: string;
}

interface Bridge {
  baseUrl: string;
  apiKey: string;
  modelId?: string;
}

function bridgePath(): string {
  const fromEnv = process.env.SURF_LOCAL_BRIDGE_FILE;
  return (fromEnv && fromEnv.trim())
    || (vscode.workspace.getConfiguration('surf').get<string>('localBridgeFile') || '').trim();
}

/** Read the current bridge descriptor, or null when no local model is available. */
function readBridge(): Bridge | null {
  const p = bridgePath();
  if (!p) { return null; }
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as Partial<Bridge>;
    if (raw && typeof raw.baseUrl === 'string' && raw.baseUrl && typeof raw.apiKey === 'string' && raw.apiKey) {
      return { baseUrl: raw.baseUrl.replace(/\/+$/, ''), apiKey: raw.apiKey, modelId: raw.modelId };
    }
  } catch { /* file missing or not written yet */ }
  return null;
}

/** Thrown when the user hits Stop; callers must treat it as a cancel, not a failure. */
export class TurnCancelledError extends Error {
  constructor() {
    super('The turn was cancelled.');
    this.name = 'TurnCancelledError';
  }
}

function cancelled(signal?: AbortSignal): boolean {
  return signal?.aborted === true;
}

export class LocalModelClient {
  /** True when a local model is currently reachable. */
  available(): boolean {
    return readBridge() !== null;
  }

  /** The models the local sidecar is serving (empty when none is running). */
  async listModels(): Promise<LocalModel[]> {
    const b = readBridge();
    if (!b) { return []; }
    try {
      const res = await fetch(`${b.baseUrl}/v1/models`, {
        headers: { Authorization: `Bearer ${b.apiKey}` }
      });
      if (!res.ok) { return []; }
      const data = await res.json() as { data?: Array<{ id: string }> };
      return (data.data ?? []).map((m) => ({ id: m.id, label: m.id.split('/').pop() || m.id }));
    } catch {
      return [];
    }
  }

  /**
   * Stream a multi-turn conversation from the local sidecar, calling the sinks
   * as tokens arrive. Returns the full assistant text (thinking excluded).
   * Aborting the signal closes the stream and throws `TurnCancelledError`.
   */
  async chatStream(
    model: string,
    turns: ChatTurn[],
    sinks: StreamSinks = {},
    options: ChatOptions = {}
  ): Promise<string> {
    const b = readBridge();
    if (!b) {
      throw new Error('No local model is running. Load one in Surf, then reopen the chat.');
    }
    const enableThinking = options.enableThinking === true;
    const res = await fetch(`${b.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${b.apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: turns,
        stream: true,
        chat_template_kwargs: { enable_thinking: enableThinking }
      }),
      signal: options.signal
    });
    if (!res.ok) {
      throw new Error(`Local model error (${res.status}).`);
    }
    if (!res.body) {
      throw new Error('The local model returned no stream.');
    }
    const decoder = new TextDecoder();
    let text = '';
    try {
      for await (const delta of streamDeltas(res.body as never, (bytes, final) => decoder.decode(bytes, { stream: !final }))) {
        if (cancelled(options.signal)) { throw new TurnCancelledError(); }
        if (delta.error) { throw new Error(delta.error); }
        if (delta.reasoning) { sinks.onReasoning?.(delta.reasoning); }
        if (delta.content) {
          text += delta.content;
          sinks.onContent?.(delta.content);
        }
      }
    } catch (error) {
      if (cancelled(options.signal) || (error as Error)?.name === 'AbortError') {
        throw new TurnCancelledError();
      }
      throw error;
    }
    if (!text && cancelled(options.signal)) {
      throw new TurnCancelledError();
    }
    return text;
  }

  /**
   * Raw FIM completion for inline ghost text against /v1/completions. The stop
   * tokens and headroom are the caller's (see `fim.ts`); only the transport and
   * cancellation live here. Returns '' when the model produced nothing.
   */
  async complete(prompt: string, options: ChatOptions & { stop?: string[]; maxTokens?: number } = {}): Promise<string> {
    const b = readBridge();
    if (!b) {
      throw new Error('No local model is running.');
    }
    const res = await fetch(`${b.baseUrl}/v1/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${b.apiKey}`
      },
      body: JSON.stringify({
        model: b.modelId || 'local',
        prompt,
        max_tokens: options.maxTokens ?? 96,
        temperature: 0.2,
        stop: options.stop ?? [],
        stream: false,
        chat_template_kwargs: { enable_thinking: options.enableThinking === true }
      }),
      signal: options.signal
    });
    if (!res.ok) {
      throw new Error(`Local model error (${res.status}).`);
    }
    const data = await res.json() as { choices?: Array<{ text?: string; message?: { content?: string } }> };
    const choice = data.choices?.[0];
    return (choice?.text ?? choice?.message?.content ?? '').trim();
  }
}
