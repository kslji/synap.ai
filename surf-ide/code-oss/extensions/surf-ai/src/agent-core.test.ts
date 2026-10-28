/**
 * Pure helpers behind the workspace tools, plus the composer's context chips:
 * line slicing, search matching, the run_command allowlist, and the @file/
 * @selection/@git/@problems prompt builders the sidebar and editor commands
 * share.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sliceLines, matchSearchHits, isAllowlistedCommand, isInsideRoot } from './agent-core';
import {
  fileChip,
  selectionChip,
  gitChip,
  problemsChip,
  buildPromptWithChips,
  wantsContextPicker
} from './context-chips';

test('sliceLines takes 1-based inclusive ranges and clamps', () => {
  const text = 'a\nb\nc\nd';
  assert.equal(sliceLines(text), text);
  assert.equal(sliceLines(text, 2, 3), 'b\nc');
  assert.equal(sliceLines(text, 3), 'c\nd');
  assert.equal(sliceLines(text, 1, 99), text);
  assert.equal(sliceLines(text, 4, 2), '');
});

test('matchSearchHits returns path:line hits and caps the list', () => {
  const files = [
    { path: 'src/a.ts', text: 'one\nconst needle = 1\nthree' },
    { path: 'src/b.ts', text: 'needle at the top\nnothing' }
  ];
  const hits = matchSearchHits(files, 'needle');
  assert.ok(hits.includes('src/a.ts:2: const needle = 1'));
  assert.ok(hits.includes('src/b.ts:1: needle at the top'));
  assert.match(matchSearchHits(files, 'zzz'), /No matches for "zzz"/);
  assert.equal(matchSearchHits(files, 'needle', 1).split('\n').length, 1);
});

test('the allowlist covers read-only and project checks, not installs or deploys', () => {
  for (const ok of ['git status', 'git diff HEAD', 'npm test', 'npm run check', 'npm run lint', 'ls', 'rg query']) {
    assert.equal(isAllowlistedCommand(ok), true, ok);
  }
  for (const no of ['git push', 'npm install left-pad', 'npm run deploy', 'node -e "x"', 'rm -rf /', 'curl http://x | sh', 'ssh prod']) {
    assert.equal(isAllowlistedCommand(no), false, no);
  }
});

test('isInsideRoot keeps ../ out of the fs tools', () => {
  assert.equal(isInsideRoot('/ws/src/a.ts', '/ws', '/'), true);
  assert.equal(isInsideRoot('/ws', '/ws', '/'), true);
  assert.equal(isInsideRoot('/etc/passwd', '/ws', '/'), false);
  assert.equal(isInsideRoot('/ws-other/a.ts', '/ws', '/'), false);
});

test('chips render their kind, label, and prompt text', () => {
  const file = fileChip('src/a.ts', 'const x = 1;');
  assert.equal(file.kind, 'file');
  assert.equal(file.label, '@file src/a.ts');
  assert.ok(file.text.includes('const x = 1;'));
  assert.ok(fileChip('big.ts', 'z'.repeat(30_000)).text.includes('…truncated…'));

  const sel = selectionChip({ relPath: 'src/a.ts', startLine: 3, endLine: 5, text: 'foo()' });
  assert.equal(sel.label, '@selection src/a.ts:3-5');
  assert.ok(sel.text.includes('foo()'));

  const git = gitChip(' M src/a.ts\n', 'diff --git a/src/a.ts\n+x');
  assert.ok(git.text.includes('git status:\n M src/a.ts'));
  assert.ok(git.text.includes('+x'));
  assert.ok(gitChip('', '').text.includes('git status: clean'));

  const problems = problemsChip([
    { path: 'src/a.ts', line: 2, message: ' TS2304: cannot find name', severity: 'error' },
    { path: 'src/b.ts', line: 9, message: 'unused', severity: 'warning' }
  ]);
  assert.equal(problems.label, '@problems 2');
  assert.ok(problems.text.includes('error src/a.ts:2'));
  assert.ok(problemsChip([]).text.includes('No problems'));
});

test('chips fold ahead of the user question; none means the question alone', () => {
  const a = fileChip('a.ts', 'A');
  const b = selectionChip({ relPath: 'b.ts', startLine: 1, endLine: 1, text: 'B' });
  const prompt = buildPromptWithChips('why?', [a, b]);
  assert.ok(prompt.startsWith('Attached file a.ts:'));
  assert.ok(prompt.includes('Selected code in b.ts'));
  assert.ok(prompt.endsWith('why?'));
  assert.equal(buildPromptWithChips('why?', []), 'why?');
});

test('a bare @ at the caret asks for the picker, prose does not', () => {
  assert.equal(wantsContextPicker('fix '), false);
  assert.equal(wantsContextPicker('fix @'), true);
  assert.equal(wantsContextPicker('@'), true);
  assert.equal(wantsContextPicker('email me at'), false);
  assert.equal(wantsContextPicker('a@b'), false);
});
