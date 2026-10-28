/**
 * `+` / `@` context attachments for the composer.
 *
 * A chip is a small, removable piece of context the user explicitly hands to
 * the model: a workspace file, the current selection, git state, or the
 * workspace's problems. Building the prompt text here (pure) keeps it testable;
 * the vscode-facing picker lives in `extension.ts`, which feeds results back
 * to the sidebar.
 */

export type ChipKind = 'file' | 'selection' | 'git' | 'problems';

export interface ContextChip {
  id: string;
  kind: ChipKind;
  /** Label rendered on the chip, e.g. `@file src/app.ts`. */
  label: string;
  /** The text injected into the prompt for this attachment. */
  text: string;
}

/** How many bytes of an attached file are worth putting in a prompt. */
const FILE_TEXT_LIMIT = 24_000;

export function chipId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function fileChip(relPath: string, contents: string): ContextChip {
  const clipped = contents.length > FILE_TEXT_LIMIT
    ? contents.slice(0, FILE_TEXT_LIMIT) + '\n…truncated…'
    : contents;
  return {
    id: chipId(),
    kind: 'file',
    label: `@file ${relPath}`,
    text: `Attached file ${relPath}:\n\`\`\`\n${clipped}\n\`\`\``
  };
}

export interface SelectionInfo {
  relPath: string;
  startLine: number;
  endLine: number;
  text: string;
}

export function selectionChip(sel: SelectionInfo): ContextChip {
  return {
    id: chipId(),
    kind: 'selection',
    label: `@selection ${sel.relPath}:${sel.startLine}-${sel.endLine}`,
    text: `Selected code in ${sel.relPath} (lines ${sel.startLine}-${sel.endLine}):\n\`\`\`\n${sel.text}\n\`\`\``
  };
}

/**
 * Chip from `git status` + uncommitted diff output. Empty status means a clean
 * tree; the diff body is capped because agents review changes, not archives.
 */
export function gitChip(status: string, diff: string): ContextChip {
  const head = 'Current git state of the workspace (status, then uncommitted diff):';
  // Strip only trailing whitespace so each porcelain line keeps its leading
  // two-column status (e.g. ` M src/a.ts`), which the model reads as state.
  const statusText = status.replace(/\s+$/, '');
  const diffText = diff.replace(/\s+$/, '');
  const body = [
    statusText ? `git status:\n${statusText}` : 'git status: clean',
    diffText ? `git diff (uncommitted):\n${diffText.slice(0, 24_000)}` : 'git diff: no uncommitted changes'
  ].join('\n\n');
  return { id: chipId(), kind: 'git', label: '@git changes', text: `${head}\n${body}` };
}

export interface ProblemItem {
  path: string;
  line: number;
  message: string;
  severity: 'error' | 'warning';
}

export function problemsChip(problems: ProblemItem[]): ContextChip {
  const lines = problems.length
    ? problems.slice(0, 60).map((p) => `${p.severity} ${p.path}:${p.line}: ${p.message}`).join('\n')
    : 'No problems are reported in the workspace.';
  return {
    id: chipId(),
    kind: 'problems',
    label: `@problems ${problems.length}`,
    text: `Workspace diagnostics:\n${lines}`
  };
}

/** Fold the attached chips into the prompt ahead of the user's words. */
export function buildPromptWithChips(question: string, chips: ContextChip[]): string {
  if (!chips.length) {
    return question;
  }
  return chips.map((c) => c.text).join('\n\n') + '\n\n' + question;
}

/** True when the composer text just gained a bare `@` token, i.e. the user
 * is asking for context. Checked on the token before the caret. */
export function wantsContextPicker(textBeforeCaret: string): boolean {
  return /(^|\s)@$/.test(textBeforeCaret);
}
