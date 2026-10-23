/**
 * Item 6: the extension routes Online/Offline only — no Auto, and no silent
 * connectivity probe behind a user's explicit choice. Offline must make zero
 * network requests, so resolveRoute must never call gateway.reachable() in
 * either explicit mode; the cached probe (onlineReachable) stays available for
 * the Online-mode status dot only.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MODE_STATE_KEY, resolveRoute } from './model-router';
import type { GatewayClient } from './gateway-client';
import type { LocalModelClient } from './local-model-client';

function fakeGateway(): { client: GatewayClient; probes: number } {
  const state = { probes: 0 };
  const client = {
    baseUrl: () => 'https://gateway.example.test',
    reachable: async () => {
      state.probes += 1;
      return true;
    },
  } as unknown as GatewayClient;
  return { client, probes: state.probes };
}

function fakeLocal(available = true): LocalModelClient {
  return { available: () => available } as unknown as LocalModelClient;
}

test('explicit modes are honoured with zero connectivity probes', async () => {
  const g = fakeGateway();
  assert.equal(await resolveRoute('online', g.client, fakeLocal()), 'online');
  assert.equal(await resolveRoute('offline', g.client, fakeLocal()), 'offline');
  assert.equal(g.probes, 0, 'an explicit choice must never ping the gateway');
});

test('Offline never leaves the device, even when the gateway looks reachable', async () => {
  const g = fakeGateway();
  assert.equal(await resolveRoute('offline', g.client, fakeLocal(false)), 'offline');
});

test('there is no Auto route; anything unexpected falls back to Offline', async () => {
  const g = fakeGateway();
  assert.equal(await (resolveRoute as unknown as (m: string, gw: GatewayClient, l: LocalModelClient) => Promise<string>)('auto', g.client, fakeLocal()), 'offline');
  assert.equal(g.probes, 0, 'a legacy auto value must not start probing again');
});

test('the shared mode key is the workspace-state key the sidebar writes', () => {
  assert.equal(MODE_STATE_KEY, 'surf-ai.mode');
});
