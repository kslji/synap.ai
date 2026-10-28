/**
 * FIM prompt and LRU cache tests: the ChatML fill-in-the-middle format, stop
 * token sanitisation, and the eviction order ghost text relies on.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildFimPrompt,
  sanitizeFimCompletion,
  fimCacheKey,
  LruCache,
  FIM_STOP_TOKENS,
  FIM_MAX_TOKENS,
  FIM_MAX_CONTEXT
} from './fim';

const IM_START = '<|' + 'im_start|>';
const IM_END = '<|' + 'im_end|>';
const IM_MIDDLE = '<|' + 'im_middle|>';

test('the FIM prompt is ChatML: system turn, prefix, middle marker, suffix', () => {
  const prompt = buildFimPrompt({ prefix: 'function add(a, b) {\n  ', suffix: '\n}' });
  assert.ok(prompt.startsWith(IM_START + 'system\n'));
  assert.ok(prompt.includes(IM_END + '\n' + IM_START + 'user\n'));
  // Prefix and suffix bracket the middle token inside the user turn, verbatim.
  const userTurn = prompt.slice(prompt.indexOf(IM_START + 'user\n'));
  assert.ok(userTurn.includes('function add(a, b) {\n  ' + IM_MIDDLE + '\n}'));
  // Generation starts right after the assistant header.
  assert.ok(prompt.endsWith(IM_START + 'assistant\n'));
});

test('oversized context is capped on both sides', () => {
  const prompt = buildFimPrompt({ prefix: 'a'.repeat(FIM_MAX_CONTEXT + 500), suffix: 'b'.repeat(FIM_MAX_CONTEXT + 500) });
  assert.ok(!prompt.includes('a'.repeat(FIM_MAX_CONTEXT + 1)));
  assert.ok(!prompt.includes('b'.repeat(FIM_MAX_CONTEXT + 1)));
});

test('the stop list ends at the first token that appears', () => {
  assert.equal(FIM_STOP_TOKENS.length, 3);
  assert.equal(sanitizeFimCompletion('return a + b\n\nmore code'), 'return a + b');
  assert.equal(sanitizeFimCompletion('return a + b' + IM_END + 'junk'), 'return a + b');
  assert.equal(sanitizeFimCompletion('x' + IM_MIDDLE + 'y'), 'x');
  assert.equal(sanitizeFimCompletion('  \n  '), '');
});

test('headroom is the 96-token budget for a single keystroke', () => {
  assert.equal(FIM_MAX_TOKENS, 96);
});

test('the LRU evicts the least recently used entry and refreshes on get', () => {
  const cache = new LruCache<string, string>(2);
  cache.set('a', '1');
  cache.set('b', '2');
  // Touching 'a' makes 'b' the oldest relative to the next write.
  assert.equal(cache.get('a'), '1');
  cache.set('c', '3');
  assert.equal(cache.get('b'), undefined);
  assert.equal(cache.get('a'), '1');
  assert.equal(cache.get('c'), '3');
  assert.equal(cache.size, 2);
  // Rewriting an existing key does not grow the cache.
  cache.set('a', '9');
  assert.equal(cache.size, 2);
  assert.equal(cache.get('a'), '9');
  cache.clear();
  assert.equal(cache.size, 0);
});

test('the cache key changes with document, position, or context', () => {
  const req = { prefix: 'abc', suffix: 'def' };
  const k = fimCacheKey('file:///a.ts', 1, 2, req);
  assert.equal(fimCacheKey('file:///a.ts', 1, 2, req), k);
  assert.notEqual(fimCacheKey('file:///b.ts', 1, 2, req), k);
  assert.notEqual(fimCacheKey('file:///a.ts', 2, 2, req), k);
  assert.notEqual(fimCacheKey('file:///a.ts', 1, 2, { prefix: 'abc', suffix: 'zzz' }), k);
});
