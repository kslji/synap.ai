/**
 * Routing tests: explicit Online/Offline are honoured with zero connectivity
 * probes (Offline must never touch the network), while Auto is the opt-in
 * hybrid mode that may probe reachability and escalate genuinely complex
 * reasoning to the cloud. The pure looksComplex heuristic is covered directly.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MODE_STATE_KEY, resolveRoute, looksComplex } from './model-router';
import type { GatewayClient } from './gateway-client';
import type { LocalModelClient } from './local-model-client';

// onlineReachable caches per base URL for ~5s, so each fake gateway gets its own
// URL to keep the tests independent of one another's cached probe results.
let gwSeq = 0;
function fakeGateway(reachable = true): { client: GatewayClient; probes: () => number } {
  let probes = 0;
  const url = 'https://gateway-' + (++gwSeq) + '.example.test';
  const client = {
    baseUrl: () => url,
    reachable: async () => {
      probes += 1;
      return reachable;
    },
  } as unknown as GatewayClient;
  return { client, probes: () => probes };
}

function fakeLocal(available = true): LocalModelClient {
  return { available: () => available } as unknown as LocalModelClient;
}

test('explicit modes are honoured with zero connectivity probes', async () => {
  const g = fakeGateway();
  assert.equal(await resolveRoute('online', g.client, fakeLocal()), 'online');
  assert.equal(await resolveRoute('offline', g.client, fakeLocal()), 'offline');
  assert.equal(g.probes(), 0, 'an explicit choice must never ping the gateway');
});

test('Offline never leaves the device, even when the gateway looks reachable', async () => {
  const g = fakeGateway(true);
  assert.equal(await resolveRoute('offline', g.client, fakeLocal(false)), 'offline');
  assert.equal(g.probes(), 0);
});

test('Auto with no local model goes straight to the cloud, without probing', async () => {
  const g = fakeGateway(true);
  assert.equal(
    await resolveRoute('auto', g.client, fakeLocal(false), { hasLocalModel: false, task: 'rename x' }),
    'online',
  );
  assert.equal(g.probes(), 0, 'nothing to fall back to, so no reachability vote is needed');
});

test('Auto keeps routine work local when the cloud is unreachable', async () => {
  const g = fakeGateway(false);
  assert.equal(
    await resolveRoute('auto', g.client, fakeLocal(true), { hasLocalModel: true, task: 'explain the architecture' }),
    'offline',
  );
  assert.equal(g.probes(), 1, 'Auto probes reachability once a local model exists');
});

test('Auto keeps a simple task local and escalates a complex one to the cloud', async () => {
  const g = fakeGateway(true);
  assert.equal(
    await resolveRoute('auto', g.client, fakeLocal(true), { hasLocalModel: true, task: 'add a semicolon here' }),
    'offline',
  );
  assert.equal(
    await resolveRoute('auto', g.client, fakeLocal(true), { hasLocalModel: true, task: 'explain why this deadlocks and design a fix' }),
    'online',
  );
});

test('Auto falls back to local.available() when hasLocalModel is not given', async () => {
  const g = fakeGateway(true);
  assert.equal(await resolveRoute('auto', g.client, fakeLocal(true), { task: 'hi' }), 'offline');
  assert.equal(await resolveRoute('auto', g.client, fakeLocal(false), { task: 'hi' }), 'online');
});

test('looksComplex flags reasoning cues, long and multi-line asks only', () => {
  assert.equal(looksComplex(''), false);
  assert.equal(looksComplex('rename x to y'), false);
  assert.equal(looksComplex('explain this function'), true);
  assert.equal(looksComplex('refactor the auth module'), true);
  assert.equal(looksComplex('debug this race condition'), true);
  assert.equal(looksComplex('a'.repeat(300)), true, 'a very long request is treated as deep');
  assert.equal(looksComplex('l1\nl2\nl3\nl4\nl5'), true, 'many lines is treated as deep');
});

test('the shared mode key is the workspace-state key the sidebar writes', () => {
  assert.equal(MODE_STATE_KEY, 'surf-ai.mode');
});
