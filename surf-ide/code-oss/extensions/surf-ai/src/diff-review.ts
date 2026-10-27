/**
 * Side-by-side review of a proposed edit.
 *
 * A proposal is shown as a real diff editor: the file as it reads today on the
 * left, the same file with the edit applied on the right. Both sides are served
 * from memory rather than from disk, for two reasons. A rejected proposal must
 * leave nothing behind — no dirty buffer, no stray file — and both sides have to
 * be computed from the same text the accept step will use, so a file with
 * unsaved changes cannot show a diff that disagrees with what Apply does.
 */

import * as vscode from 'vscode';
import { proposedText } from './edit-core';

/** Scheme for both sides of a review; the path is `/<side>/<edit id>/<relative file>`. */
export const REVIEW_SCHEME = 'surf-review';

const SIDES = ['before', 'after'] as const;
type Side = typeof SIDES[number];

/** A proposal the review editor can be opened for. */
export interface Reviewable {
  file: string;
  relPath: string;
  search: string;
  replace: string;
  isNewFile: boolean;
}

/**
 * The URI one side of a review is served from. The edit id sits in the path so
 * the accept and reject commands can find the proposal back from the tab the
 * user is looking at, whichever side of the diff has focus.
 */
export function reviewUri(side: Side, id: string, relPath: string): vscode.Uri {
  return vscode.Uri.from({ scheme: REVIEW_SCHEME, path: `/${side}/${id}/${relPath}` });
}

/** The edit id inside a review URI, or null when the URI is not one of ours. */
export function editIdFromUri(uri: vscode.Uri): string | null {
  if (uri.scheme !== REVIEW_SCHEME) {
    return null;
  }
  const segments = uri.path.split('/').filter(Boolean);
  if (segments.length < 3 || !SIDES.includes(segments[0] as Side)) {
    return null;
  }
  return segments[1];
}

/**
 * Serves the two sides of every open review and owns the tab lifecycle around
 * them. `resolve` is called when the user accepts or rejects from the editor
 * title bar, so the proposal itself stays owned by the chat panel.
 */
export class DiffReview implements vscode.Disposable {
  private readonly texts = new Map<string, string>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly changed = new vscode.EventEmitter<vscode.Uri>();

  constructor(private readonly resolve: (id: string, accepted: boolean) => void) {
    this.disposables.push(
      this.changed,
      vscode.workspace.registerTextDocumentContentProvider(REVIEW_SCHEME, {
        onDidChange: this.changed.event,
        provideTextDocumentContent: (uri) => this.texts.get(uri.toString()) ?? ''
      })
    );
  }

  /**
   * Open the before/after pair for `id` and return false when the anchor text
   * the proposal searches for is no longer in the file.
   */
  public async open(id: string, edit: Reviewable): Promise<boolean> {
    const before = await this.readCurrent(edit);
    const after = proposedText(before, edit);
    if (after === null) {
      return false;
    }
    const left = reviewUri('before', id, edit.relPath);
    const right = reviewUri('after', id, edit.relPath);
    this.texts.set(left.toString(), before);
    this.texts.set(right.toString(), after);
    this.changed.fire(left);
    this.changed.fire(right);
    await vscode.commands.executeCommand(
      'vscode.diff',
      left,
      right,
      `${edit.relPath} (Surf AI proposal)`,
      { preview: true, preserveFocus: false }
    );
    return true;
  }

  /** Close every review tab that belongs to `id`; a user may have dragged it anywhere. */
  public async close(id: string): Promise<void> {
    for (const key of [...this.texts.keys()]) {
      if (editIdFromUri(vscode.Uri.parse(key)) === id) {
        this.texts.delete(key);
      }
    }
    const tabs: vscode.Tab[] = [];
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const input = tab.input;
        if (input instanceof vscode.TabInputTextDiff) {
          const owned = [input.original, input.modified].some((uri) => editIdFromUri(uri) === id);
          if (owned) {
            tabs.push(tab);
          }
        }
      }
    }
    if (tabs.length > 0) {
      await vscode.window.tabGroups.close(tabs);
    }
  }

  /** True when the tab the user is looking at is one of our reviews. */
  public activeReviewId(): string | null {
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    if (!(input instanceof vscode.TabInputTextDiff)) {
      return null;
    }
    return editIdFromUri(input.modified) ?? editIdFromUri(input.original);
  }

  /** Accept or reject the review in the active tab. Returns false when there is none. */
  public resolveActive(accepted: boolean): boolean {
    const id = this.activeReviewId();
    if (!id) {
      return false;
    }
    this.resolve(id, accepted);
    return true;
  }

  public dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.texts.clear();
  }

  /** The text the proposal was matched against: the open buffer if there is one, else disk. */
  private async readCurrent(edit: Reviewable): Promise<string> {
    if (edit.isNewFile) {
      return '';
    }
    const uri = vscode.Uri.file(edit.file);
    const open = vscode.workspace.textDocuments.find((doc) => doc.uri.fsPath === uri.fsPath);
    if (open) {
      return open.getText();
    }
    try {
      return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
    } catch {
      return '';
    }
  }
}
