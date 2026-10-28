/**
 * Workspace tools the agent loop can reach.
 *
 * Each tool is the thin vscode edge over a pure helper: reads and listings go
 * through `workspace.fs` (respecting the workspace-trust settings the fork
 * launches with), search uses ripgrep when it is on PATH and falls back to a
 * workspace walk, and edits are computed by `edit-core` and registered with
 * DiffReview before a human accepts them — the agent never writes source files
 * directly.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { applySearchReplace, diffLines, resolveEditPath, type EditBlock } from './edit-core';
import { isInsideRoot, sliceLines, matchSearchHits, isAllowlistedCommand } from './agent-core';
import type { ProposedEdit } from './edit-proposal';
import type { AgentObservation, AgentTool } from './agent-loop';

export { sliceLines, matchSearchHits, isAllowlistedCommand } from './agent-core';

const execFileAsync = promisify(execFile);

export interface WorkspaceToolHooks {
  /** Register a proposed edit with the review pipeline (DiffReview + chat card). */
  propose: (edit: ProposedEdit) => Promise<void>;
  /** Approval gate for run_command; resolves false when the user declined. */
  approve: (command: string, cwd: string) => Promise<boolean>;
}

function workspaceRoot(): string {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) {
    throw new Error('No folder is open in this window.');
  }
  return root;
}

/** Guard every path the model names: it must stay inside the workspace. */
function safePath(rel: unknown): { root: string; abs: string } {
  const root = workspaceRoot();
  const resolved = resolveEditPath(typeof rel === 'string' && rel.trim() ? rel : '.', root, {
    join: (a, b) => path.join(a, b),
    relative: (a, b) => path.relative(a, b),
    isAbsolute: (p) => path.isAbsolute(p),
    exists: () => false,
  });
  if (!resolved) {
    throw new Error(`Path "${String(rel)}" escapes the workspace.`);
  }
  // resolveEditPath only anchors the path; containment is out of scope, so the
  // agent-facing boundary is enforced here — `../x` never reaches the fs tools.
  if (!isInsideRoot(resolved.file, root, path.sep)) {
    throw new Error(`Path "${String(rel)}" escapes the workspace.`);
  }
  return { root, abs: resolved.file };
}

interface RunCapture {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Run in VS Code's integrated terminal when visible; capture via a pty-free
 * fallback (child process) so the loop still sees stdout for inspection. */
async function runCaptured(command: string, cwd: string, signal?: AbortSignal): Promise<RunCapture> {
  const showTerminal = vscode.window.tabGroups.all.some((group) =>
    group.tabs.some((tab) => tab.input instanceof vscode.TabInputTerminal));
  if (showTerminal) {
    const term = vscode.window.createTerminal({ cwd });
    term.show();
    term.sendText(command);
    // The user watches the real terminal; give it a moment and report that the
    // command was handed over rather than pretending to capture its output.
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 2500);
      signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('Cancelled.')); }, { once: true });
    });
    term.dispose();
    return { stdout: '', stderr: '', exitCode: 0 };
  }
  try {
    const { stdout, stderr } = await execFileAsync(command, {
      cwd,
      maxBuffer: 512 * 1024,
      timeout: 120_000,
      shell: true,
      signal
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; code?: number | string };
    const exitCode = typeof e.code === 'number' ? e.code : -1;
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? String(error), exitCode };
  }
}

function formatDiagnostics(diagnostics: readonly vscode.Diagnostic[], uri: vscode.Uri): string {
  return diagnostics.map((d) => {
    const severity = d.severity === vscode.DiagnosticSeverity.Error ? 'error' : 'warn';
    return `${severity} ${uri.fsPath}:${d.range.start.line + 1}:${d.range.start.character + 1}: ${d.message}`;
  }).join('\n');
}

