/**
 * Pure helpers behind the workspace tools.
 *
 * `agent-tools.ts` owns the vscode edge; the line slicing, search matching and
 * command allowlist are editor-agnostic so they can be unit-tested directly
 * (the same split `edit-core.ts` uses for the edit engine).
 */

/** Slice 1-based inclusive line ranges out of a file's text; whole file if unset. */
export function sliceLines(text: string, startLine?: number, endLine?: number): string {
  if (startLine === undefined && endLine === undefined) {
    return text;
  }
  const lines = text.split('\n');
  const from = Math.max(1, startLine ?? 1);
  const to = Math.min(lines.length, endLine ?? lines.length);
  if (from > to) {
    return '';
  }
  return lines.slice(from - 1, to).join('\n');
}

/** Pure matcher for the no-ripgrep fallback: first `max` case-sensitive hits. */
export function matchSearchHits(
  files: Array<{ path: string; text: string }>,
  query: string,
  max = 40
): string {
  const hits: string[] = [];
  for (const file of files) {
    const lines = file.text.split('\n');
    for (let i = 0; i < lines.length && hits.length < max; i++) {
      if (lines[i].includes(query)) {
        hits.push(`${file.path}:${i + 1}: ${lines[i].trim().slice(0, 160)}`);
      }
    }
    if (hits.length >= max) { break; }
  }
  return hits.length ? hits.join('\n') : `No matches for "${query}".`;
}

/**
 * Commands safe to run without an approval prompt: read-only inspections and
 * the project's own test/check/lint entry points. Everything else — installs,
 * deploys, `git push`, `node -e` — needs the user to say yes.
 */
export function isAllowlistedCommand(command: string): boolean {
  const trimmed = command.trim();
  const parts = trimmed.split(/\s+/);
  const first = parts[0] ?? '';
  if (first === 'git') {
    return /^(status|diff|log|branch|show)$/.test(parts[1] ?? '');
  }
  if (first === 'npm' || first === 'pnpm' || first === 'yarn') {
    // `npm test`, `npm run test|check|lint` — but not `npm run deploy` or installs.
    if ((parts[1] ?? '') === 'test') { return parts.length === 2; }
    if ((parts[1] ?? '') === 'run') {
      return /^(test|check|lint|coverage|test:unit)$/.test(parts[2] ?? '');
    }
    return false;
  }
  // Read-only shell basics. Interpreters are excluded: `node -e` runs arbitrary code.
  return /^(ls|cat|head|tail|pwd|rg|grep|find|wc|echo)$/.test(first);
}

/** Whether a path the model named stays inside the workspace root. */
export function isInsideRoot(abs: string, root: string, sep: string): boolean {
  return abs === root || abs.startsWith(root + sep);
}
