/**
 * Chat Sidebar Provider
 * 
 * Creates a chat panel that looks like Qoder/Cursor
 * - Clean, modern UI
 * - Integrated with VSCode theme
 * - Supports markdown rendering
 * - Code block highlighting
 * - Context indicators
 */

import * as vscode from 'vscode';
import { extractContext, buildPromptWithContext } from './context-extractor';
import { GatewayClient, ModelLockedError, type GatewayBalance, type GatewayModel } from './gateway-client';
import { LocalModelClient, type LocalModel } from './local-model-client';
import { parseEdits, applyEdit, editDiff, type ProposedEdit } from './edit-proposal';
import { DiffReview } from './diff-review';
import { MODE_STATE_KEY, resolveRoute, onlineReachable, invalidateReachability, type SurfMode } from './model-router';

// Teaches the model to emit reviewable, line-level edits instead of whole-file prose.
const EDIT_INSTRUCTIONS = `

## Editing files
When you want to change code, do NOT rewrite whole files in prose. Instead emit one fenced
block per edit using this exact format (valid JSON inside):

\`\`\`SURF_EDIT
{ "file": "relative/path/from/project/root", "search": "the exact existing lines to replace", "replace": "the new lines" }
\`\`\`

Rules:
- "search" must match existing file text EXACTLY (including whitespace) so it can be applied.
- To delete lines, set "replace" to "".
- To add lines, put an anchor line in "search" and the anchor plus the new lines in "replace".
- To create a new file, give its path, set "search" to "" and "replace" to the full contents.
- You may emit several SURF_EDIT blocks. Keep all other text as a short explanation.
- If no change is needed, do not emit any SURF_EDIT block.`;