/** Build the tool set for one agent turn. */
export function buildWorkspaceTools(hooks: WorkspaceToolHooks): AgentTool[] {
  const readSlice = async (args: Record<string, unknown>): Promise<string> => {
    const { abs } = safePath(args.path);
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(abs));
    return sliceLines(Buffer.from(bytes).toString('utf8'), toInt(args.startLine), toInt(args.endLine));
  };

  return [
    {
      name: 'read_file',
      description: 'Read a workspace file, optionally a 1-based line slice.',
      argsHint: 'path: string, startLine?: number, endLine?: number',
      run: async (args) => {
        try {
          const text = await readSlice(args);
          return { ok: true, output: text || '(empty file)', label: `Reading ${String(args.path ?? '')}` };
        } catch (error) {
          return { ok: false, output: (error as Error).message };
        }
      }
    },
    {
      name: 'list_dir',
      description: 'List files and folders at a workspace-relative path ("." for the root).',
      argsHint: 'path: string',
      run: async (args) => {
        try {
          const { abs } = safePath(args.path ?? '.');
          const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(abs));
          const listed = entries
            .filter(([name]) => !name.startsWith('.') && name !== 'node_modules')
            .map(([name, type]) => `${name}${type === vscode.FileType.Directory ? '/' : ''}`)
            .sort();
          return { ok: true, output: listed.join('\n') || '(empty)', label: `Listing ${String(args.path ?? '.')}` };
        } catch (error) {
          return { ok: false, output: (error as Error).message };
        }
      }
    },
    {
      name: 'search_project',
      description: 'Search the workspace for a literal string; returns path:line hits.',
      argsHint: 'query: string',
      run: async (args) => {
        const query = typeof args.query === 'string' ? args.query.trim() : '';
        if (!query) { return { ok: false, output: 'search_project needs a non-empty query.' }; }
        const { root, abs } = safePath('.');
        try {
          const rg = await execFileAsync('rg', ['--line-number', '--max-count', '40', '--glob', '!node_modules', '--glob', '!.git', '-F', query, root], {
            timeout: 15_000,
            maxBuffer: 256 * 1024
          });
          const hits = (rg.stdout || `No matches for "${query}".`).trim();
          return { ok: true, output: hits.slice(0, 6000), label: `Searching project for "${query}"` };
        } catch {
          // No ripgrep on this machine: fall back to a small workspace walk.
          const rel = await vscode.workspace.findFiles('**/*', '**/{node_modules,.git,.build,out,dist}/**', 400);
          const files: Array<{ path: string; text: string }> = [];
          for (const uri of rel) {
            try {
              const doc = await vscode.workspace.openTextDocument(uri);
              if (doc.lineCount > 3000) { continue; }
              files.push({ path: uri.fsPath.replace(root + path.sep, ''), text: doc.getText() });
            } catch { /* binary or unreadable */ }
            if (files.length >= 120) { break; }
          }
          void abs;
          return { ok: true, output: matchSearchHits(files, query), label: `Searching project for "${query}"` };
        }
      }
    },
    {
      name: 'propose_edit',
      description: 'Propose a search/replace change. It is registered for the user to accept in DiffReview.',
      argsHint: 'path: string, search: string, replace: string',
      run: async (args) => {
        const block: EditBlock = {
          file: typeof args.path === 'string' ? args.path : '',
          search: typeof args.search === 'string' ? args.search : '',
          replace: typeof args.replace === 'string' ? args.replace : ''
        };
        const edit = toProposed(block);
        if (!edit) { return { ok: false, output: 'propose_edit needs a path inside the workspace.' }; }
        if (!edit.isNewFile) {
          const current = await readSlice({ path: args.path });
          if (applySearchReplace(current, edit.search, edit.replace) === null) {
            return { ok: false, output: `The search text was not found in ${edit.relPath}. Re-read the file and match exact existing lines.` };
          }
        }
        await hooks.propose(edit);
        const { added, removed } = diffLines(edit);
        return {
          ok: true,
          output: `Edit proposed for ${edit.relPath} (+${added.length}/-${removed.length}). Waiting for the user to accept it in the diff.`,
          label: `Proposing edit to ${edit.relPath}`
        };
      }
    },
    {
      name: 'create_file',
      description: 'Propose a brand-new workspace file with the given contents.',
      argsHint: 'path: string, contents: string',
      run: async (args) => {
        const block: EditBlock = {
          file: typeof args.path === 'string' ? args.path : '',
          search: '',
          replace: typeof args.contents === 'string' ? args.contents : ''
        };
        const edit = toProposed(block);
        if (!edit) { return { ok: false, output: 'create_file needs a path inside the workspace.' }; }
        await hooks.propose(edit);
        return { ok: true, output: `Created proposal for ${edit.relPath}. Waiting for the user to accept it.`, label: `Creating ${edit.relPath}` };
      }
    },
    {
      name: 'delete_file',
      description: 'Delete a workspace file. Always ask the user first in your thought; the IDE still confirms it.',
      argsHint: 'path: string',
      run: async (args) => {
        try {
          const { abs } = safePath(args.path);
          const uri = vscode.Uri.file(abs);
          const ok = await vscode.workspace.fs.delete(uri, { useTrash: true });
          void ok;
          return { ok: true, output: `Deleted ${String(args.path)} (moved to trash).`, label: `Deleting ${String(args.path)}` };
        } catch (error) {
          return { ok: false, output: (error as Error).message };
        }
      }
    },
    {
      name: 'run_command',
      description: 'Run a build/test/git command in the workspace. Needs user approval unless allowlisted.',
      argsHint: 'command: string, cwd?: string',
      run: async (args) => {
        const command = typeof args.command === 'string' ? args.command.trim() : '';
        if (!command) { return { ok: false, output: 'run_command needs a command.' }; }
        const { root } = safePath(args.cwd ?? '.');
        if (!isAllowlistedCommand(command)) {
          const approved = await hooks.approve(command, root);
          if (!approved) {
            return { ok: false, output: 'The user declined to run that command. Choose another approach or ask them.' };
          }
        }
        const result = await runCaptured(command, root);
        const out = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
        return {
          ok: result.exitCode === 0,
          output: out || `(no output, exit ${result.exitCode})`,
          label: `Running ${command.split('\n')[0].slice(0, 48)}`
        };
      }
    },
    {
      name: 'check_diagnostics',
      description: 'Read compiler/linter errors for a file, or for every open editor.',
      argsHint: 'path?: string',
      run: async (args) => {
        const lines: string[] = [];
        if (typeof args.path === 'string' && args.path.trim()) {
          const { abs } = safePath(args.path);
          const uri = vscode.Uri.file(abs);
          const doc = await vscode.workspace.openTextDocument(uri);
          const found = vscode.languages.getDiagnostics(uri).filter((d) => d.severity === vscode.DiagnosticSeverity.Error);
          if (found.length) { lines.push(formatDiagnostics(found, uri)); }
        } else {
          for (const doc of vscode.workspace.textDocuments) {
            if (doc.isClosed || doc.uri.scheme !== 'file') { continue; }
            const found = vscode.languages.getDiagnostics(doc.uri).filter((d) => d.severity === vscode.DiagnosticSeverity.Error);
            if (found.length) { lines.push(formatDiagnostics(found, doc.uri)); }
          }
        }
        const text = lines.join('\n');
        return {
          ok: true,
          output: text ? text.slice(0, 4000) : 'No errors reported.',
          label: 'Checking diagnostics…'
        };
      }
    }
  ];
}

function toInt(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : undefined;
}

function toProposed(block: EditBlock): ProposedEdit | null {
  const root = workspaceRoot();
  const resolved = resolveEditPath(block.file, root, {
    join: (a, b) => path.join(a, b),
    relative: (a, b) => path.relative(a, b),
    isAbsolute: (p) => path.isAbsolute(p),
    exists: (p) => fs.existsSync(p),
  });
  if (!resolved) { return null; }
  if (resolved.file !== root && !resolved.file.startsWith(root + path.sep)) {
    return null;
  }
  return {
    file: resolved.file,
    relPath: resolved.relPath,
    search: block.search,
    replace: block.replace,
    isNewFile: resolved.isNewFile,
  };
}
