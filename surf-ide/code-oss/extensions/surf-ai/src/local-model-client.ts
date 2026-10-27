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
 */

import * as vscode from 'vscode';
import * as fs from 'fs';

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

  /** Send a single constructed prompt to the local model and return the assistant text. */
  async chat(model: string, prompt: string): Promise<string> {
    const b = readBridge();
    if (!b) {
      throw new Error('No local model is running. Load one in Surf, then reopen the chat.');
    }
    const res = await fetch(`${b.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${b.apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        stream: false
      })
    });
    if (!res.ok) {
      throw new Error(`Local model error (${res.status}).`);
    }
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('The local model returned an empty response.');
    }
    return content;
  }

  /**
   * Raw text completion for inline ghost text, via the sidecar's
   * OpenAI-compatible /v1/completions endpoint. Returns trimmed text (possibly
   * empty). Throws only when no local model is running.
   */
  async complete(prompt: string): Promise<string> {
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
        max_tokens: 100,
        temperature: 0.2,
        stream: false
      })
    });
    if (!res.ok) {
      throw new Error(`Local model error (${res.status}).`);
    }
    const data = await res.json() as { choices?: Array<{ text?: string; message?: { content?: string } }> };
    const choice = data.choices?.[0];
    return (choice?.text ?? choice?.message?.content ?? '').trim();
  }
}
