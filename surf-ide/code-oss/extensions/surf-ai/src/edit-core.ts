/**
 * Pure, editor-agnostic core of the diff-apply edit engine.
 *
 * This file has no dependency on the `vscode` API so the parsing and the
 * line-level search/replace logic can be unit-tested directly. The vscode
 * glue lives in `edit-proposal.ts`, which feeds this module the workspace
 * root and the filesystem while driving the actual `WorkspaceEdit`.
 */

export interface EditBlock {
  file: string;
  search: string;
  replace: string;
}

export interface ResolvedEditPath {
  /** Absolute filesystem path of the target file. */
  file: string;
  /** Path relative to the workspace root, for display. */
  relPath: string;
  /** True when the target file does not exist yet. */
  isNewFile: boolean;
}

// A fenced block whose first line is SURF_EDIT, containing JSON on the lines after it.
const FENCE_RE = /```SURF_EDIT[^\n]*\n([\s\S]*?)```/g;

/** Split a model response into prose (explanation) and the raw edit blocks it proposed. */
export function parseEditBlocks(response: string): { prose: string; blocks: EditBlock[] } {
  const blocks: EditBlock[] = [];
  FENCE_RE.lastIndex = 0;
  const prose = response.replace(FENCE_RE, '').trim();

  let match: RegExpExecArray | null;
  FENCE_RE.lastIndex = 0;
  while ((match = FENCE_RE.exec(response)) !== null) {
    const parsed = safeJson(match[1]);
    const items = Array.isArray(parsed) ? parsed : [parsed];
    for (const item of items) {
      const block = toBlock(item);
      if (block) {
        blocks.push(block);
      }
    }
  }
  return { prose, blocks };
}

function safeJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function toBlock(item: unknown): EditBlock | null {
  if (!item || typeof item !== 'object') {
    return null;
  }
  const raw = item as Record<string, unknown>;
  const file = typeof raw.file === 'string' ? raw.file.trim() : '';
  if (!file) {
    return null;
  }
  const search = typeof raw.search === 'string' ? raw.search : '';
  const replace = typeof raw.replace === 'string' ? raw.replace : '';
  return { file, search, replace };
}

/**
 * Resolve a proposed file path to an absolute path relative to the workspace
 * root, deciding whether it is a new file. Path/fs primitives are injected so
 * this stays free of `fs`/`path`/`vscode` imports and can be unit-tested.
 * `root` may be empty, in which case a bare relative path cannot be anchored
 * and null is returned.
 */
export function resolveEditPath(
  raw: string,
  root: string,
  primitives: {
    join: (a: string, b: string) => string;
    relative: (a: string, b: string) => string;
    isAbsolute: (p: string) => boolean;
    exists: (p: string) => boolean;
  }
): ResolvedEditPath | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const absolute = primitives.isAbsolute(trimmed);
  if (!absolute && !root) {
    return null;
  }
  const abs = absolute ? trimmed : primitives.join(root, trimmed);
  return {
    file: abs,
    relPath: absolute ? abs : primitives.relative(root, abs),
    isNewFile: !primitives.exists(abs)
  };
}

/** Line-level diff for the review UI: removed lines and added lines. */
export function diffLines(edit: { search: string; replace: string; isNewFile: boolean }): { removed: string[]; added: string[] } {
  const removed = edit.isNewFile || edit.search === '' ? [] : edit.search.split('\n');
  const added = edit.replace === '' ? [] : edit.replace.split('\n');
  return { removed, added };
}

/**
 * Apply a single exact-match search/replace to a file's text.
 *
 * Returns the new file contents, or null when `search` is not found (which the
 * caller surfaces as "text to replace not found"). An empty `search` is treated
 * as "no match possible" and returns null unless the content is already empty.
 */
export function applySearchReplace(content: string, search: string, replace: string): string | null {
  const idx = content.indexOf(search);
  if (idx === -1) {
    return null;
  }
  return content.slice(0, idx) + replace + content.slice(idx + search.length);
}
