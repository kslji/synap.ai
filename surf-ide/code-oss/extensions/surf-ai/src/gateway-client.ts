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
  /** Purchase tier that unlocks this model (ADR 0008): 0 trial, 5 daily, 25 frontier. */
  min_credits: number;
  tier_label: string;
  /** True when the signed-in account has not bought `min_credits`. */
  locked: boolean;
  /** USD cost of the top-up that unlocks it, so the badge can state the price. */
  unlock_usd: number;
}

export interface GatewayBalance {
  balance: number;
  /** Whole credits left in the wallet (balance / $0.40, floored). */
  credits: number;
  /** The monotonic purchase tier, which decides which models are selectable. */
  max_topup_credits: number;
  billing_locked: boolean;
}

/**
 * The gateway's 403: the model is allowed and affordable, but the account has not
 * bought the tier. Carried as a type so the chat can offer the unlock instead of
 * showing a generic failure, and so the picker never treats it as a dead model.
 */
export class ModelLockedError extends Error {
  constructor(
    readonly modelId: string,
    readonly requiredCredits: number,
    readonly unlockUsd: number
  ) {
    super(`That model needs a $${unlockUsd.toFixed(0)} top-up (${requiredCredits} credits).`);
    this.name = 'ModelLockedError';
  }
}

/** Older gateways send no tier fields; a missing tier always means "selectable". */
function withTiers(model: GatewayModel): GatewayModel {
  return {
    ...model,
    min_credits: Number(model.min_credits) || 0,
    tier_label: model.tier_label || '',
    locked: model.locked === true,
    unlock_usd: Number(model.unlock_usd) || 0
  };
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
   * Quick connectivity + auth check for the Online status indicator. Returns
   * false (never throws) when there is no token, the gateway is unreachable,
   * or it answers non-OK. Routing is the user's explicit choice (Offline or
   * Online); there is no Auto mode that consults this.
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

  /** The curated allowlist of models available in the IDE, with live pricing and tiers. */
  async listModels(): Promise<GatewayModel[]> {
    const res = await fetch(`${this.baseUrl()}/api/v1/models`, {
      headers: { Authorization: `Bearer ${await this.token()}` }
    });
    if (!res.ok) {
      throw new Error(`Could not load models (${res.status}).`);
    }
    const data = await res.json() as { models?: GatewayModel[] };
    return (data.models ?? []).map(withTiers);
  }

  /**
   * Wallet in USD and credits, plus the purchase tier. Returns null when signed out
   * or unreachable - the pill then reads as unknown rather than zero, so a network
   * blip never tells a paying user they are out of credits.
   */
  async balance(timeoutMs = 4000): Promise<GatewayBalance | null> {
    const token = await this.context.secrets.get('surf-ai.authToken');
    if (!token) {
      return null;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl()}/api/v1/balance`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal
      });
      if (!res.ok) {
        return null;
      }
      const data = await res.json() as GatewayBalance;
      return {
        balance: Number(data.balance) || 0,
        credits: Number(data.credits) || 0,
        max_topup_credits: Number(data.max_topup_credits) || 0,
        billing_locked: data.billing_locked === true
      };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Where a top-up is bought. Configurable so a deployment can point at its own page. */
  topUpUrl(): string {
    const fromEnv = process.env.SURF_TOPUP_URL;
    return (fromEnv && fromEnv.trim())
      || vscode.workspace.getConfiguration('surf').get<string>('topUpUrl')
      || 'https://synap.surf/account';
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
    if (res.status === 403) {
      // The tier gate, not a debt lock: tell the user what unlocks it and for how much.
      const body = await res.json().catch(() => ({})) as { error?: string; model_id?: string; required_credits?: number; unlock_usd?: number };
      if (body.error === 'model_locked') {
        throw new ModelLockedError(body.model_id || model, Number(body.required_credits) || 0, Number(body.unlock_usd) || 0);
      }
      throw new Error('That model is not available to this account.');
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
