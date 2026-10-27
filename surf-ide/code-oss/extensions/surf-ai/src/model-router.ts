/**
 * Shared online/offline routing for the Surf AI extension.
 *
 * Both the chat sidebar and inline completions ask this which backend to use:
 * the Surf gateway (cloud) or the local llama.cpp sidecar. The user's choice is
 * explicit and always honoured: Offline makes zero network requests and Online
 * never second-guesses the user with a connectivity vote. (The old Auto mode
 * was removed.) Keeping the decision here means chat and tab-completions never
 * disagree about where a request goes.
 */

import type { GatewayClient } from './gateway-client';
import type { LocalModelClient } from './local-model-client';

export type SurfMode = 'online' | 'offline';
export type Route = 'online' | 'offline';

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

/** Decide the effective route for the next request given the user's mode. */
export async function resolveRoute(
  mode: SurfMode,
  gateway: GatewayClient,
  local: LocalModelClient
): Promise<Route> {
  // Pure and probe-free: an explicit choice is the route. The parameters stay
  // part of the contract so every caller keeps one call site for both modes.
  void gateway;
  void local;
  return mode === 'online' ? 'online' : 'offline';
}
