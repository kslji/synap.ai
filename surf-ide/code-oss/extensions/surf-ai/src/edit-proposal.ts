/**
 * Diff-apply edit engine (vscode glue).
 *
 * The model is instructed to emit reviewable edits as fenced `SURF_EDIT` blocks
 * containing JSON: { file, search, replace }. The pure parsing and search/replace
 * logic lives in `edit-core.ts`; this module wires it to the workspace root, the
 * filesystem, and a `WorkspaceEdit` that applies an accepted edit to a real file.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import {
  parseEditBlocks,
  resolveEditPath,
  diffLines,
  applySearchReplace,
} from './edit-core';

export interface ProposedEdit {
  /** Absolute filesystem path of the target file. */
  file: string;
  /** Path relative to the workspace root, for display. */
  relPath: string;
  /** Exact existing text to replace ("" for a new file). */
  search: string;
  /** Replacement text. */
  replace: string;
  /** True when the target file does not exist yet. */
  isNewFile: boolean;
}

const fsPrimitives = {
  join: (a: string, b: string) => path.join(a, b),
  relative: (a: string, b: string) => path.relative(a, b),
  isAbsolute: (p: string) => path.isAbsolute(p),
  exists: (p: string) => fs.existsSync(p),
};

/** Split a model response into prose (explanation) and parsed, workspace-resolved edits. */
export function parseEdits(response: string): { prose: string; edits: ProposedEdit[] } {
  const { prose, blocks } = parseEditBlocks(response);
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
  const edits: ProposedEdit[] = [];
  for (const block of blocks) {
    const resolved = resolveEditPath(block.file, root, fsPrimitives);
    if (!resolved) {
      continue;
    }
    edits.push({
      file: resolved.file,
      relPath: resolved.relPath,
      search: block.search,
      replace: block.replace,
      isNewFile: resolved.isNewFile,
    });
  }
  return { prose, edits };
}

/** Line-level diff for the review UI: removed lines and added lines. */
export function editDiff(edit: ProposedEdit): { removed: string[]; added: string[] } {
  return diffLines(edit);
}

/** Apply an accepted edit to disk via a WorkspaceEdit. */
export async function applyEdit(edit: ProposedEdit): Promise<void> {
  const uri = vscode.Uri.file(edit.file);

  if (edit.isNewFile) {
    const we = new vscode.WorkspaceEdit();
    we.createFile(uri, { overwrite: false });
    we.insert(uri, new vscode.Position(0, 0), edit.replace);
    if (!(await vscode.workspace.applyEdit(we))) {
      throw new Error(`Could not create ${edit.relPath}`);
    }
    await saveIfOpen(uri);
    return;
  }

  const doc = await vscode.workspace.openTextDocument(uri);
  const full = doc.getText();
  const updated = applySearchReplace(full, edit.search, edit.replace);
  if (updated === null) {
    throw new Error(`Could not find the text to replace in ${edit.relPath}`);
  }
  const range = new vscode.Range(
    doc.positionAt(0),
    doc.positionAt(full.length)
  );
  const we = new vscode.WorkspaceEdit();
  we.replace(uri, range, updated);
  if (!(await vscode.workspace.applyEdit(we))) {
    throw new Error(`Could not apply the edit to ${edit.relPath}`);
  }
  await saveDoc(doc);
}

async function saveIfOpen(uri: vscode.Uri): Promise<void> {
  const doc = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === uri.fsPath);
  if (doc?.isDirty) {
    await saveDoc(doc);
  }
}

async function saveDoc(doc: vscode.TextDocument): Promise<void> {
  try {
    await doc.save();
  } catch {
    // Auto-save or a read-only document may reject; the edit is still applied in-memory.
  }
}
