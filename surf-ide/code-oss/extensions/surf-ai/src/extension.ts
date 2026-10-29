/**
 * Surf AI Extension - Main Entry Point
 * 
 * AI-powered coding assistant with offline + online modes
 */

import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { ChatSidebarProvider } from './chat-sidebar';
import { GatewayClient } from './gateway-client';
import { LocalModelClient } from './local-model-client';
import { MODE_STATE_KEY, resolveRoute, type SurfMode } from './model-router';
import { buildFimPrompt, sanitizeFimCompletion, fimCacheKey, LruCache, FIM_STOP_TOKENS, FIM_MAX_TOKENS } from './fim';
import { fileChip, selectionChip, gitChip, problemsChip, type ContextChip, type ProblemItem, type SelectionInfo } from './context-chips';
import type { ProposedEdit } from './edit-proposal';
import { initSurfStatusBar } from './surf-status';
import { registerWelcome } from './welcome';
import { registerGitHubCommands } from './github';

const execFileAsync = promisify(execFile);

export async function activate(context: vscode.ExtensionContext) {
  console.log('Surf AI extension activated');
  activeContext = context;

  // The Surf desktop app launches this fork with a short-lived gateway JWT in
  // SURF_GATEWAY_TOKEN. Persist it into extension secrets so the gateway client
  // (which reads `surf-ai.authToken`) is authenticated for this session. The
  // base URL is read live from SURF_GATEWAY_BASE_URL / settings, so it is not stored.
  const bootToken = process.env.SURF_GATEWAY_TOKEN;
  if (bootToken && bootToken.trim()) {
    context.secrets.store('surf-ai.authToken', bootToken.trim()).then(
      () => console.log('Surf AI: gateway token stored'),
      (err) => console.error('Surf AI: failed to store gateway token', err)
    );
  }

  // Open clean: no Welcome/getting-started tab, and keep the built-in chat
  // surfaces out of the way so Surf AI is the only assistant the user sees.
  void applySurfDefaults();

  // The IDE chrome a production editor needs: a Surf status bar (engine +
  // throughput + Go Live), a branded welcome tab, and GitHub push / PR commands.
  initSurfStatusBar(context);
  registerWelcome(context);
  registerGitHubCommands(context);

  // Register chat sidebar with new Qoder-like UI
  const chatProvider = new ChatSidebarProvider(context.extensionUri, context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('surf-ai.chat', chatProvider),
    chatProvider.review
  );

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('surf-ai.openChat', async () => {
      // The chat lives in the secondary side bar, so revealing the view also
      // un-hides that bar when the user has closed it.
      await vscode.commands.executeCommand('workbench.view.extension.surf-ai');
      await vscode.commands.executeCommand('workbench.action.focusAuxiliaryBar');
    })
  );

  // Accept/Reject in the diff title bar act on the proposal behind the tab the
  // user is reading. Whether they are shown at all follows the active tab, so a
  // git diff never grows Surf buttons that would do nothing.
  const syncReviewState = () => {
    void vscode.commands.executeCommand(
      'setContext',
      'surf.reviewingProposal',
      chatProvider.review.activeReviewId() !== null
    );
  };
  context.subscriptions.push(
    vscode.window.tabGroups.onDidChangeTabs(syncReviewState),
    vscode.window.tabGroups.onDidChangeTabGroups(syncReviewState),
    vscode.commands.registerCommand('surf-ai.acceptProposal', () => {
      if (!chatProvider.review.resolveActive(true)) {
        void vscode.window.showInformationMessage('Surf: open a Surf proposal diff first.');
      }
    }),
    vscode.commands.registerCommand('surf-ai.rejectProposal', () => {
      chatProvider.review.resolveActive(false);
    })
  );
  syncReviewState();

  // Open the chat beside the editor on the first launch only, the way Cursor and
  // Qoder start; after that the layout belongs to the user.
  void revealChatOnce(context);

  // The editor commands focus the chat and start the turn immediately, attaching
  // the selection and/or diagnostics as context chips — no more toast stubs.
  context.subscriptions.push(
    vscode.commands.registerCommand('surf-ai.askQuestion', async () => {
      const question = await vscode.window.showInputBox({
        prompt: 'Ask Surf AI a question',
        placeHolder: 'How do I fix this error?'
      });
      if (!question) {
        return;
      }
      const chips = await chipsForActiveFile();
      await chatProvider.submitTurn(question, { chips, agent: false });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('surf-ai.explainSelection', async () => {
      const sel = await activeSelectionInfo();
      if (!sel) {
        vscode.window.showErrorMessage('No text selected');
        return;
      }
      await chatProvider.submitTurn('Explain this selection: what it does, why it is written this way, and what to watch out for.', {
        chips: [selectionChip(sel)],
        agent: false
      });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('surf-ai.fixErrors', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage('No active editor');
        return;
      }
      const uri = editor.document.uri;
      const rel = relPath(uri);
      const problems = vscode.languages.getDiagnostics(uri);
      const chips: ContextChip[] = [];
      const selection = await activeSelectionInfo();
      if (selection) {
        chips.push(selectionChip(selection));
      } else {
        const contents = editor.document.getText();
        chips.push(fileChip(rel, contents.length > 24_000 ? contents.slice(0, 24_000) + '\n…truncated…' : contents));
      }
      if (problems.length) {
        chips.push(problemsChip(problems.map((d) => ({
          path: rel,
          line: d.range.start.line + 1,
          message: d.message,
          severity: d.severity === vscode.DiagnosticSeverity.Error ? 'error' as const : 'warning' as const
        }))));
      }
      await chatProvider.submitTurn('Fix the errors in this code. Propose reviewable edits, then check diagnostics again.', {
        chips,
        agent: true
      });
    })
  );

  // Cmd+K (Ctrl+K elsewhere): Cursor-style inline edit. The instruction is
  // asked up front, the replacement is streamed against the active backend,
  // and the result lands in DiffReview for one-click Accept/Reject.
  context.subscriptions.push(
    vscode.commands.registerCommand('surf-ai.inlineEdit', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage('Surf: open a file and place the cursor on the code to edit.');
        return;
      }
      // No selection: take the current line, expanded to the enclosing
      // bracket-balanced block when the line ends in `{`.
      const range = editor.selection.isEmpty
        ? expandEditScope(editor.document, editor.selection.active)
        : editor.selection;
      const selectedText = editor.document.getText(range);
      if (!selectedText.trim()) {
        vscode.window.showErrorMessage('Surf: nothing meaningful to edit at the cursor.');
        return;
      }
      const instruction = await vscode.window.showInputBox({
        prompt: 'Describe the edit (Cmd+K)',
        placeHolder: 'e.g. make this async, add error handling, rename to snake_case'
      });
      if (!instruction) {
        return;
      }
      const file = editor.document.uri.fsPath;
      const rel = relPath(editor.document.uri);
      const system = 'You are Surf, an inline code editor. Reply with ONLY the replacement for the given code — no explanations, no markdown fences. Keep the original indentation and style.';
      const user = `File: ${rel} (lines ${range.start.line + 1}-${range.end.line + 1})\nInstruction: ${instruction}\n\nCode to replace:\n${selectedText}`;
      const progress = vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Surf is editing ${rel}…` },
        async (_step, token) => {
          const controller = new AbortController();
          const cancel = token.onCancellationRequested(() => controller.abort());
          try {
            const reply = await streamFromActiveModel(
              [{ role: 'system', content: system }, { role: 'user', content: user }],
              controller.signal
            );
            const replacement = unwrapFence(reply);
            if (!replacement.trim()) {
              void vscode.window.showWarningMessage('Surf: the model returned no replacement.');
              return;
            }
            const edit: ProposedEdit = {
              file,
              relPath: rel,
              search: selectedText,
              replace: replacement,
              isNewFile: false,
            };
            await chatProvider.offerInlineProposal(edit);
          } catch (error) {
            if ((error as Error)?.name !== 'AbortError') {
              void vscode.window.showErrorMessage(`Surf inline edit: ${(error as Error).message}`);
            }
          } finally {
            cancel.dispose();
          }
        }
      );
      void progress;
    })
  );

  // The sidebar's + picker asks which kind of context to attach, then calls
  // here to build the actual chip from live editor/workspace state.
  context.subscriptions.push(
    vscode.commands.registerCommand('surf-ai.contextPickerBuild', async (kind: unknown): Promise<ContextChip | null> => {
      return buildContextChip(String(kind));
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('surf-ai.backToLobby', async () => {
      // Return to the Surf desktop lobby: deep-link the desktop app to the
      // front (handled by its synap:// protocol), then close this IDE window.
      await vscode.env.openExternal(vscode.Uri.parse('synap://lobby'));
      await vscode.commands.executeCommand('workbench.action.closeWindow');
    })
  );

  const backItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  backItem.text = '$(arrow-left) Back to Lobby';
  backItem.tooltip = 'Return to the Surf desktop home';
  backItem.command = 'surf-ai.backToLobby';
  backItem.show();
  context.subscriptions.push(backItem);

  // Register inline completion provider
  const completionProvider = new SurfInlineCompletionProvider(context);
  context.subscriptions.push(
    vscode.languages.registerInlineCompletionItemProvider(
      { pattern: '**' },
      completionProvider
    )
  );

  vscode.window.showInformationMessage('Surf AI is ready! 🏄');
}

export function deactivate() {
  console.log('Surf AI extension deactivated');
}

/** The workspace-relative path used on every chip and edit label. */
function relPath(uri: vscode.Uri): string {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (root && uri.fsPath.startsWith(root)) {
    return uri.fsPath.slice(root.length).replace(/^[\\/]+/, '');
  }
  return uri.fsPath;
}

async function activeSelectionInfo(): Promise<SelectionInfo | null> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.selection.isEmpty) {
    return null;
  }
  return {
    relPath: relPath(editor.document.uri),
    startLine: editor.selection.start.line + 1,
    endLine: editor.selection.end.line + 1,
    text: editor.document.getText(editor.selection),
  };
}

/** The active file's contents plus its diagnostics, as chips for a turn. */
async function chipsForActiveFile(): Promise<ContextChip[]> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return [];
  }
  const chips: ContextChip[] = [];
  const rel = relPath(editor.document.uri);
  const contents = editor.document.getText();
  chips.push(fileChip(rel, contents.length > 24_000 ? contents.slice(0, 24_000) + '\n…truncated…' : contents));
  const diagnostics = vscode.languages.getDiagnostics(editor.document.uri);
  if (diagnostics.length) {
    chips.push(problemsChip(diagnostics.map((d) => ({
      path: rel,
      line: d.range.start.line + 1,
      message: d.message,
      severity: d.severity === vscode.DiagnosticSeverity.Error ? 'error' as const : 'warning' as const
    }))));
  }
  return chips;
}

/**
 * Expand the cursor's line into the enclosing block when the line opens a
 * brace (Cursor takes the whole function); otherwise the single line.
 */
function expandEditScope(doc: vscode.TextDocument, position: vscode.Position): vscode.Range {
  const line = doc.lineAt(position.line);
  if (!line.text.trimEnd().endsWith('{')) {
    return new vscode.Range(position.line, 0, position.line, line.text.length);
  }
  let depth = 0;
  let end = position.line;
  for (let i = position.line; i < doc.lineCount; i++) {
    const text = doc.lineAt(i).text;
    for (const ch of text) {
      if (ch === '{') { depth++; }
      if (ch === '}') { depth--; }
    }
    end = i;
    if (depth <= 0) { break; }
  }
  const indent = /^[ \t]*/.exec(line.text)?.[0] ?? '';
  let start = position.line;
  for (let i = position.line - 1; i >= 0; i--) {
    const prev = doc.lineAt(i);
    if (prev.text.trim() === '') { continue; }
    if (prev.text.startsWith(indent) && /^[^\s]/.test(prev.text) && !prev.text.trimEnd().endsWith('{') && !prev.text.trimEnd().endsWith('(') && !prev.text.trimEnd().endsWith(',')) {
      start = i;
      continue;
    }
    break;
  }
  return new vscode.Range(start, 0, end, doc.lineAt(end).text.length);
}

/** Strip a single surrounding code fence if the model added one anyway. */
function unwrapFence(text: string): string {
  const m = /^```[^\n]*\n([\s\S]*?)\n?```\s*$/.exec(text.trim());
  return (m ? m[1] : text).replace(/\s+$/, '') + (text.endsWith('\n') ? '\n' : '');
}

/** Route by the stored mode (the same contract model-router gives chat). */
async function streamFromActiveModel(turns: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>, signal: AbortSignal): Promise<string> {
  const context = activeContext;
  if (!context) {
    throw new Error('Surf AI is not initialised.');
  }
  const gateway = new GatewayClient(context);
  const local = new LocalModelClient();
  const mode: SurfMode = context.workspaceState.get<SurfMode>(MODE_STATE_KEY) === 'online' ? 'online' : 'offline';
  const route = await resolveRoute(mode, gateway, local);
  if (route === 'online') {
    const models = await gateway.listModels();
    const model = models.find((m) => !m.locked)?.id;
    if (!model) {
      throw new Error('No unlocked cloud model is available.');
    }
    return gateway.chatStream(model, turns, {}, { signal, enableThinking: false });
  }
  const bridge = await local.listModels();
  const model = bridge[0]?.id;
  if (!model) {
    throw new Error('No local model is running. Load one in Surf.');
  }
  return local.chatStream(model, turns, {}, { signal, enableThinking: false });
}

/** Keep the ExtensionContext reachable from the command handlers above. */
let activeContext: vscode.ExtensionContext | undefined;

async function buildContextChip(kind: string): Promise<ContextChip | null> {
  const root = vscode.workspace.workspaceFolders?.[0];
  switch (kind) {
    case 'file': {
      if (!root) { return null; }
      const files = await vscode.workspace.findFiles('**/*', '**/{node_modules,.git,.build,out,dist}/**', 500);
      const picked = await vscode.window.showQuickPick(
        files.map((f) => ({ label: relPath(f), description: f.fsPath === vscode.window.activeTextEditor?.document.uri.fsPath ? 'active' : '', uri: f })),
        { placeHolder: 'Attach a workspace file' }
      );
      if (!picked) { return null; }
      try {
        const doc = await vscode.workspace.openTextDocument(picked.uri);
        return fileChip(picked.label, doc.getText());
      } catch {
        return null;
      }
    }
    case 'selection': {
      const sel = await activeSelectionInfo();
      return sel ? selectionChip(sel) : null;
    }
    case 'git': {
      if (!root) { return null; }
      const cwd = root.uri.fsPath;
      let status = '';
      let diff = '';
      try {
        status = (await execFileAsync('git', ['status', '--short'], { cwd })).stdout;
        diff = (await execFileAsync('git', ['diff', 'HEAD'], { cwd, maxBuffer: 4 * 1024 * 1024 })).stdout;
      } catch (error) {
        void vscode.window.showWarningMessage(`Surf: git is unavailable here (${(error as Error).message}).`);
        return null;
      }
      return gitChip(status, diff);
    }
    case 'problems': {
      const items: ProblemItem[] = [];
      for (const [uri, diags] of vscode.languages.getDiagnostics()) {
        if (uri.scheme !== 'file') { continue; }
        for (const d of diags) {
          items.push({
            path: relPath(uri),
            line: d.range.start.line + 1,
            message: d.message,
            severity: d.severity === vscode.DiagnosticSeverity.Error ? 'error' : 'warning'
          });
        }
      }
      return problemsChip(items);
    }
    default:
      return null;
  }
}

/**
 * Apply Surf-friendly defaults, but only where the user has not chosen a value
 * themselves, so we never stomp an explicit setting.
 */
async function applySurfDefaults(): Promise<void> {
  const setIfUnset = async (section: string, key: string, value: unknown): Promise<void> => {
    const cfg = vscode.workspace.getConfiguration(section);
    const inspected = cfg.inspect(key);
    const alreadySet = Boolean(
      inspected &&
      (inspected.workspaceFolderValue !== undefined ||
        inspected.workspaceValue !== undefined ||
        inspected.globalValue !== undefined)
    );
    if (!alreadySet) {
      try {
        await cfg.update(key, value, vscode.ConfigurationTarget.Global);
      } catch { /* ignore a rejected config write */ }
    }
  };
  await setIfUnset('workbench', 'startupEditor', 'none');
  // The chat panel is docked on the right; a workspace should show it without the
  // user having to find it first, which is what this default already means.
  await setIfUnset('workbench', 'secondarySideBar.defaultVisibility', 'visibleInWorkspace');
  await setIfUnset('chat', 'commandCenter.enabled', false);
  await setIfUnset('chat', 'detectParticipant.enabled', false);
  // Hiding VS Code's own Chat view is deliberately NOT done here: `chat.disableAIFeatures`
  // is registered as a default in the fork (surf-ide/fork-setup.mjs) instead, because
  // flipping it mid-session makes the workbench re-register its views and takes the
  // Surf AI view with them.
}

/**
 * Show the Surf chat the first time a folder is opened in this install. Each
 * later window keeps whatever layout the user left behind, so a deliberate
 * close is not undone on the next launch.
 */
async function revealChatOnce(context: vscode.ExtensionContext): Promise<void> {
  if (!vscode.workspace.workspaceFolders?.length) {
    return;
  }
  if (context.globalState.get<boolean>('surf-ai.chatRevealed')) {
    return;
  }
  await context.globalState.update('surf-ai.chatRevealed', true);
  try {
    await vscode.commands.executeCommand('workbench.view.extension.surf-ai');
  } catch {
    // A disposed window during startup is not worth surfacing.
  }
}

/**
 * Inline completion provider (ghost text).
 *
 * Fast FIM against the local completion endpoint: ChatML prefix/middle/suffix
 * prompt, `enable_thinking: false`, 96-token headroom, the FIM stop tokens, a
 * 150ms debounce, CancellationToken plumbed to the fetch, and a small LRU so a
 * repeated context renders without a model call. Online mode sends the same FIM
 * prompt through the gateway's single-turn chat.
 */
class SurfInlineCompletionProvider implements vscode.InlineCompletionItemProvider {
  private readonly gateway: GatewayClient;
  private readonly local: LocalModelClient;
  private readonly context: vscode.ExtensionContext;
  private onlineModel: string | null = null;
  private debounce: ReturnType<typeof setTimeout> | undefined;
  private pending: Promise<vscode.InlineCompletionItem[]> | null = null;
  private readonly cache = new LruCache<string, string>(64);

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.gateway = new GatewayClient(context);
    this.local = new LocalModelClient();
  }

  provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionItem[]> {
    if (this.debounce) {
      clearTimeout(this.debounce);
    }
    this.pending = new Promise<vscode.InlineCompletionItem[]>((resolve) => {
      const settle = () => resolve([]);
      token.onCancellationRequested(settle);
      this.debounce = setTimeout(() => {
        void (async () => {
          if (token.isCancellationRequested) {
            resolve([]);
            return;
          }
          try {
            const prefix = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
            const suffix = document.getText(new vscode.Range(position, new vscode.Position(document.lineCount, 0)));
            const req = { prefix, suffix };
            const key = fimCacheKey(document.uri.toString(), position.line, position.character, req);
            const hit = this.cache.get(key);
            if (hit !== undefined) {
              resolve(hit ? [{ insertText: hit, range: new vscode.Range(position, position) }] : []);
              return;
            }
            const prompt = buildFimPrompt(req);
            const mode: SurfMode = this.context.workspaceState.get<SurfMode>(MODE_STATE_KEY) === 'online' ? 'online' : 'offline';
            const route = await resolveRoute(mode, this.gateway, this.local);
            let completion = '';
            if (route === 'offline') {
              completion = await this.local.complete(prompt, {
                signal: abrsFrom(token),
                stop: FIM_STOP_TOKENS,
                maxTokens: FIM_MAX_TOKENS,
                enableThinking: false,
              });
            } else {
              const model = await this.pickOnlineModel();
              if (!model) {
                resolve([]);
                return;
              }
              completion = await this.gateway.chatStream(
                model,
                [{ role: 'user', content: prompt }],
                {},
                { signal: abrsFrom(token), enableThinking: false }
              );
            }
            const cleaned = sanitizeFimCompletion(completion);
            this.cache.set(key, cleaned);
            if (token.isCancellationRequested) {
              resolve([]);
              return;
            }
            resolve(cleaned ? [{ insertText: cleaned, range: new vscode.Range(position, position) }] : []);
          } catch {
            resolve([]);
          }
        })();
      }, 150);
    });
    return this.pending;
  }

  /** The first model this account has unlocked, cached. Null when none are available. */
  private async pickOnlineModel(): Promise<string | null> {
    if (this.onlineModel) {
      return this.onlineModel;
    }
    try {
      const models = await this.gateway.listModels();
      // Ghost text fires constantly, so it must never pick a model the tier gate will
      // 403 on: the first unlocked one, not simply the first one (ADR 0008).
      this.onlineModel = (models.find((m) => !m.locked) ?? models[0])?.id ?? null;
    } catch {
      this.onlineModel = null;
    }
    return this.onlineModel;
  }
}

/** Bridge a vscode CancellationToken onto the AbortSignal fetch() expects. */
function abrsFrom(token: vscode.CancellationToken): AbortSignal {
  const controller = new AbortController();
  if (token.isCancellationRequested) {
    controller.abort();
  } else {
    token.onCancellationRequested(() => controller.abort());
  }
  return controller.signal;
}
