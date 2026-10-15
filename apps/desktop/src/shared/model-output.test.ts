import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cleanInfill, parseModelJson, stripMarkdownFences } from './model-output.js'

test('markdown fences around JSON are removed', () => {
  const fenced = '```json\n{"queries":["pier 9"]}\n```'
  assert.equal(stripMarkdownFences(fenced), '{"queries":["pier 9"]}')
  assert.deepEqual(parseModelJson(fenced), { queries: ['pier 9'] })
  assert.deepEqual(parseModelJson('Here you go:\n```\n{"ok":true}\n```'), { ok: true })
  assert.deepEqual(parseModelJson('{"ok":true}'), { ok: true })
})

test('infill drops a duplicated suffix and extra closing braces', () => {
  const prefix = 'export function add(a: number, b: number) {\n'
  const suffix = '\n}\n'
  const raw = '  return a + b;\n}\n}\n'
  assert.equal(cleanInfill(raw, { prefix, suffix }), '  return a + b;')

  const kept = '  if (ok) {\n    return 1;\n  }\n'
  assert.equal(cleanInfill(kept, { prefix: 'function f() {\n', suffix }), kept)

  const extraLine = '  return 1;\n}\n}\n'
  assert.equal(cleanInfill(extraLine, { prefix: 'function f() {\n', suffix: '\n}\n' }), '  return 1;')

  const indented = '  return 1;\n  }\n'
  assert.equal(cleanInfill(indented, { prefix: 'function f() {\n', suffix: '\n}\n' }), '  return 1;\n')

  const quoted = '  const s = "}"\n  return s;\n'
  assert.equal(cleanInfill(quoted, { prefix: 'function f() {\n', suffix }), quoted)

  const commented = '  // }\n  return 1;\n'
  assert.equal(cleanInfill(commented, { prefix: 'function f() {\n', suffix }), commented)
})
