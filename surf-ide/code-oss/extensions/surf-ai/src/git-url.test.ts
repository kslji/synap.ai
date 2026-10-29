/**
 * GitHub remote parsing and PR URL building (the vscode-free half of github.ts).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseRepoSlug, compareUrl } from './git-url';

test('parseRepoSlug: SSH remote', () => {
  assert.deepEqual(parseRepoSlug('git@github.com:acme/widget.git'), { owner: 'acme', repo: 'widget' });
});

test('parseRepoSlug: HTTPS remote with .git suffix', () => {
  assert.deepEqual(parseRepoSlug('https://github.com/acme/widget.git'), { owner: 'acme', repo: 'widget' });
});

test('parseRepoSlug: HTTPS remote without suffix', () => {
  assert.deepEqual(parseRepoSlug('https://github.com/acme/widget'), { owner: 'acme', repo: 'widget' });
});

test('parseRepoSlug: keeps the last two segments for nested group paths', () => {
  assert.deepEqual(parseRepoSlug('https://github.com/org/team/repo.git'), { owner: 'team', repo: 'repo' });
});

test('parseRepoSlug: null for empty or path-less input', () => {
  assert.equal(parseRepoSlug(''), null);
  assert.equal(parseRepoSlug('   '), null);
  assert.equal(parseRepoSlug('not-a-url'), null);
});

test('compareUrl: encodes base and head into the ?expand=1 compare link', () => {
  assert.equal(
    compareUrl({ owner: 'acme', repo: 'widget' }, 'feature/x', 'main'),
    'https://github.com/acme/widget/compare/main...feature%2Fx?expand=1'
  );
});
