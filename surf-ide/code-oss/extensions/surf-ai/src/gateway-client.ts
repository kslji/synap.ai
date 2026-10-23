/**
 * Surf gateway client.
 *
 * Talks to the multi-tenant Surf gateway (the OpenRouter proxy with per-user
 * micro-billing). The base URL comes from the environment the desktop app
 * injects (SURF_GATEWAY_BASE_URL) or the `surf.gatewayBaseUrl` setting; the
 * bearer token is the gateway JWT the desktop app stored in secrets.
 */

import * as vscode from 'vscode';

export interface GatewayModel {
  id: string;
  label: string;
  provider: string;
  context_window: number;
  input_price_per_million: number;
  output_price_per_million: number;
}

export class GatewayClient {
  constructor(private readonly context: vscode.ExtensionContext) {}

  baseUrl(): string {
    const fromEnv = process.env.SURF_GATEWAY_BASE_URL;
    const raw = (fromEnv && fromEnv.trim())
      || vscode.workspace.getConfiguration('surf').get<string>('gatewayBaseUrl')
      || 'https://api.synap.surf';
    return raw.replace(/\/+$/, '');
  }

  /**
   * Quick connectivity + auth check for Auto routing. Returns false (never
   * throws) when there is no token, the gateway is unreachable, or it answers
   * non-OK, so callers can treat a false result as "fall back to local".
   */
  async reachable(timeoutMs = 1500): Promise<boolean> {
    const token = await this.context.secrets.get('surf-ai.authToken');
    if (!token) {
      return false;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl()}/api/v1/models`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  private async token(): Promise<string> {
    const token = await this.context.secrets.get('surf-ai.authToken');
    if (!token) {
      throw new Error('Not signed in to Surf. Launch the IDE from the Surf app.');
    }
    return token;
  }

  /** The curated allowlist of models available in the IDE, with live pricing. */
  async listModels(): Promise<GatewayModel[]> {
    const res = await fetch(`${this.baseUrl()}/api/v1/models`, {
      headers: { Authorization: `Bearer ${await this.token()}` }
    });
    if (!res.ok) {
      throw new Error(`Could not load models (${res.status}).`);
    }
    const data = await res.json() as { models?: GatewayModel[] };
    return data.models ?? [];
  }

  /** Send a single constructed prompt and return the assistant text. */
  async chat(model: string, prompt: string): Promise<string> {
    const res = await fetch(`${this.baseUrl()}/api/v1/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${await this.token()}`
      },
      body: JSON.stringify({ model, prompt, stream: false })
    });

    if (res.status === 402) {
      throw new Error('Insufficient Surf balance. Top up to keep using cloud models.');
    }
    if (res.status === 400) {
      const body = await res.json().catch(() => ({})) as { detail?: string };
      throw new Error(body.detail || 'The Surf gateway rejected the request.');
    }
    if (!res.ok) {
      throw new Error(`Gateway error (${res.status}).`);
    }

    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('The model returned an empty response.');
    }
    return content;
  }
}
