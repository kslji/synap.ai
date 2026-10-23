/**
 * Unit tests for the vscode-independent core of the diff-apply engine.
 *
 * Run with: npx tsx --test extensions/surf-ai/src/edit-core.test.ts
 * (kept free of the `vscode` module so it runs in plain Node.)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  parseEditBlocks,
  resolveEditPath,
  diffLines,
  applySearchReplace,
} from './edit-core';

const primitives = {
  join: (a: string, b: string) => path.join(a, b),
  relative: (a: string, b: string) => path.relative(a, b),
  isAbsolute: (p: string) => path.isAbsolute(p),
  exists: (p: string) => fs.existsSync(p),
};

test('parses two SURF_EDIT blocks and keeps the prose', () => {
  const response = [
    'I will fix the greeting and add an import.',
    '```SURF_EDIT',
    '{ "file": "src/a.ts", "search": "old", "replace": "new" }',
    '```',
    'and then:',
    '```SURF_EDIT',
    '{ "file": "src/b.ts", "search": "delete me", "replace": "" }',
    '```',
  ].join('\n');

  const { prose, blocks } = parseEditBlocks(response);

  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks[0], { file: 'src/a.ts', search: 'old', replace: 'new' });
  assert.deepEqual(blocks[1], { file: 'src/b.ts', search: 'delete me', replace: '' });
  // The fenced JSON is stripped from the prose but the explanation remains.
  assert.ok(prose.includes('I will fix the greeting'));
  assert.ok(!prose.includes('SURF_EDIT'));
});

test('resolveEditPath anchors relative paths to the workspace root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surf-root-'));
  try {
    const existing = path.join(root, 'src', 'a.ts');
    fs.mkdirSync(path.dirname(existing), { recursive: true });
    fs.writeFileSync(existing, 'hello');

    const resolved = resolveEditPath('src/a.ts', root, primitives);
    assert.ok(resolved);
    assert.equal(resolved!.file, existing);
    assert.equal(resolved!.relPath, path.join('src', 'a.ts'));
    assert.equal(resolved!.isNewFile, false);

    const created = resolveEditPath('src/new.ts', root, primitives);
    assert.ok(created);
    assert.equal(created!.isNewFile, true);

    // A bare relative path with no workspace root cannot be anchored.
    assert.equal(resolveEditPath('src/a.ts', '', primitives), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('applySearchReplace performs exact line add, delete and edit', () => {
  const original = 'line1\nline2\nline3\n';

  // Edit a line.
  assert.equal(
    applySearchReplace(original, 'line2', 'LINE TWO'),
    'line1\nLINE TWO\nline3\n'
  );

  // Delete a line (replace with "").
  assert.equal(
    applySearchReplace(original, 'line2\n', ''),
    'line1\nline3\n'
  );

  // Add lines by anchoring on an existing line.
  assert.equal(
    applySearchReplace(original, 'line1\n', 'line1\nline1.5\n'),
    'line1\nline1.5\nline2\nline3\n'
  );

  // No match is reported as null rather than corrupting the file.
  assert.equal(applySearchReplace(original, 'nope', 'x'), null);
});

test('diffLines reports removed and added lines for the review UI', () => {
  const edit = { search: 'a\nb', replace: 'a\nc', isNewFile: false };
  assert.deepEqual(diffLines(edit), { removed: ['a', 'b'], added: ['a', 'c'] });

  // A new file has no removed lines.
  const newFile = { search: '', replace: 'x\ny', isNewFile: true };
  assert.deepEqual(diffLines(newFile), { removed: [], added: ['x', 'y'] });
});

test('apply writes the exact change to a temp file; reject leaves it untouched', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'surf-apply-'));
  try {
    const file = path.join(dir, 'mod.ts');
    const original = 'function add(a, b) {\n  return a - b;\n}\n';
    fs.writeFileSync(file, original);

    // Apply: replace the buggy line.
    const updated = applySearchReplace(fs.readFileSync(file, 'utf8'), 'return a - b;', 'return a + b;');
    assert.ok(updated);
    fs.writeFileSync(file, updated);
    assert.equal(fs.readFileSync(file, 'utf8'), 'function add(a, b) {\n  return a + b;\n}\n');

    // Reject: an edit we choose not to apply must not touch the file.
    const before = fs.readFileSync(file, 'utf8');
    const rejected = applySearchReplace(before, 'does not exist', 'whatever');
    // Not found => nothing to write; file stays byte-for-byte identical.
    assert.equal(rejected, null);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
