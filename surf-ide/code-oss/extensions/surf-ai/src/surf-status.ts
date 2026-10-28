/**
 * Surf status bar.
 *
 * Two Surf-owned items on the IDE's bottom bar, mirroring the layout of a real
 * agentic editor:
 *
 *   - an **engine** item on the left showing which backend the last turn used
 *     (Local / Cloud / Auto) with its model and a live tokens-per-second read;
 *   - a **Go Live** item on the right that starts the workspace's dev server in
 *     a terminal so the user can run what they are building.
 *
 * Branch, encoding, indent and end-of-line on the far right are VS Code's own
 * built-in status items — the fork ships the `git` and editor contributions, so
 * we add nothing there. This module only fills the Surf-specific gaps.
 *
 * The functions are safe to call before `initSurfStatusBar` has run (they no-op),
 * so the chat provider never has to know the bar exists yet.
 */

import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// Re-exported so existing importers (the chat provider) keep a single source and
// the pure math lives in a vscode-free module the unit tests can load.
export { tokensPerSec } from './token-rate';

let engineItem: vscode.StatusBarItem | undefined;
let goLiveItem: vscode.StatusBarItem | undefined;

// The engine label and the last measured rate, kept so a busy/idle refresh can
// re-render the same text without the caller passing it back in.
let engineLabel = '';
let lastRate = 0;
let busy = false;

function renderEngine(): void {
  if (!engineItem) {
    return;
  }
  const rate = lastRate > 0 ? ` · ${lastRate} t/s` : '';
  engineItem.text = `${busy ? '$(sync~spin)' : '$(cpu)'} ${engineLabel}${rate}`.trim();
  engineItem.tooltip = `Surf engine: ${engineLabel}${lastRate ? ` · last turn ${lastRate} tokens/sec` : ''}`;
}

/** Set the engine text (e.g. `Auto`, `● qwen2.5-coder`, `☁ claude-3-5-sonnet`). */
export function surfSetEngine(label: string): void {
  engineLabel = label;
  renderEngine();
}

/** Reflect that a turn is (or is not) streaming, to spin the engine icon. */
export function surfSetBusy(value: boolean): void {
  busy = value;
  renderEngine();
}

/** Publish the tokens-per-second measured at the end of a turn. */
export function surfReportRate(tps: number): void {
  lastRate = tps > 0 ? tps : 0;
  renderEngine();
}

/** Create and show the two Surf status items, and register the Go Live command. */
export function initSurfStatusBar(extContext: vscode.ExtensionContext): void {
  engineItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 95);
  engineItem.command = 'surf-ai.showWelcome';
  engineItem.tooltip = 'Surf engine — click to open the Surf welcome';
  surfSetEngine('idle');
  engineItem.show();

  goLiveItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
  goLiveItem.text = '$(rocket) Go Live';
  goLiveItem.tooltip = 'Start the workspace dev server in a terminal';
  goLiveItem.command = 'surf-ai.goLive';
  goLiveItem.show();

  extContext.subscriptions.push(engineItem, goLiveItem,
    vscode.commands.registerCommand('surf-ai.goLive', () => goLive())
  );
}

/**
 * Run the workspace's dev server: pick a script from the root `package.json`
 * (defaulting to `dev`/`start`/`serve`) or fall back to a configured task, and
 * launch it in a dedicated terminal. This is the "run what you build" path a
 * production project needs; everything stays local.
 */
async function goLive(): Promise<void> {
  const root = vscode.workspace.workspaceFolders?.[0];
  if (!root) {
    void vscode.window.showInformationMessage('Surf: open a folder first, then Go Live can run it.');
    return;
  }
  const script = await pickDevScript(root.uri.fsPath);
  const term = vscode.window.createTerminal({ name: 'Surf Go Live', cwd: root.uri.fsPath });
  if (script) {
    term.sendText(`npm run ${script}`, true);
  } else {
    // No package.json scripts: hand the user an interactive terminal rather than
    // guessing a command, so nothing surprising is executed.
    term.show();
    void vscode.window.showInformationMessage('No npm scripts found — a terminal is open for you to start your app.');
    return;
  }
  term.show();
}

/** List the root package.json scripts and let the user choose, pre-selecting the likely dev server. */
async function pickDevScript(cwd: string): Promise<string | null> {
  let scripts: Record<string, string> = {};
  try {
    const out = (await execFileAsync('node', ['-e',
      'process.stdout.write(JSON.stringify((require("./package.json").scripts)||{}))'
    ], { cwd })).stdout;
    scripts = JSON.parse(out) as Record<string, string>;
  } catch {
    return null;
  }
  const names = Object.keys(scripts);
  if (!names.length) {
    return null;
  }
  const likely = names.filter((n) => /^(dev|start|serve|develop|watch)$/i.test(n));
  const quick = await vscode.window.showQuickPick(
    names.map((n) => ({
      label: n,
      description: scripts[n],
      picked: likely.includes(n)
    })),
    { placeHolder: likely[0] ? `Go Live (default: ${likely[0]})` : 'Choose a script to run' }
  );
  return quick?.label ?? likely[0] ?? names[0];
}
