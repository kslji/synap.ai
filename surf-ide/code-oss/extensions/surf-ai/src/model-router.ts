/**
 * Shared online/offline/auto routing for the Surf AI extension.
 *
 * Both the chat sidebar and inline completions ask this which backend to use:
 * the Surf gateway (cloud) or the local llama.cpp sidecar. Offline and Online
 * are explicit and always honoured — Offline makes zero network requests and
 * Online never second-guesses the user with a connectivity vote. Auto is the
 * third, opt-in mode: Dynamic Hybrid Routing that keeps routine, code-local
 * work on the device and sends genuinely complex reasoning to the cloud. Only
 * Auto ever probes reachability, and only when a local model is present to
 * fall back to. Keeping the decision here means chat and tab-completions never
 * disagree about where a request goes.
 */

import type { GatewayClient } from './gateway-client';
import type { LocalModelClient } from './local-model-client';

export type SurfMode = 'online' | 'offline' | 'auto';
export type Route = 'online' | 'offline';

/** Per-turn signals only the Auto route consults; explicit modes ignore them. */
export interface AutoRouteContext {
  /** The user's request, used to judge whether it needs deep reasoning. */
  task?: string;
  /** Override local availability; defaults to `local.available()`. */
  hasLocalModel?: boolean;
}

/** Workspace-state key where the sidebar stores the user's explicit mode. */
export const MODE_STATE_KEY = 'surf-ai.mode';

const REACH_TTL_MS = 5000;
const PROBE_TIMEOUT_MS = 1500;

/** Cached gateway-reachability probe, keyed by base URL so clients share one result. */
const reachCache = new Map<string, { value: boolean; at: number }>();

/** True when the Surf gateway answers within a short timeout. Cached ~5s per base URL. */
export async function onlineReachable(gateway: GatewayClient): Promise<boolean> {
  const key = gateway.baseUrl();
  const now = Date.now();
  const hit = reachCache.get(key);
  if (hit && now - hit.at < REACH_TTL_MS) {
    return hit.value;
  }
  const value = await gateway.reachable(PROBE_TIMEOUT_MS);
  reachCache.set(key, { value, at: now });
  return value;
}

/** Force a fresh connectivity read on the next resolve (e.g. after a mode change). */
export function invalidateReachability(gateway: GatewayClient): void {
  reachCache.delete(gateway.baseUrl());
}

/**
 * Cue words that mark a request as deep reasoning worth escalating to the
 * cloud in Auto mode. Deliberately conservative: a miss just runs locally.
 */
const COMPLEX_CUES =
  /\b(explain|why|design|architect(?:ure|ing)?|refactor|optimi[sz]e|debug|root cause|trace|plan\b|spec(?:ification)?|compare|evaluat\w*|analy[sz]\w*|performance|concurren\w*|race condition|deadlock|algorithm|complex|edge cases?)\b/i;

/**
 * Auto-mode heuristic: is this request complex enough to send to the cloud?
 * Long or multi-line asks, or ones carrying reasoning cues, escalate; short,
 * routine edits stay on the device. Pure and unit-testable.
 */
export function looksComplex(task: string): boolean {
  const t = (task ?? '').trim();
  if (!t) {
    return false;
  }
  if (COMPLEX_CUES.test(t)) {
    return true;
  }
  const newlines = (t.match(/\n/g) ?? []).length;
  return t.length > 280 || newlines >= 4;
}

/** Decide the effective route for the next request given the user's mode. */
export async function resolveRoute(
  mode: SurfMode,
  gateway: GatewayClient,
  local: LocalModelClient,
  ctx: AutoRouteContext = {}
): Promise<Route> {
  // Explicit choices are the route, probe-free: an offline turn must never ping
  // the network, and an online one is never overruled by a connectivity vote.
  if (mode === 'online') {
    void gateway;
    void local;
    return 'online';
  }
  if (mode === 'offline') {
    void gateway;
    void local;
    return 'offline';
  }
  // Auto — Dynamic Hybrid Routing. Stay local unless there is nothing local to
  // run, or the request reads as genuinely complex and the cloud is reachable.
  const hasLocal = ctx.hasLocalModel ?? local.available();
  if (!hasLocal) {
    return 'online';
  }
  if (!(await onlineReachable(gateway))) {
    return 'offline';
  }
  return looksComplex(ctx.task ?? '') ? 'online' : 'offline';
}
