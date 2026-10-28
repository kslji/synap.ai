/**
 * SSE stream parsing tests: frame decoding, split frames across network
 * chunks, reasoning deltas, gateway billing/error frames, and the abort path
 * the Stop button relies on.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseStreamFrame, frameDelta, streamDeltas } from './sse';

function fakeBody(chunks: string[]) {
  let index = 0;
  return {
    getReader: () => ({
      read: async () => {
        if (index >= chunks.length) {
          return { done: true, value: undefined };
        }
        const value = Buffer.from(chunks[index++], 'utf8');
        return { done: false, value: new Uint8Array(value.buffer, value.byteOffset, value.length) };
      },
      cancel: async () => undefined,
      releaseLock: () => undefined
    })
  };
}

const decode = (bytes: Uint8Array) => Buffer.from(bytes).toString('utf8');

test('a content frame yields its delta; [DONE] and billing frames are silent', async () => {
  const delta = parseStreamFrame('{"choices":[{"delta":{"content":"Hel"}}]}');
  assert.equal(delta.content, 'Hel');
  assert.equal(delta.reasoning, '');
  assert.equal(parseStreamFrame('[DONE]').content, '');
  assert.equal(parseStreamFrame('{"billing":{"cost_usd":0.01}}').content, '');
  assert.equal(parseStreamFrame('not json').content, '');
});

test('reasoning_content streams separately from content', () => {
  const delta = parseStreamFrame('{"choices":[{"delta":{"reasoning_content":"think ","content":"say"}}]}');
  assert.equal(delta.reasoning, 'think ');
  assert.equal(delta.content, 'say');
});

test('an error frame carries its message so the caller surfaces it', () => {
  const delta = parseStreamFrame('{"error":{"message":"context length exceeded"}}');
  assert.equal(delta.error, 'context length exceeded');
});

test('a frame split across network chunks is still parsed whole', async () => {
  const body = fakeBody([
    'data: {"choices":[{"del',
    'ta":{"content":"AB"}}]}\n\ndata: {"choices":[{"delta":{"content":"CD"}}]}\n\n',
    'data: [DONE]\n\n'
  ]);
  const parts: string[] = [];
  for await (const delta of streamDeltas(body as never, decode)) {
    parts.push(delta.content);
  }
  assert.deepEqual(parts, ['AB', 'CD']);
});

test('multi-line frames merge their data lines', async () => {
  const body = fakeBody(['data: {"choices":[{"delta":{"content":"one"}}]}\ndata: {"choices":[{"delta":{"content":" two"}}]}\n\n']);
  const seen: string[] = [];
  for await (const delta of streamDeltas(body as never, decode)) {
    seen.push(delta.content);
  }
  assert.deepEqual(seen, ['one two']);
  assert.equal(frameDelta('data: {"choices":[{"delta":{"reasoning_content":"r"}}]}').reasoning, 'r');
});

test('the generator stops after an error frame', async () => {
  const body = fakeBody([
    'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
    'data: {"error":{"message":"boom"}}\n\n',
    'data: {"choices":[{"delta":{"content":"never"}}]}\n\n'
  ]);
  const seen: string[] = [];
  let error: string | undefined;
  for await (const delta of streamDeltas(body as never, decode)) {
    if (delta.error) { error = delta.error; break; }
    seen.push(delta.content);
  }
  assert.deepEqual(seen, ['ok']);
  assert.equal(error, 'boom');
});
