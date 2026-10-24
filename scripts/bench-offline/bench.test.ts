import assert from 'node:assert/strict';
import { test } from 'node:test';

import { decodeSpeed, firstTokenMs, percentile } from './timing.js';
import { pickChatModel, type ChatRow } from './pick.js';

/** The two chat rows as the registry ships them, plus the search model that is not a chat row. */
const registry: ChatRow[] = [
  { id: 'qwen3.5-2b-q4_k_m', file: 'Qwen3.5-2B-Q4_K_M.gguf', size_bytes: 1_280_835_840, min_ram_gb: 8, tiers: [0, 1, 2, 3], context_default: 8192, default_for: ['*'] },
  { id: 'qwen3.5-4b-q4_k_m', file: 'Qwen3.5-4B-Q4_K_M.gguf', size_bytes: 3_050_793_408, min_ram_gb: 8, tiers: [0, 1, 2, 3], context_default: 8192 },
  { id: 'jina-embeddings-v2-base-code-q5_k_m', file: 'jina-embeddings-v2-base-code-Q5_K_M.gguf', size_bytes: 121_387_072, min_ram_gb: 2, tiers: [0, 1, 2, 3] },
];

test('a plain bench measures the 2B the app ships, not the largest file that fits', () => {
  assert.equal(pickChatModel(registry, {}, 32, 0)?.id, 'qwen3.5-2b-q4_k_m', '32 GB of RAM does not move the default');
  assert.equal(pickChatModel(registry, {}, 8, 0)?.id, 'qwen3.5-2b-q4_k_m');
  assert.equal(pickChatModel(registry, { model: 'qwen3.5-4b-q4_k_m' }, 32, 0)?.id, 'qwen3.5-4b-q4_k_m', '--model still wins');
  assert.equal(pickChatModel(registry, { model: 'not-a-model' }, 32, 0), undefined);
});

test('the search model is never benched as a chat model', () => {
  const ids = registry.map((row) => pickChatModel([row], {}, 32, 0)?.id ?? null);
  assert.deepEqual(ids, ['qwen3.5-2b-q4_k_m', 'qwen3.5-4b-q4_k_m', null]);
});

test('with no default marked, the largest that fits the tier is measured', () => {
  const unmarked = registry.map(({ default_for: _default, ...row }) => row);
  assert.equal(pickChatModel(unmarked, {}, 32, 0)?.id, 'qwen3.5-4b-q4_k_m');
  assert.equal(pickChatModel(unmarked, {}, 8, 0)?.id, 'qwen3.5-4b-q4_k_m');
});

test('a reply with no content delta reports the whole request, never a negative number', () => {
  // The -5437 ms bug: a 5560 ms request whose first token never parsed used to come out
  // as `totalMs - started` (a duration minus an instant).
  assert.equal(firstTokenMs(1_000, 0, 6_560), 5_560);
  assert.equal(firstTokenMs(1_000, 0, 1_000), 0);
});

test('a first token before the request started clamps to zero instead of going negative', () => {
  assert.equal(firstTokenMs(5_000, 4_980, 6_000), 0);
});

test('first token is the gap from the request to the first delta', () => {
  assert.equal(firstTokenMs(1_000, 1_120, 2_000), 120);
  assert.equal(firstTokenMs(1_000, 1_000.4, 2_000), 0); // rounds to whole ms
});

test('decode speed spans first token to last token, so the first token is not double counted', () => {
  // 11 tokens, 1000 ms after the first one: 10 steps over one second.
  assert.equal(decodeSpeed(11, 1_000, 2_000), 10);
  // A single token gives no window to measure.
  assert.equal(decodeSpeed(1, 1_000, 2_000), 0);
  // No first token, no speed.
  assert.equal(decodeSpeed(20, 0, 2_000), 0);
  // A zero-width window must not divide by zero.
  assert.equal(decodeSpeed(5, 1_000, 1_000), 4_000);
});

test('percentile is nearest-rank and does not mutate the samples', () => {
  const samples = [40, 10, 30, 20];
  assert.equal(percentile(samples, 50), 20);
  assert.equal(percentile(samples, 95), 40);
  assert.equal(percentile([], 50), 0);
  assert.deepEqual(samples, [40, 10, 30, 20]);
});
