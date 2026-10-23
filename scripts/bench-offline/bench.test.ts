import assert from 'node:assert/strict';
import { test } from 'node:test';

import { decodeSpeed, firstTokenMs, percentile } from './timing.js';

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
