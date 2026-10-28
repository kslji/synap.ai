/**
 * Throughput estimate for the status bar's tokens/sec read.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tokensPerSec, CHARS_PER_TOKEN } from './token-rate';

test('tokensPerSec: ~4 chars per token over the elapsed window', () => {
  // 400 chars = 100 tokens over 2000ms = 50 t/s.
  assert.equal(tokensPerSec(400, 2000), 50);
});

test('tokensPerSec: rounds to the nearest whole token', () => {
  // 40 chars = 10 tokens over 3000ms = 3.33 -> 3.
  assert.equal(tokensPerSec(40, 3000), 3);
});

test('tokensPerSec: empty or non-positive inputs read as 0, never NaN', () => {
  assert.equal(tokensPerSec(0, 1000), 0);
  assert.equal(tokensPerSec(100, 0), 0);
  assert.equal(tokensPerSec(-5, 100), 0);
  assert.equal(tokensPerSec(100, -1), 0);
  assert.equal(Number.isNaN(tokensPerSec(0, 0)), false);
});

test('tokensPerSec: honours the shared chars-per-token constant', () => {
  assert.equal(CHARS_PER_TOKEN, 4);
  // One token is exactly CHARS_PER_TOKEN chars; over one second that is 1 t/s.
  assert.equal(tokensPerSec(CHARS_PER_TOKEN, 1000), 1);
});