export class ChatSidebarProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private _messageHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  private _isProcessing = false;
  private readonly _client: GatewayClient;
  private readonly _local: LocalModelClient;
  private _models: GatewayModel[] = [];
  private _selectedModel: string | null = null;
  private _balance: GatewayBalance | null = null;
  private _localModels: LocalModel[] = [];
  private _selectedLocal: string | null = null;
  private _mode: SurfMode = 'offline';
  private _pendingEdits = new Map<string, ProposedEdit>();
  private _statusTimer: NodeJS.Timeout | undefined;
  private _egress = 0;
  /** Side-by-side review of the pending proposals, owned here so the tabs and the cards agree. */
  public readonly review: DiffReview;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _context: vscode.ExtensionContext
  ) {
    this._client = new GatewayClient(_context);
    this._local = new LocalModelClient();
    this.review = new DiffReview((id, accepted) => {
      if (accepted) {
        void this._applyEdits([id]);
      } else {
        this._rejectEdits([id]);
      }
    });
    const saved = _context.workspaceState.get<SurfMode>(MODE_STATE_KEY);
    if (saved === 'online' || saved === 'offline') {
      this._mode = saved;
    }
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.onDidDispose(() => {
      if (this._statusTimer) {
        clearInterval(this._statusTimer);
        this._statusTimer = undefined;
      }
      this._view = undefined;
    });

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri]
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // Handle messages from webview
    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case 'sendMessage':
          await this._handleUserMessage(data.value);
          break;
        case 'clearChat':
          this._clearChat();
          break;
        case 'closePanel':
          // The chat is docked in the secondary side bar, which is the right-hand
          // panel; closing the primary sidebar would leave the chat where it is.
          await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
          break;
        case 'copyMessage':
          vscode.env.clipboard.writeText(data.value);
          vscode.window.showInformationMessage('Copied to clipboard');
          break;
        case 'selectModel':
          this._selectedModel = data.value;
          break;
        case 'selectLocalModel':
          this._selectedLocal = data.value;
          break;
        case 'setMode':
          if (data.value === 'online' || data.value === 'offline') {
            this._mode = data.value;
            void this._context.workspaceState.update(MODE_STATE_KEY, this._mode);
            invalidateReachability(this._client);
            if (this._mode === 'online') {
              void this._loadModels();
              this._startStatusTimer();
            } else {
              // Offline: no gateway model list, no background ping, no probes.
              void this._loadLocalModels();
              this._stopStatusTimer();
            }
            void this._pushNetStatus();
          }
          break;
        case 'backToLobby':
          await vscode.commands.executeCommand('surf-ai.backToLobby');
          break;
        case 'applyEdits':
          await this._applyEdits(data.ids);
          break;
        case 'rejectEdits':
          this._rejectEdits(data.ids);
          break;
        case 'openDiff':
          await this._openDiff(data.value);
          break;
        case 'openTopUp':
          await this._openTopUp(data.modelId);
          break;
      }
    });

    // Send welcome message
    this._sendWelcomeMessage();
    this._postMessage({ type: 'mode', mode: this._mode });
    if (this._mode === 'online') {
      void this._loadModels();
    }
    void this._loadLocalModels();
    void this._pushNetStatus();
    if (this._mode === 'online') {
      void this._loadBalance();
    }
    this._startStatusTimer();
  }

  /** The 8s status ping runs only while Online is active; Offline makes zero network requests. */
  private _startStatusTimer() {
    if (this._statusTimer || this._mode !== 'online') {
      return;
    }
    this._statusTimer = setInterval(() => { void this._pushNetStatus(); }, 8000);
  }

  private _stopStatusTimer() {
    if (this._statusTimer) {
      clearInterval(this._statusTimer);
      this._statusTimer = undefined;
    }
  }

  /** Tell the webview whether the gateway is reachable, to drive the Online status dot. */
  private async _pushNetStatus() {
    if (this._mode === 'offline') {
      // Never probe in Offline; report the state from the mode itself.
      this._postMessage({ type: 'netStatus', online: false, egress: this._egress });
      return;
    }
    const online = await onlineReachable(this._client);
    this._postMessage({ type: 'netStatus', online, egress: this._egress });
  }

  private async _loadModels() {
    try {
      this._models = await this._client.listModels();
      // Default to the best model the account has actually bought. A trial lands on
      // the Tier 0 economy model rather than a locked one it cannot call.
      if (!this._selectedModel || !this._models.some((m) => m.id === this._selectedModel && !m.locked)) {
        this._selectedModel = (this._models.find((m) => !m.locked) ?? this._models[0])?.id ?? null;
      }
      this._postMessage({ type: 'models', models: this._models, selected: this._selectedModel });
      void this._loadBalance();
    } catch (error) {
      this._postMessage({ type: 'models', models: [], selected: null, error: (error as Error).message });
    }
  }

  /** Refresh the credit/tier pill. Null reads as "unknown", never as zero. */
  private async _loadBalance() {
    this._balance = await this._client.balance();
    this._postMessage({ type: 'balance', balance: this._balance });
  }

  /**
   * The unlock path. A locked model and an empty wallet both lead here, so buying
   * credits is one click from wherever the user hit the limit. Surf's checkout is not
   * open yet, so the account page states what a top-up costs rather than pretending
   * to take payment - the IDE's job is to get the user to the right place with the
   * right number in hand.
   */
  private async _openTopUp(modelId?: string): Promise<void> {
    const locked = modelId ? this._models.find((m) => m.id === modelId) : undefined;
    const owned = this._balance ? ` You have ${this._balance.credits} credit(s) left.` : '';
    const detail = locked
      ? `${locked.label} needs a ${locked.min_credits}-credit tier ($${locked.unlock_usd}).${owned}`
      : `Online Cloud models need credits.${owned}`;
    const target = vscode.Uri.parse(this._client.topUpUrl());
    const chosen = await vscode.window.showInformationMessage(`Surf: ${detail}`, 'Open the Surf account page');
    if (chosen) {
      await vscode.env.openExternal(target);
    }
  }

  private async _loadLocalModels() {
    this._localModels = await this._local.listModels();
    if (this._localModels.length > 0 && !this._selectedLocal) {
      this._selectedLocal = this._localModels[0].id;
    }
    this._postMessage({ type: 'localModels', models: this._localModels, selected: this._selectedLocal });
  }

  private async _handleUserMessage(message: string) {
    if (this._isProcessing) {
      return;
    }
    const route = await resolveRoute(this._mode, this._client, this._local);
    const offline = route === 'offline';
    if (offline) {
      if (!this._selectedLocal) {
        await this._loadLocalModels();
      }
      if (!this._selectedLocal) {
        this._postMessage({
          type: 'addMessage',
          role: 'assistant',
          content: '⚠️ No local model is running. Load one in Surf and switch to Offline Mode, or switch to Online Cloud for gateway models.'
        });
        return;
      }
    } else {
      if (!this._selectedModel) {
        await this._loadModels();
      }
      if (!this._selectedModel) {
        this._postMessage({
          type: 'addMessage',
          role: 'assistant',
          content: '⚠️ No cloud models are reachable right now. Load a local model in Surf and switch to Offline, or reconnect for cloud.'
        });
        return;
      }
    }

    this._isProcessing = true;
    this._messageHistory.push({ role: 'user', content: message });
    this._postMessage({ type: 'addMessage', role: 'user', content: message });
    this._postMessage({ type: 'showTyping' });

    try {
      const context = await extractContext();
      const prompt = buildPromptWithContext(message, context) + EDIT_INSTRUCTIONS;
      if (!offline) {
        this._egress += 1;
        void this._pushNetStatus();
      }
      const response = offline
        ? await this._local.chat(this._selectedLocal as string, prompt)
        : await this._client.chat(this._selectedModel as string, prompt);
      const { prose, edits } = parseEdits(response);

      this._messageHistory.push({ role: 'assistant', content: prose || response });
      this._postMessage({ type: 'addMessage', role: 'assistant', content: prose || 'Done.' });

      if (edits.length > 0) {
        const payload = edits.map((edit) => {
          const id = this._newId();
          this._pendingEdits.set(id, edit);
          const { removed, added } = editDiff(edit);
          return { id, file: edit.relPath, isNewFile: edit.isNewFile, removed, added };
        });
        this._postMessage({ type: 'proposeEdits', edits: payload });
      }
    } catch (error) {
      if (error instanceof ModelLockedError) {
        // The tier gate answered mid-turn (the picker normally prevents it). Say what
        // unlocks it and put the unlock one click away, instead of a bare ❌ Error.
        this._postMessage({
          type: 'modelLocked',
          content: `${error.modelId} is a ${error.requiredCredits}-credit model. A $${error.unlockUsd} top-up unlocks it.`,
          modelId: error.modelId
        });
        return;
      }
      this._postMessage({
        type: 'addMessage',
        role: 'assistant',
        content: `❌ Error: ${(error as Error).message}`
      });
    } finally {
      this._isProcessing = false;
      this._postMessage({ type: 'hideTyping' });
      // A settled turn changed the wallet, so the credit pill is never a turn stale.
      if (!offline) {
        void this._loadBalance();
      }
    }
  }

  private async _applyEdits(ids: string | string[]) {
    const list = Array.isArray(ids) ? ids : [ids];
    for (const id of list) {
      const edit = this._pendingEdits.get(id);
      if (!edit) {
        continue;
      }
      try {
        await applyEdit(edit);
        this._pendingEdits.delete(id);
        this._postMessage({ type: 'editResolved', id, applied: true });
        await this.review.close(id);
      } catch (error) {
        vscode.window.showErrorMessage(`Surf: ${(error as Error).message}`);
      }
    }
  }

  private _rejectEdits(ids: string | string[]) {
    const list = Array.isArray(ids) ? ids : [ids];
    for (const id of list) {
      if (this._pendingEdits.delete(id)) {
        this._postMessage({ type: 'editResolved', id, applied: false });
        void this.review.close(id);
      }
    }
  }

  /** Show the proposal as a real before/after diff beside the editor. */
  private async _openDiff(id: string): Promise<void> {
    const edit = this._pendingEdits.get(id);
    if (!edit) {
      return;
    }
    if (!(await this.review.open(id, edit))) {
      this._postMessage({
        type: 'addMessage',
        role: 'assistant',
        content: `\u26a0\ufe0f ${edit.relPath} changed since this proposal was written, so there is nothing safe to diff. Ask again and I will re-read the file.`
      });
    }
  }

  private _newId(): string {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  private _sendWelcomeMessage() {
    const welcomeMessage = `👋 Hi! I'm your **Surf AI** assistant.

I can help you with:
- 💻 Code explanations and debugging
- 🔍 Code search and navigation
- ✨ Code generation and refactoring
- 📚 Documentation and best practices

**Current context:**
- File: \`${vscode.window.activeTextEditor?.document.fileName.split('/').pop() || 'None'}\`
- Language: \`${vscode.window.activeTextEditor?.document.languageId || 'None'}\`

Ask me anything about your code!`;

    this._postMessage({
      type: 'addMessage',
      role: 'assistant',
      content: welcomeMessage
    });
  }

  private _clearChat() {
    this._messageHistory = [];
    this._postMessage({ type: 'clearChat' });
    this._sendWelcomeMessage();
  }

  private _postMessage(message: any) {
    this._view?.webview.postMessage(message);
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    // Get resource URIs
    const nonce = this._getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>Surf AI Chat</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      font-size: 13px;
      line-height: 1.6;
      background: var(--vscode-sideBar-background);
      color: var(--vscode-sideBar-foreground);
      height: 100vh;
      overflow: hidden;
    }

    .container {
      display: flex;
      flex-direction: column;
      height: 100vh;
    }

    /* Header */
    .header {
      padding: 12px 16px;
      border-bottom: 1px solid var(--vscode-panel-border);
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: var(--vscode-sideBar-background);
    }

    .header-title {
      font-size: 14px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .header-actions {
      display: flex;
      gap: 8px;
    }

    .icon-button {
      background: none;
      border: none;
      color: var(--vscode-icon-foreground);
      cursor: pointer;
      padding: 4px;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .icon-button:hover {
      background: var(--vscode-toolbar-hoverBackground);
    }

    /* Messages Area */
    .messages {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .message {
      display: flex;
      flex-direction: column;
      gap: 4px;
      animation: fadeIn 0.3s ease-in;
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .message-header {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      font-weight: 600;
    }

    .message-avatar {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
    }

    .message.user .message-avatar {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }

    .message.assistant .message-avatar {
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
    }

    .message-content {
      padding: 12px;
      border-radius: 8px;
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
    }

    .message.user .message-content {
      background: var(--vscode-input-background);
      border-left: 3px solid var(--vscode-focusBorder);
    }

    .message.assistant .message-content {
      background: var(--vscode-editor-inactiveSelectionBackground);
    }

    /* A user turn is a bubble on the right, the way every chat the user already has
       behaves; an assistant turn stays flat, because a box around a long answer
       only crowds the prose. */
    .message.user {
      align-items: flex-end;
    }

    .message.user .message-header {
      display: none;
    }

    .message.user .message-content {
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-panel-border);
      border-left: 1px solid var(--vscode-panel-border);
      border-radius: 14px 14px 4px 14px;
      max-width: 88%;
      padding: 8px 12px;
    }

    .message.assistant .message-content {
      background: transparent;
      border: none;
      padding: 0;
    }

    .message-content p {
      margin-bottom: 8px;
    }

    .message-content p:last-child {
      margin-bottom: 0;
    }

    .message-content code {
      background: var(--vscode-textCodeBlock-background);
      padding: 2px 6px;
      border-radius: 4px;
      font-family: 'Consolas', 'Monaco', monospace;
      font-size: 12px;
    }

    .message-content pre {
      background: var(--vscode-textCodeBlock-background);
      padding: 12px;
      border-radius: 6px;
      overflow-x: auto;
      margin: 8px 0;
    }

    .message-content pre code {
      background: none;
      padding: 0;
    }

    .message-content ul, .message-content ol {
      margin-left: 20px;
      margin-bottom: 8px;
    }

    .message-content strong {
      font-weight: 600;
    }

    .message-content em {
      font-style: italic;
    }

    /* Typing Indicator */
    .typing-indicator {
      display: none;
      padding: 12px;
      background: var(--vscode-editor-inactiveSelectionBackground);
      border-radius: 8px;
      border: 1px solid var(--vscode-panel-border);
    }

    .typing-indicator.active {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .typing-dots {
      display: flex;
      gap: 4px;
    }

    .typing-dots span {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--vscode-foreground);
      animation: bounce 1.4s infinite ease-in-out both;
    }

    .typing-dots span:nth-child(1) { animation-delay: -0.32s; }
    .typing-dots span:nth-child(2) { animation-delay: -0.16s; }

    @keyframes bounce {
      0%, 80%, 100% { transform: scale(0); }
      40% { transform: scale(1); }
    }

    /* Input Area */
    .input-area {
      padding: 12px 16px;
      border-top: 1px solid var(--vscode-panel-border);
      background: var(--vscode-sideBar-background);
    }

    .input-wrapper {
      position: relative;
    }

    .input-field {
      width: 100%;
      padding: 10px 12px;
      border: 1px solid var(--vscode-input-border);
      border-radius: 6px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      font-family: inherit;
      font-size: 13px;
      resize: none;
      min-height: 60px;
      max-height: 200px;
    }

    .input-field:focus {
      outline: none;
      border-color: var(--vscode-focusBorder);
    }

    .input-field::placeholder {
      color: var(--vscode-input-placeholderForeground);
    }

    .input-actions {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 8px;
    }

    .input-hint {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
    }

    .send-button {
      padding: 6px 16px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-weight: 500;
      font-size: 13px;
      transition: background 0.2s;
    }

    .send-button:hover {
      background: var(--vscode-button-hoverBackground);
    }

    .send-button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    /* Context Badge */
    .context-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      border-radius: 12px;
      font-size: 11px;
      margin-top: 8px;
    }

    /* Model picker */
    .model-select {
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
      border-radius: 4px;
      font-size: 12px;
      padding: 3px 6px;
      max-width: 150px;
    }

    /* Header + segmented mode control */
    .chat-header {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 6px 10px;
      padding: 8px 10px;
      border-bottom: 1px solid var(--vscode-panel-border);
    }

    .chat-title {
      font-size: 13px;
      font-weight: 600;
      white-space: nowrap;
    }

    .seg {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      min-width: 0;
      padding: 2px;
      border: 1px solid var(--vscode-input-border);
      border-radius: 999px;
      background: var(--vscode-sideBar-background);
    }

    .seg-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border: none;
      background: transparent;
      color: var(--vscode-foreground);
      font-size: 11px;
      padding: 3px 8px;
      border-radius: 999px;
      cursor: pointer;
      white-space: nowrap;
    }

    /* The panel is docked at whatever width the user dragged it to, so the
       badge and the decorative buttons give way instead of clipping. */
    @media (max-width: 480px) {
      .sub-badge { display: none; }
      .icon-btn.decorative { display: none; }
    }

    .seg-btn[data-mode="offline"].active {
      background: rgba(34, 197, 94, 0.16);
      color: #22c55e;
      box-shadow: inset 0 0 0 1px rgba(34, 197, 94, 0.5);
    }

    .seg-btn[data-mode="online"].active {
      background: rgba(59, 130, 246, 0.16);
      color: #3b82f6;
      box-shadow: inset 0 0 0 1px rgba(59, 130, 246, 0.5);
    }

    .sub-badge {
      font-size: 10px;
      padding: 1px 6px;
      border-radius: 999px;
      background: rgba(34, 197, 94, 0.2);
      color: #22c55e;
    }

    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--vscode-disabledForeground, #888);
    }

    .dot.offline { background: #22c55e; }
    .dot.online { background: #3b82f6; }

    .toolbar {
      margin-left: auto;
      display: inline-flex;
      align-items: center;
      gap: 2px;
    }

    .icon-btn {
      background: none;
      border: none;
      color: var(--vscode-icon-foreground);
      cursor: pointer;
      width: 26px;
      height: 26px;
      border-radius: 6px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
    }

    .icon-btn:hover { background: var(--vscode-toolbar-hoverBackground); }
    .icon-btn[aria-disabled="true"] { opacity: 0.45; cursor: default; }
    .icon-btn[aria-disabled="true"]:hover { background: none; }

    /* Breadcrumb */
    .crumb {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 6px 8px;
      padding: 6px 10px;
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      border-bottom: 1px solid var(--vscode-panel-border);
    }

    .crumb-back {
      background: none;
      border: none;
      color: var(--vscode-foreground);
      cursor: pointer;
      font-size: 14px;
      padding: 0 4px;
    }

    .crumb-scope { color: var(--vscode-foreground); font-weight: 600; }
    .crumb-sep { opacity: 0.6; }
    .crumb-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    .egress {
      margin-left: auto;
      color: #22c55e;
      white-space: nowrap;
    }

    .egress.active { color: #3b82f6; }

    /* Composer card */
    .composer {
      margin: 8px 12px 4px;
      padding: 8px 10px;
      border: 1px solid var(--vscode-input-border);
      border-radius: 12px;
      background: var(--vscode-input-background);
    }

    .composer .input-field {
      border: none;
      background: transparent;
      padding: 2px;
      min-height: 40px;
      color: var(--vscode-input-foreground);
    }

    .composer .input-field:focus { outline: none; border: none; }

    .composer-row {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-top: 6px;
      flex-wrap: wrap;
    }

    .model-pill {
      display: inline-flex;
      align-items: center;
      border: 1px solid var(--vscode-input-border);
      border-radius: 999px;
      background: var(--vscode-sideBar-background);
      color: var(--vscode-foreground);
      font-size: 11px;
      padding: 3px 8px;
      max-width: 150px;
      cursor: pointer;
    }

    .model-pill.offline.active { border-color: rgba(34, 197, 94, 0.6); color: #22c55e; }
    .model-pill.online.active { border-color: rgba(59, 130, 246, 0.6); color: #3b82f6; }

    .chip-btn {
      border: 1px solid var(--vscode-input-border);
      border-radius: 999px;
      background: var(--vscode-sideBar-background);
      color: var(--vscode-foreground);
      font-size: 11px;
      padding: 3px 10px;
      cursor: default;
      opacity: 0.8;
    }

    /* Live credit/tier pill, read from the gateway wallet. There is no "Auto" to
       display here: Offline Mode and Online Cloud are the only two routes. Clicking
       it is the top-up entry point. */
    .credit-pill {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      border: 1px solid var(--vscode-input-border);
      border-radius: 999px;
      background: var(--vscode-sideBar-background);
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
      padding: 3px 9px;
      cursor: pointer;
      white-space: nowrap;
    }
    .credit-pill:hover { color: var(--vscode-foreground); border-color: var(--vscode-focusBorder); }
    .credit-pill.ok { color: #3b82f6; border-color: rgba(59, 130, 246, 0.45); }
    .credit-pill.low { color: #f59e0b; border-color: rgba(245, 158, 11, 0.45); }

    /* A locked higher-tier model stays visible in the picker with its price, so the
       upgrade path is legible instead of the model quietly missing. */
    .model-pill option[disabled] { opacity: 0.55; }

    .unlock-btn {
      border: 1px solid rgba(59, 130, 246, 0.6);
      background: rgba(59, 130, 246, 0.12);
      color: #3b82f6;
      border-radius: 6px;
      font-size: 11px;
      padding: 3px 9px;
      cursor: pointer;
      margin-left: 8px;
    }
    .unlock-btn:hover { background: rgba(59, 130, 246, 0.22); }

    .send-circle {
      margin-left: auto;
      width: 30px;
      height: 30px;
      border-radius: 50%;
      border: none;
      background: #3b82f6;
      color: #fff;
      font-size: 16px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }

    .send-circle:hover { background: #2563eb; }
    .send-circle:disabled { opacity: 0.5; cursor: not-allowed; }

    /* Panel footer */
    .panel-foot {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 12px 10px;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
    }

    .foot-left { display: inline-flex; gap: 12px; }
    .foot-right { color: #22c55e; }

    /* Code blocks with language label + copy */
    .code-block {
      margin: 8px 0;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      overflow: hidden;
      background: var(--vscode-textCodeBlock-background);
    }

    .code-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 4px 10px;
      font-size: 10px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--vscode-descriptionForeground);
      background: var(--vscode-editor-inactiveSelectionBackground);
    }

    .code-copy {
      background: none;
      border: none;
      color: var(--vscode-textLink-foreground);
      cursor: pointer;
      font-size: 11px;
      text-transform: none;
    }

    .code-block pre {
      margin: 0;
      padding: 10px 12px;
      background: transparent;
      overflow-x: auto;
    }

    .code-block pre code { background: none; padding: 0; }

    /* Edit review cards */
    .edit-card {
      margin-top: 8px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      overflow: hidden;
      background: var(--vscode-editor-background);
    }

    .edit-card.resolved { opacity: 0.65; }

    .edit-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      background: var(--vscode-editor-inactiveSelectionBackground);
      font-size: 12px;
      font-weight: 600;
    }

    .edit-file {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .edit-tag {
      font-size: 10px;
      font-weight: 500;
      padding: 1px 6px;
      border-radius: 8px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
    }

    .edit-diff {
      font-family: 'Consolas', 'Monaco', monospace;
      font-size: 12px;
      max-height: 240px;
      overflow: auto;
    }

    .edit-line {
      padding: 1px 10px;
      white-space: pre;
    }

    .edit-line.del {
      background: rgba(229, 83, 75, 0.18);
      color: var(--vscode-errorForeground);
    }

    .edit-line.add {
      background: rgba(78, 185, 106, 0.18);
      color: var(--vscode-charts-green);
    }

    .edit-actions {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      padding: 8px 10px;
      border-top: 1px solid var(--vscode-panel-border);
    }

    .edit-count {
      margin-right: auto;
      font-size: 11px;
      font-family: 'Consolas', 'Monaco', monospace;
      color: var(--vscode-descriptionForeground);
    }

    .edit-count .plus { color: var(--vscode-charts-green); }
    .edit-count .minus { color: var(--vscode-errorForeground); }

    .edit-btn {
      padding: 4px 12px;
      border: none;
      border-radius: 5px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
    }

    .edit-btn.apply {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }

    .edit-btn.apply:hover { background: var(--vscode-button-hoverBackground); }

    .edit-btn.reject {
      background: transparent;
      color: var(--vscode-foreground);
      border: 1px solid var(--vscode-panel-border);
    }

    /* Opening the diff is the primary review action, so it reads as a link rather
       than competing with Accept for the user's attention. */
    .edit-btn.review {
      background: transparent;
      color: var(--vscode-textLink-foreground);
      border: 1px solid var(--vscode-panel-border);
    }

    .edit-btn.review:hover { background: var(--vscode-toolbar-hoverBackground); }

    .edit-status {
      font-size: 12px;
      padding: 8px 10px;
      color: var(--vscode-descriptionForeground);
    }

    /* Scrollbar */
    ::-webkit-scrollbar {
      width: 8px;
    }

    ::-webkit-scrollbar-track {
      background: transparent;
    }

    ::-webkit-scrollbar-thumb {
      background: var(--vscode-scrollbarSlider-background);
      border-radius: 4px;
    }

    ::-webkit-scrollbar-thumb:hover {
      background: var(--vscode-scrollbarSlider-hoverBackground);
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Header -->
    <div class="chat-header">
      <span class="chat-title">\u{1F4AC} Chat</span>
      <div class="seg" id="modeToggle">
        <button class="seg-btn" data-mode="offline" onclick="setMode('offline')" title="Answer from the local model on this device"><span class="dot offline"></span>Offline Mode<span class="sub-badge">Air-Gapped</span></button>
        <button class="seg-btn" data-mode="online" onclick="setMode('online')" title="Answer from the Surf cloud gateway"><span class="dot" id="netDot"></span>Online Cloud</button>
      </div>
      <div class="toolbar">
        <button class="icon-btn" onclick="clearChat()" title="New chat">＋</button>
        <button class="icon-btn decorative" aria-disabled="true" title="History">⌄</button>
        <button class="icon-btn decorative" id="pauseBtn" aria-disabled="true" title="Pause">⏸</button>
        <button class="icon-btn decorative" aria-disabled="true" title="Fullscreen">⛶</button>
        <button class="icon-btn" onclick="closePanel()" title="Close">✕</button>
      </div>
    </div>

    <!-- Breadcrumb -->
    <div class="crumb">
      <button class="crumb-back" onclick="backToLobby()" title="Back to Lobby">←</button>
      <span class="crumb-scope" id="crumbScope">Local</span>
      <span class="crumb-sep">•</span>
      <span class="crumb-title">Surf session</span>
      <span class="egress" id="egress" title="Requests sent to the cloud this session">● 0 network egress</span>
    </div>

    <!-- Messages -->
    <div class="messages" id="messages">
      <!-- Messages will be added here -->
    </div>

    <!-- Typing Indicator -->
    <div class="typing-indicator" id="typingIndicator">
      <div class="typing-dots">
        <span></span>
        <span></span>
        <span></span>
      </div>
      <span>Surf AI is thinking...</span>
    </div>

    <!-- Composer -->
    <div class="composer">
      <textarea
        id="inputField"
        class="input-field"
        placeholder="Describe what to build or code refactor..."
        onkeydown="handleKeyDown(event)"
      ></textarea>
      <div class="composer-row">
        <button class="icon-btn" aria-disabled="true" title="Attach">＋</button>
        <select id="localSelect" class="model-pill offline" onchange="selectLocalModel()" title="Offline model"></select>
        <select id="modelSelect" class="model-pill online" onchange="selectModel()" title="Online model"></select>
        <button class="chip-btn" aria-disabled="true" title="Agent mode">◎ Agent</button>
        <button class="credit-pill" id="creditPill" onclick="openTopUp()" title="Surf credits">Credits</button>
        <button class="icon-btn" aria-disabled="true" title="Dictate">🎙</button>
        <button class="send-circle" id="sendButton" onclick="sendMessage()" title="Send">↑</button>
      </div>
    </div>

    <!-- Panel footer -->
    <div class="panel-foot">
      <span class="foot-left"><span id="footScope">🖥 Local</span><span>🛡 Default permissions</span></span>
      <span class="foot-right" id="footStatus">● Ready</span>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const messagesContainer = document.getElementById('messages');
    const inputField = document.getElementById('inputField');
    const sendButton = document.getElementById('sendButton');
    const typingIndicator = document.getElementById('typingIndicator');
    const modelSelect = document.getElementById('modelSelect');
    const localSelect = document.getElementById('localSelect');

    // Handle messages from extension
    window.addEventListener('message', (event) => {
      const message = event.data;
      
      switch (message.type) {
        case 'addMessage':
          addMessage(message.role, message.content);
          break;
        case 'showTyping':
          typingIndicator.classList.add('active');
          messagesContainer.scrollTop = messagesContainer.scrollHeight;
          setPause(true);
          break;
        case 'hideTyping':
          typingIndicator.classList.remove('active');
          sendButton.disabled = false;
          setPause(false);
          break;
        case 'clearChat':
          messagesContainer.innerHTML = '';
          break;
        case 'models':
          populateModels(message.models, message.selected, message.error);
          break;
        case 'balance':
          renderBalance(message.balance);
          break;
        case 'modelLocked':
          renderLocked(message.content, message.modelId);
          break;
        case 'localModels':
          populateLocalModels(message.models, message.selected);
          break;
        case 'mode':
          applyMode(message.mode);
          break;
        case 'netStatus':
          setNetDot(message.online);
          setEgress(message.egress);
          break;
        case 'proposeEdits':
          message.edits.forEach(renderEditCard);
          messagesContainer.scrollTop = messagesContainer.scrollHeight;
          break;
        case 'editResolved':
          resolveEditCard(message.id, message.applied);
          break;
      }
    });

    function addMessage(role, content) {
      const messageDiv = document.createElement('div');
      messageDiv.className = \`message \${role}\`;
      
      const avatar = role === 'user' ? '👤' : '';
      const label = role === 'user' ? 'You' : 'Surf AI';
      
      // Simple markdown rendering
      const renderedContent = renderMarkdown(content);
      
      messageDiv.innerHTML = \`
        <div class="message-header">
          <div class="message-avatar">\${avatar}</div>
          <span>\${label}</span>
        </div>
        <div class="message-content">
          \${renderedContent}
        </div>
      \`;
      
      messagesContainer.appendChild(messageDiv);
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    function renderMarkdown(text) {
      // Basic markdown rendering
      let html = text;
      
      // Code blocks (triple backtick) - using Unicode escape for backtick
      const BT = String.fromCharCode(96); // backtick character
      const codeBlockRegex = new RegExp(BT + BT + BT + '(\\w*)\\n([\\s\\S]*?)' + BT + BT + BT, 'g');
      html = html.replace(codeBlockRegex, function (_m, lang, code) {
        const label = (lang || 'code').toUpperCase();
        return '<div class="code-block"><div class="code-head"><span>' + label + '</span><button class="code-copy" onclick="copyCode(this)">Copy</button></div><pre><code class="language-' + lang + '">' + code + '</code></pre></div>';
      });
      
      // Inline code (single backtick)
      const inlineCodeRegex = new RegExp(BT + '([^' + BT + ']+)' + BT, 'g');
      html = html.replace(inlineCodeRegex, '<code>$1</code>');
      
      // Bold
      html = html.replace(/\*\*([^\*]+)\*\*/g, '<strong>$1</strong>');
      
      // Italic
      html = html.replace(/\*([^\*]+)\*/g, '<em>$1</em>');
      
      // Headers
      html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
      html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
      html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
      
      // Lists
      html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
      html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');
      
      // Paragraphs
      html = html.replace(/\n\n/g, '</p><p>');
      html = html.replace(/\n/g, '<br>');
      
      return '<p>' + html + '</p>';
    }

    function sendMessage() {
      const message = inputField.value.trim();
      if (message) {
        vscode.postMessage({
          type: 'sendMessage',
          value: message
        });
        inputField.value = '';
        sendButton.disabled = true;
      }
    }

    function clearChat() {
      vscode.postMessage({ type: 'clearChat' });
    }

    function handleKeyDown(event) {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        sendMessage();
      }
    }

    // The online picker is tier-aware (ADR 0008): an unlocked model is selectable, a
    // locked one is shown with its price and routes to the top-up flow instead of
    // being picked and failing mid-chat.
    let onlineModels = [];
    let selectedOnline = null;

    function populateModels(models, selected, error) {
      onlineModels = models || [];
      selectedOnline = selected;
      modelSelect.innerHTML = '';
      if (onlineModels.length === 0) {
        const opt = document.createElement('option');
        opt.textContent = error ? 'No models' : 'Loading...';
        modelSelect.appendChild(opt);
        modelSelect.disabled = true;
        return;
      }
      modelSelect.disabled = false;
      for (const m of onlineModels) {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.disabled = Boolean(m.locked);
        opt.textContent = m.locked
          ? '🔒 ' + (m.label || m.id) + ' - unlock with $' + m.unlock_usd + ' top-up'
          : (m.label || m.id);
        opt.title = m.locked
          ? 'Needs ' + m.min_credits + ' credits bought ($' + m.unlock_usd + ')'
          : (m.tier_label ? m.tier_label + ' - ' : '') + m.provider + ' - $' + m.input_price_per_million + '/M in';
        if (m.id === selected) { opt.selected = true; }
        modelSelect.appendChild(opt);
      }
      if (selected) { vscode.postMessage({ type: 'selectModel', value: selected }); }
    }

    function selectModel() {
      const chosen = onlineModels.find((m) => m.id === modelSelect.value);
      if (chosen && chosen.locked) {
        // Put the picker back where it was and open the top-up flow. Silently
        // selecting a locked model would only produce a 403 on the next turn.
        modelSelect.value = selectedOnline || '';
        openTopUp(chosen.id);
        return;
      }
      if (chosen) { selectedOnline = chosen.id; }
      vscode.postMessage({ type: 'selectModel', value: modelSelect.value });
    }

    /** Wallet in credits plus the purchase tier, straight from the gateway. */
    function renderBalance(info) {
      const pill = document.getElementById('creditPill');
      if (!pill) { return; }
      if (!info) {
        // Unknown, not zero: a failed read must not accuse a paying user of being out.
        pill.textContent = 'Credits';
        pill.title = 'Could not read your Surf credits. Click to open the top-up page.';
        pill.classList.remove('ok', 'low');
        return;
      }
      const tierLabel = info.max_topup_credits >= 25 ? 'Frontier'
        : info.max_topup_credits >= 5 ? 'Daily' : 'Trial';
      pill.textContent = '◍ ' + info.credits + ' cr - ' + tierLabel;
      pill.title = info.credits + ' credit(s) left ($' + Number(info.balance).toFixed(2)
        + ') - bought tier: ' + tierLabel + ' (' + info.max_topup_credits + ' credits) - click to top up';
      pill.classList.toggle('low', info.billing_locked || info.credits <= 1);
      pill.classList.toggle('ok', !info.billing_locked && info.credits > 1);
    }

    function openTopUp(modelId) {
      vscode.postMessage({ type: 'openTopUp', modelId: modelId || null });
    }

    function renderLocked(content, modelId) {
      addMessage('assistant', content);
      const last = messagesContainer.lastElementChild;
      const body = last ? last.querySelector('.message-content') : null;
      if (!body) { return; }
      const btn = document.createElement('button');
      btn.className = 'unlock-btn';
      btn.textContent = 'Top up to unlock';
      btn.onclick = () => openTopUp(modelId);
      body.appendChild(btn);
    }

    function selectLocalModel() {
      vscode.postMessage({ type: 'selectLocalModel', value: localSelect.value });
    }

    function applyMode(mode) {
      const offline = mode !== 'online';
      const active = offline ? 'offline' : 'online';
      document.querySelectorAll('.seg-btn').forEach((b) => {
        b.classList.toggle('active', b.getAttribute('data-mode') === active);
      });
      localSelect.classList.toggle('active', offline);
      modelSelect.classList.toggle('active', !offline);
      const scope = offline ? 'Local' : 'Cloud';
      const crumbScope = document.getElementById('crumbScope');
      if (crumbScope) { crumbScope.textContent = scope; }
      const footScope = document.getElementById('footScope');
      if (footScope) { footScope.textContent = offline ? '🖥 Local' : '☁ Cloud'; }
    }

    function setNetDot(online) {
      const dot = document.getElementById('netDot');
      if (dot) { dot.classList.toggle('online', Boolean(online)); }
    }

    function setEgress(n) {
      const el = document.getElementById('egress');
      if (!el) { return; }
      const count = Number(n) || 0;
      el.textContent = '● ' + count + ' network egress';
      el.classList.toggle('active', count > 0);
    }

    function setPause(working) {
      const btn = document.getElementById('pauseBtn');
      if (btn) { btn.setAttribute('aria-disabled', working ? 'false' : 'true'); }
      const status = document.getElementById('footStatus');
      if (status) { status.textContent = working ? '● Working' : '● Ready'; status.style.color = working ? '#3b82f6' : '#22c55e'; }
    }

    function closePanel() {
      vscode.postMessage({ type: 'closePanel' });
    }

    function copyCode(btn) {
      const block = btn.closest('.code-block');
      const code = block ? block.querySelector('code') : null;
      if (code) { vscode.postMessage({ type: 'copyMessage', value: code.textContent }); }
    }

    function setMode(mode) {
      applyMode(mode);
      vscode.postMessage({ type: 'setMode', value: mode });
    }

    function backToLobby() {
      vscode.postMessage({ type: 'backToLobby' });
    }

    function populateLocalModels(models, selected) {
      localSelect.innerHTML = '';
      if (!models || models.length === 0) {
        const opt = document.createElement('option');
        opt.textContent = 'No local model';
        localSelect.appendChild(opt);
        localSelect.disabled = true;
        return;
      }
      localSelect.disabled = false;
      for (const m of models) {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.label || m.id;
        if (m.id === selected) { opt.selected = true; }
        localSelect.appendChild(opt);
      }
      if (selected) { vscode.postMessage({ type: 'selectLocalModel', value: selected }); }
    }

    function renderEditCard(edit) {
      const card = document.createElement('div');
      card.className = 'edit-card';
      card.id = 'edit-' + edit.id;

      const lines = [];
      for (const l of (edit.removed || [])) { lines.push('<div class="edit-line del">- ' + escapeHtml(l) + '</div>'); }
      for (const l of (edit.added || [])) { lines.push('<div class="edit-line add">+ ' + escapeHtml(l) + '</div>'); }

      const tag = edit.isNewFile ? '<span class="edit-tag">new file</span>' : '';
      const removed = (edit.removed || []).length;
      const added = (edit.added || []).length;
      const count = '<span class="edit-count"><span class="plus">+' + added + '</span> <span class="minus">-' + removed + '</span></span>';
      card.innerHTML =
        '<div class="edit-head"><span class="edit-file">' + escapeHtml(edit.file) + '</span>' + tag + '</div>' +
        '<div class="edit-diff">' + (lines.join('') || '<div class="edit-status">No line changes.</div>') + '</div>' +
        '<div class="edit-actions">' +
          count +
          '<button class="edit-btn review" onclick="openDiff(\'' + edit.id + '\')" title="Open this change as a side-by-side diff">Review diff</button>' +
          '<button class="edit-btn apply" onclick="applyEdit(\'' + edit.id + '\')">Accept</button>' +
          '<button class="edit-btn reject" onclick="rejectEdit(\'' + edit.id + '\')">Reject</button>' +
        '</div>';
      messagesContainer.appendChild(card);
    }

    function openDiff(id) {
      vscode.postMessage({ type: 'openDiff', value: id });
    }

    function applyEdit(id) {
      vscode.postMessage({ type: 'applyEdits', ids: [id] });
    }

    function rejectEdit(id) {
      vscode.postMessage({ type: 'rejectEdits', ids: [id] });
    }

    function resolveEditCard(id, applied) {
      const card = document.getElementById('edit-' + id);
      if (!card) { return; }
      card.classList.add('resolved');
      const actions = card.querySelector('.edit-actions');
      if (actions) { actions.outerHTML = '<div class="edit-status">' + (applied ? 'Applied' : 'Rejected') + '</div>'; }
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text == null ? '' : String(text);
      return div.innerHTML;
    }

    // Auto-resize textarea
    inputField.addEventListener('input', function() {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 200) + 'px';
    });

    // Focus input on load
    inputField.focus();
  </script>
</body>
</html>`;
  }

  private _getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }
}
