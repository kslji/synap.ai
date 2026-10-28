/**
 * Surf branded welcome / empty-state page.
 *
 * A single webview tab that opens on the very first launch when no folder is
 * present (and any time the user runs `Surf AI: Show Welcome`). It is the
 * on-ramp a production editor needs: start a file, open or clone a project,
 * connect GitHub, or jump straight into the chat — without leaving the window.
 *
 * Surf branding only; it drives VS Code's own commands for every action so
 * there is no duplicated behaviour to drift.
 */

import * as vscode from 'vscode';

const SUPPRESS_KEY = 'surf-ai.welcome.suppress';

let openPanel: vscode.WebviewPanel | undefined;

export function registerWelcome(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('surf-ai.showWelcome', () => showWelcome(context))
  );
  // First run in a bare window (no folder) shows the welcome once, the way a
  // real IDE opens on a home tab rather than a blank grid.
  void maybeShowWelcome(context);
}

async function maybeShowWelcome(context: vscode.ExtensionContext): Promise<void> {
  if (vscode.workspace.workspaceFolders?.length) {
    return;
  }
  if (context.globalState.get<boolean>(SUPPRESS_KEY)) {
    return;
  }
  showWelcome(context);
}

function showWelcome(context: vscode.ExtensionContext): void {
  if (openPanel) {
    openPanel.reveal(vscode.ViewColumn.One);
    return;
  }
  const panel = vscode.window.createWebviewPanel(
    'surfWelcome',
    'Surf IDE',
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true }
  );
  openPanel = panel;
  panel.webview.html = welcomeHtml(panel.webview, context.extensionUri);
  panel.onDidDispose(() => { openPanel = undefined; });
  panel.webview.onDidReceiveMessage(async (m) => {
    switch (m?.command) {
      case 'newFile': await vscode.commands.executeCommand('newUntitledFile'); break;
      case 'open': await vscode.commands.executeCommand('vscode.openFolder'); break;
      case 'openPath':
        if (typeof m.path === 'string') {
          await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(m.path));
        }
        break;
      case 'clone': await vscode.commands.executeCommand('git.clone'); break;
      case 'chat': await vscode.commands.executeCommand('surf-ai.openChat'); break;
      case 'github': await vscode.commands.executeCommand('surf-ai.githubSignIn'); break;
      case 'donotshow': await context.globalState.update(SUPPRESS_KEY, true); break;
    }
  });
}

function cspSource(webview: vscode.Webview, uri: vscode.Uri): string {
  return webview.asWebviewUri(uri).toString();
}

function welcomeHtml(webview: vscode.Webview, base: vscode.Uri): string {
  const icon = cspSource(webview, vscode.Uri.joinPath(base, 'media', 'icon.svg'));
  const recent = (vscode.workspace.workspaceFolders || [])
    .map((f) => f.uri.fsPath).slice(0, 3);
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'unsafe-inline';" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
  :root { color-scheme: dark; }
  html, body { margin: 0; height: 100%; font-family: -apple-system, "Segoe UI", Roboto, sans-serif;
    color: var(--vscode-foreground, #e6e6e6); background: var(--vscode-editor-background, #14161b); }
  .wrap { max-width: 960px; margin: 0 auto; padding: 64px 40px; }
  .brand { display: flex; align-items: center; gap: 14px; margin-bottom: 6px; }
  .brand img { width: 40px; height: 40px; }
  .brand h1 { font-size: 30px; font-weight: 700; margin: 0; letter-spacing: -0.5px; }
  .tag { color: var(--vscode-descriptionForeground, #9aa0aa); font-size: 15px; margin: 0 0 40px 54px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 44px; }
  .col h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 1px;
    color: var(--vscode-descriptionForeground, #8a8f98); margin: 0 0 14px; }
  .act { display: flex; align-items: center; gap: 12px; width: 100%; text-align: left;
    background: transparent; border: 0; color: inherit; cursor: pointer;
    padding: 10px 12px; border-radius: 8px; font-size: 14px; }
  .act:hover { background: var(--vscode-list-hoverBackground, #23262d); }
  .act .k { font-size: 18px; width: 22px; text-align: center; }
  .foot { margin-top: 48px; display: flex; align-items: center; justify-content: space-between;
    font-size: 13px; color: var(--vscode-descriptionForeground, #8a8f98); }
  .recent code { font-size: 12px; }
  label { display: inline-flex; gap: 8px; align-items: center; cursor: pointer; }
</style></head>
<body>
  <div class="wrap">
    <div class="brand"><img src="${icon}" alt="Surf" /><h1>Surf IDE</h1></div>
    <p class="tag">On-device and cloud AI coding. Start building — everything else stays on this machine.</p>
    <div class="grid">
      <div class="col">
        <h2>Start</h2>
        <button class="act" data-c="newFile"><span class="k">📄</span> New File…</button>
        <button class="act" data-c="open"><span class="k">📂</span> Open Folder…</button>
        <button class="act" data-c="clone"><span class="k">⎇</span> Clone Git Repository…</button>
        <button class="act" data-c="github"><span class="k">🐙</span> Connect to GitHub…</button>
      </div>
      <div class="col">
        <h2>Assistant</h2>
        <button class="act" data-c="chat"><span class="k">💬</span> Open Surf Chat</button>
        ${recent.length ? `<h2>Recent</h2><div class="recent">` +
          recent.map((p) => `<button class="act" data-open="${encodeURIComponent(p)}"><span class="k">🕘</span><code>${p.split(/[\\\\/]/).pop()}</code></button>`).join('') +
          `</div>` : ''}
      </div>
    </div>
    <div class="foot">
      <label><input type="checkbox" id="dontshow" /> Don't show this page again</label>
      <span>Surf IDE</span>
    </div>
  </div>
  <script nonce="">
    const vscode = acquireVsCodeApi();
    document.querySelectorAll('[data-c]').forEach((b) =>
      b.addEventListener('click', () => vscode.postMessage({ command: b.getAttribute('data-c') })));
    document.querySelectorAll('[data-open]').forEach((b) =>
      b.addEventListener('click', () => vscode.postMessage({ command: 'openPath', path: decodeURIComponent(b.getAttribute('data-open')) })));
    document.getElementById('dontshow').addEventListener('change', (e) => {
      if (e.target.checked) { vscode.postMessage({ command: 'donotshow' }); }
    });
  </script>
</body></html>`;
}
