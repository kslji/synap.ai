/**
 * Chat Sidebar Provider
 * 
 * Creates a chat panel that looks like Qoder/Cursor
 * - Clean, modern UI
 * - Integrated with VSCode theme
 * - Supports markdown rendering
 * - Code block highlighting
 * - Context indicators
 * - Live SSE token streaming with a collapsible Thinking… block
 * - Multi-step ◎ Agent mode with workspace tools, step pills and DiffReview
 * - Stop/Cancel on the active stream or agent loop via AbortController
 * - Removable @ context chips (@file/@selection/@git/@problems)
 */

import * as vscode from 'vscode';
import { extractContext, buildPromptWithContext } from './context-extractor';
import { GatewayClient, ModelLockedError, type GatewayBalance, type GatewayModel } from './gateway-client';
import { LocalModelClient, TurnCancelledError, type LocalModel } from './local-model-client';
import { parseEdits, applyEdit, editDiff, type ProposedEdit } from './edit-proposal';
import { DiffReview } from './diff-review';
import { MODE_STATE_KEY, resolveRoute, onlineReachable, invalidateReachability, type SurfMode } from './model-router';
import { runAgentLoop, type AgentLoopEvents } from './agent-loop';
import { buildWorkspaceTools } from './agent-tools';
import { buildPromptWithChips, wantsContextPicker, type ContextChip } from './context-chips';
import { surfSetEngine, surfSetBusy, surfReportRate, tokensPerSec } from './surf-status';
import type { ChatTurn } from './chat-types';

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

/** Delta batches are folded into the webview at ~12 FPS; faster renders cost
 * frames without being readable. */
const DELTA_FLUSH_MS = 80;

/** How much multi-turn history travels with a request. Long chats stay cheap. */
const HISTORY_TURNS = 12;

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
  /** The active stream or agent loop; the header Stop button aborts it. */
  private _abort?: AbortController;
  /** ◎ Agent toggle in the composer; on runs the multi-step tool loop. */
  private _agentMode = false;
  /** Context chips sitting in the composer, attached to the next turn. */
  private _chips: ContextChip[] = [];
  /**
   * Offline privacy boundary: Offline turns never travel to the Online gateway
   * until the user explicitly consents for this chat. Re-checked whenever a new
   * Offline turn exists that the consent did not cover.
   */
  private _offlineTurns = 0;
  private _egressConsented = false;
  /** Turn timing for the status-bar throughput read: start clock and content size. */
  private _turnStartMs = 0;
  private _turnChars = 0;
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
    if (saved === 'online' || saved === 'offline' || saved === 'auto') {
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
        case 'stopGeneration':
          this._abort?.abort();
          break;
        case 'toggleAgent':
          this._agentMode = Boolean(data.value);
          break;
        case 'removeChip':
          this._chips = this._chips.filter((c) => c.id !== data.id);
          break;
        case 'attachContext': {
          const chip = await this._contextPicker();
          if (chip) {
            this._chips = [...this._chips, chip];
            this._postMessage({ type: 'chips', chips: this._chips });
          }
          break;
        }
        case 'inputAtToken': {
          // Typing a bare `@` opens the same picker as the + button. It never
          // strips the character; the user can keep typing after choosing.
          if (wantsContextPicker(String(data.textBefore ?? ''))) {
            const chip = await this._contextPicker();
            if (chip) {
              this._chips = [...this._chips, chip];
              this._postMessage({ type: 'chips', chips: this._chips });
            }
          }
          break;
        }
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
          if (data.value === 'online' || data.value === 'offline' || data.value === 'auto') {
            this._mode = data.value;
            void this._context.workspaceState.update(MODE_STATE_KEY, this._mode);
            invalidateReachability(this._client);
            if (this._mode === 'offline') {
              // Offline: no gateway model list, no background ping, no probes.
              void this._loadLocalModels();
              this._stopStatusTimer();
            } else {
              // Online and Auto both need the cloud list; Auto also keeps the
              // local list loaded so it can route routine work on-device.
              void this._loadModels();
              if (this._mode === 'auto') {
                void this._loadLocalModels();
              }
              this._startStatusTimer();
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
    this._postMessage({ type: 'agentState', value: this._agentMode });
    if (this._mode === 'online' || this._mode === 'auto') {
      void this._loadModels();
    }
    void this._loadLocalModels();
    void this._pushNetStatus();
    if (this._mode === 'online' || this._mode === 'auto') {
      void this._loadBalance();
    }
    this._startStatusTimer();
  }

  /** The 8s status ping runs only while the cloud is in play (Online or Auto); Offline makes zero requests. */
  private _startStatusTimer() {
    if (this._statusTimer || (this._mode !== 'online' && this._mode !== 'auto')) {
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

  /**
   * Programmatic entry used by the editor commands (ask/explain/fix/Cmd+K):
   * focuses the chat, then runs the turn through the same pipeline the composer
   * uses, with any pre-built context chips attached.
   */
  public async submitTurn(
    text: string,
    opts: { chips?: ContextChip[]; agent?: boolean } = {}
  ): Promise<void> {
    if (!this._view) {
      await vscode.commands.executeCommand('workbench.view.extension.surf-ai');
    }
    if (!this._view) {
      // The webview never resolved (window closing during activation); fall
      // back to quick input so the command still has an effect.
      const answer = await vscode.window.showInputBox({ prompt: text.slice(0, 200) });
      if (answer !== undefined) {
        return;
      }
      return;
    }
    if (opts.chips?.length) {
      this._chips = [...this._chips, ...opts.chips];
      this._postMessage({ type: 'chips', chips: this._chips });
    }
    if (opts.agent !== undefined) {
      this._agentMode = opts.agent;
      this._postMessage({ type: 'agentState', value: this._agentMode });
    }
    await this._handleUserMessage(text);
  }

  /** Replace the composer's pending chips (used by the + picker pipeline). */
  public setChips(chips: ContextChip[]): void {
    this._chips = chips;
    this._postMessage({ type: 'chips', chips: this._chips });
  }

  public getChips(): ContextChip[] {
    return [...this._chips];
  }

  /**
   * Register a proposal produced outside the chat (Cmd+K inline edit): the same
   * card + side-by-side diff pipeline, opened without stealing focus from the
   * editor so the user accepts or rejects from the diff title bar.
   */
  public async offerInlineProposal(edit: ProposedEdit): Promise<void> {
    const id = this._newId();
    this._pendingEdits.set(id, edit);
    const { removed, added } = editDiff(edit);
    this._postMessage({
      type: 'proposeEdits',
      edits: [{ id, file: edit.relPath, isNewFile: edit.isNewFile, removed, added }]
    });
    await this.review.open(id, edit, { preserveFocus: true });
  }

  private async _handleUserMessage(input: string | { text: string; chips?: ContextChip[] }) {
    if (this._isProcessing) {
      return;
    }
    const message = typeof input === 'string' ? input : input.text;
    const chips = (typeof input === 'string' ? undefined : input.chips) ?? this._chips;
    this._chips = [];
    this._postMessage({ type: 'chips', chips: [] });

    // The privacy gate runs before the mode is even consulted: an Offline
    // discussion is never carried online without an explicit per-chat yes.
    if (!(await this._consentGate())) {
      return;
    }

    // Auto decides per turn, so make sure the local set is known before routing.
    if (this._mode === 'auto' && !this._selectedLocal) {
      await this._loadLocalModels();
    }
    const route = await resolveRoute(this._mode, this._client, this._local, {
      task: message,
      hasLocalModel: Boolean(this._selectedLocal)
    });
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
    this._abort = new AbortController();
    this._messageHistory.push({ role: 'user', content: message });
    if (offline) {
      this._offlineTurns += 1;
    }
    this._postMessage({ type: 'addMessage', role: 'user', content: message, chips: chips.map((c) => c.label) });
    this._postMessage({ type: 'showTyping' });
    if (!offline) {
      this._egress += 1;
      void this._pushNetStatus();
    }

    const streamId = this._newId();
    this._turnStartMs = Date.now();
    this._turnChars = 0;
    surfSetEngine(this._engineLabel(route));
    surfSetBusy(true);
    this._postMessage({ type: 'streamOpen', id: streamId });

    try {
      const withChips = buildPromptWithChips(message, chips);
      if (this._agentMode) {
        await this._runAgentTurn(withChips, streamId, offline);
      } else {
        await this._runPlainTurn(withChips, streamId, offline);
      }
    } catch (error) {
      if (error instanceof ModelLockedError) {
        // The tier gate answered mid-turn (the picker normally prevents it). Say what
        // unlocks it and put the unlock one click away, instead of a bare ❌ Error.
        this._postMessage({ type: 'streamEnd', id: streamId });
        this._postMessage({
          type: 'modelLocked',
          content: `${error.modelId} is a ${error.requiredCredits}-credit model. A $${error.unlockUsd} top-up unlocks it.`,
          modelId: error.modelId
        });
        return;
      }
      this._postMessage({ type: 'streamEnd', id: streamId });
      if (error instanceof TurnCancelledError) {
        this._postMessage({ type: 'addMessage', role: 'assistant', content: '⏹ Stopped.' });
      } else {
        this._postMessage({
          type: 'addMessage',
          role: 'assistant',
          content: `❌ Error: ${(error as Error).message}`
        });
      }
    } finally {
      this._isProcessing = false;
      this._abort = undefined;
      surfReportRate(tokensPerSec(this._turnChars, Date.now() - this._turnStartMs));
      surfSetBusy(false);
      this._postMessage({ type: 'hideTyping' });
      // A settled turn changed the wallet, so the credit pill is never a turn stale.
      if (!offline) {
        void this._loadBalance();
      }
    }
  }

  /**
   * The ordinary (non-agent) turn: multi-turn history goes to the active
   * backend, tokens stream into the open bubble, thinking renders in the
   * disclosure, and SURF_EDIT blocks become DiffReview proposals.
   */
  private async _runPlainTurn(message: string, streamId: string, offline: boolean): Promise<void> {
    const context = await extractContext();
    const systemPrompt = buildPromptWithContext('', context) + EDIT_INSTRUCTIONS;
    const turns = this._buildTurns(systemPrompt, message);
    const sinks = this._streamSinks(streamId);
    const raw = offline
      ? await this._local.chatStream(this._selectedLocal as string, turns, sinks, {
        signal: this._abort?.signal,
        enableThinking: false
      })
      : await this._client.chatStream(this._selectedModel as string, turns, sinks, {
        signal: this._abort?.signal,
        enableThinking: false
      });
    this._postMessage({ type: 'streamEnd', id: streamId });
    const { prose, edits } = parseEdits(raw);
    this._messageHistory.push({ role: 'assistant', content: prose || raw });
    await this._publishEdits(edits, false);
  }

  /**
   * The ◎ Agent turn: a multi-step loop (up to 10 steps) over the workspace
   * tools, streamed live with step pills. Edits register with DiffReview from
   * inside the loop; after the answer, any SURF_EDIT blocks the model still
   * emitted are parsed as a fallback so nothing is lost.
   */
  private async _runAgentTurn(task: string, streamId: string, offline: boolean): Promise<void> {
    const tools = buildWorkspaceTools({
      propose: async (edit) => {
        await this._publishEdits([edit], true);
      },
      approve: async (command) => {
        const choice = await vscode.window.showWarningMessage(
          `Surf AI wants to run: ${command}`,
          { modal: true },
          'Run it'
        );
        return choice === 'Run it';
      }
    });
    const runTurn = async (turns: ChatTurn[], sinks: Parameters<LocalModelClient['chatStream']>[2]): Promise<string> => {
      if (offline) {
        return this._local.chatStream(this._selectedLocal as string, turns, sinks, {
          signal: this._abort?.signal,
          enableThinking: false
        });
      }
      return this._client.agentStream(this._selectedModel as string, turns, sinks, {
        signal: this._abort?.signal,
        enableThinking: false
      });
    };
    const events: AgentLoopEvents = {
      onStep: (label) => this._postMessage({ type: 'step', id: streamId, label }),
      onDelta: (text) => { this._turnChars += text.length; this._postMessage({ type: 'streamDelta', id: streamId, kind: 'content', text }); },
      onReasoning: (text) => this._postMessage({ type: 'streamDelta', id: streamId, kind: 'thinking', text })
    };
    const result = await runAgentLoop(
      task,
      tools,
      runTurn,
      events,
      { signal: this._abort?.signal, enableThinking: false }
    );
    this._postMessage({ type: 'streamEnd', id: streamId });
    if (result.cancelled) {
      this._postMessage({ type: 'addMessage', role: 'assistant', content: '⏹ Stopped.' });
      return;
    }
    const { prose, edits } = parseEdits(result.answer);
    const display = prose || result.answer || 'Done.';
    this._messageHistory.push({ role: 'assistant', content: display });
    if (!edits.length && result.answer) {
      // The loop already applied proposals through its tools; a model that
      // ignored the protocol and wrote SURF_EDIT blocks still gets parsed.
      const fallback = parseEdits(result.answer);
      if (fallback.edits.length) {
        await this._publishEdits(fallback.edits, false);
      }
    }
    if (!result.answer && !edits.length) {
      this._postMessage({ type: 'addMessage', role: 'assistant', content: 'The agent finished with no changes.' });
    }
  }

  /** Register edits with DiffReview, render their chat cards, open the diff. */
  private async _publishEdits(edits: ProposedEdit[], autoOpenDiff: boolean): Promise<void> {
    if (!edits.length) {
      return;
    }
    const payload = edits.map((edit) => {
      const id = this._newId();
      this._pendingEdits.set(id, edit);
      const { removed, added } = editDiff(edit);
      return { id, file: edit.relPath, isNewFile: edit.isNewFile, removed, added };
    });
    this._postMessage({ type: 'proposeEdits', edits: payload });
    if (autoOpenDiff) {
      // Focus stays in the chat; the user reads the card, opens the diff from it.
      const first = edits[0];
      const firstId = payload[0].id;
      if (first) {
        await this.review.open(firstId, first, { preserveFocus: true });
      }
    }
  }

  /** Multi-turn history, oldest dropped, with the current user message last. */
  private _buildTurns(systemPrompt: string, message: string): ChatTurn[] {
    const history = this._messageHistory.slice(-HISTORY_TURNS);
    return [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content: message }
    ];
  }

  /** Content/reasoning sinks that batch deltas to the webview at ~12 FPS. */
  private _streamSinks(streamId: string) {
    let pendingContent = '';
    let pendingThinking = '';
    let timer: NodeJS.Timeout | undefined;
    const flush = () => {
      timer = undefined;
      if (pendingContent) {
        this._turnChars += pendingContent.length;
        this._postMessage({ type: 'streamDelta', id: streamId, kind: 'content', text: pendingContent });
        pendingContent = '';
      }
      if (pendingThinking) {
        this._postMessage({ type: 'streamDelta', id: streamId, kind: 'thinking', text: pendingThinking });
        pendingThinking = '';
      }
    };
    const schedule = () => {
      if (!timer) {
        timer = setTimeout(flush, DELTA_FLUSH_MS);
      }
    };
    return {
      onContent: (text: string) => {
        pendingContent += text;
        schedule();
      },
      onReasoning: (text: string) => {
        pendingThinking += text;
        schedule();
      }
    };
  }

  /**
   * True when an Online turn may proceed. Offline turns only ever travel with
   * explicit per-chat consent; declining cancels the turn rather than silently
   * leaking the discussion.
   */
  private async _consentGate(): Promise<boolean> {
    if (this._mode !== 'online' || this._offlineTurns === 0 || this._egressConsented) {
      return true;
    }
    const choice = await vscode.window.showWarningMessage(
      'This chat started Offline Mode. Sending it Online Cloud shares the conversation with the gateway. Allow for this chat?',
      { modal: true },
      'Allow once'
    );
    if (choice === 'Allow once') {
      this._egressConsented = true;
      return true;
    }
    this._postMessage({
      type: 'addMessage',
      role: 'assistant',
      content: '🔒 Offline privacy kept the chat on this device. Switch to Offline Mode, or allow sharing to continue online.'
    });
    return false;
  }

  /** The `+` button and bare `@`: one quick pick over the four context kinds. */
  private async _contextPicker(): Promise<ContextChip | null> {
    const picked = await vscode.window.showQuickPick(
      [
        { label: '@file', description: 'Attach a workspace file', id: 'file' },
        { label: '@selection', description: 'Attach the current editor selection', id: 'selection' },
        { label: '@git', description: 'Attach git status + uncommitted diff', id: 'git' },
        { label: '@problems', description: 'Attach workspace diagnostics', id: 'problems' }
      ],
      { placeHolder: 'Attach context to this chat' }
    );
    if (!picked) {
      return null;
    }
    const built = await vscode.commands.executeCommand<ContextChip | null>('surf-ai.contextPickerBuild', picked.id);
    return built ?? null;
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

  /** The engine text for the status bar: the model this turn actually used. */
  private _engineLabel(route: 'online' | 'offline'): string {
    const base = route === 'offline'
      ? `\u25cf ${this._selectedLocal || 'Local'}`
      : `\u2601 ${this._selectedModel || 'Cloud'}`;
    return this._mode === 'auto' ? `\u26a1 Auto \u00b7 ${base}` : base;
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
    this._chips = [];
    this._offlineTurns = 0;
    this._egressConsented = false;
    this._postMessage({ type: 'clearChat' });
    this._postMessage({ type: 'chips', chips: [] });
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

    .seg-btn[data-mode="auto"].active {
      background: rgba(245, 158, 11, 0.16);
      color: #f59e0b;
      box-shadow: inset 0 0 0 1px rgba(245, 158, 11, 0.5);
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
    .dot.auto { background: #f59e0b; }

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

    /* "Select Model / Engine" popover: the composer pill opens it, the three
       tabs pick the routing mode, and the fields below hold the local/cloud
       model pickers. Auto reveals the hybrid-routing explainer card. */
    .engine-pill {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      border: 1px solid var(--vscode-input-border);
      border-radius: 999px;
      background: var(--vscode-sideBar-background);
      color: var(--vscode-foreground);
      font-size: 11px;
      padding: 3px 10px;
      max-width: 190px;
      cursor: pointer;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .engine-pill.offline { border-color: rgba(34, 197, 94, 0.6); color: #22c55e; }
    .engine-pill.online { border-color: rgba(59, 130, 246, 0.6); color: #3b82f6; }
    .engine-pill.auto { border-color: rgba(245, 158, 11, 0.6); color: #f59e0b; }

    .engine-popover {
      margin: 8px 12px 0;
      padding: 10px 12px;
      border: 1px solid var(--vscode-input-border);
      border-radius: 12px;
      background: var(--vscode-sideBar-background);
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.28);
    }

    .engine-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
    }

    .engine-title { font-size: 12px; font-weight: 600; }

    .engine-tabs { display: flex; gap: 6px; margin-bottom: 8px; flex-wrap: wrap; }

    .engine-tab {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border: 1px solid var(--vscode-input-border);
      border-radius: 999px;
      background: var(--vscode-input-background);
      color: var(--vscode-foreground);
      font-size: 11px;
      padding: 4px 10px;
      cursor: pointer;
    }

    .engine-tab[data-eg="offline"].active { color: #22c55e; border-color: rgba(34, 197, 94, 0.6); background: rgba(34, 197, 94, 0.12); }
    .engine-tab[data-eg="online"].active { color: #3b82f6; border-color: rgba(59, 130, 246, 0.6); background: rgba(59, 130, 246, 0.12); }
    .engine-tab[data-eg="auto"].active { color: #f59e0b; border-color: rgba(245, 158, 11, 0.6); background: rgba(245, 158, 11, 0.12); }

    .engine-field { display: flex; align-items: center; gap: 8px; margin: 6px 0; }
    .engine-field-label { font-size: 11px; color: var(--vscode-descriptionForeground); min-width: 88px; }
    .engine-field .model-pill { flex: 1; max-width: none; }

    .auto-card {
      margin-top: 8px;
      padding: 8px 10px;
      border: 1px solid rgba(245, 158, 11, 0.5);
      border-radius: 10px;
      background: rgba(245, 158, 11, 0.08);
    }
    .auto-card-title { font-size: 11px; font-weight: 600; color: #f59e0b; margin-bottom: 4px; }
    .auto-card-body { font-size: 11px; line-height: 1.5; color: var(--vscode-foreground); }

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

    /* Live credit/tier pill, read from the gateway wallet. Auto is a routing
       mode, not a separate wallet: it spends cloud credits only on the turns it
       escalates online. Clicking the pill is the top-up entry point. */
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

    /* Live streaming turn: thinking disclosure, step pills, chips row */
    .stream-thinking {
      margin: 4px 0 8px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      background: var(--vscode-editor-inactiveSelectionBackground);
      overflow: hidden;
    }

    .stream-thinking summary {
      cursor: pointer;
      padding: 5px 10px;
      font-size: 11px;
      font-weight: 600;
      color: var(--vscode-descriptionForeground);
      list-style: none;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .stream-thinking summary::before { content: '▸'; }
    .stream-thinking[open] summary::before { content: '▾'; }

    .stream-thinking-body {
      padding: 6px 10px 8px;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      white-space: pre-wrap;
      max-height: 160px;
      overflow-y: auto;
      border-top: 1px solid var(--vscode-panel-border);
    }

    .steps {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-bottom: 6px;
    }

    .step-pill {
      font-size: 10.5px;
      padding: 2px 8px;
      border-radius: 999px;
      border: 1px solid var(--vscode-input-border);
      background: var(--vscode-sideBar-background);
      color: var(--vscode-descriptionForeground);
      white-space: nowrap;
    }

    .step-pill.done {
      border-color: rgba(34, 197, 94, 0.45);
      color: #22c55e;
    }

    /* A subtle accent so the reasoning block reads as its own "card". */
    .stream-thinking { border-left: 2px solid rgba(139, 92, 246, 0.55); }
    .stream-thinking summary .thought-badge {
      font-size: 10px;
      padding: 1px 6px;
      border-radius: 999px;
      background: rgba(139, 92, 246, 0.16);
      color: #a78bfa;
      margin-left: auto;
    }

    /* Message-level actions: a Copy affordance that appears on hover. */
    .msg-actions { display: flex; gap: 6px; margin-top: 6px; opacity: 0; transition: opacity .12s ease; }
    .message.assistant:hover .msg-actions,
    .message.user:hover .msg-actions { opacity: 1; }
    .msg-copy {
      font-size: 10.5px;
      padding: 2px 8px;
      border-radius: 6px;
      border: 1px solid var(--vscode-input-border);
      background: var(--vscode-sideBar-background);
      color: var(--vscode-descriptionForeground);
      cursor: pointer;
    }
    .msg-copy:hover { color: var(--vscode-foreground); }

    .chips-row {
      display: none;
      flex-wrap: wrap;
      gap: 4px;
      margin-bottom: 6px;
    }

    .chips-row.active { display: flex; }

    .ctx-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 999px;
      border: 1px solid rgba(59, 130, 246, 0.5);
      background: rgba(59, 130, 246, 0.1);
      color: #3b82f6;
      max-width: 100%;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .ctx-chip .chip-x {
      background: none;
      border: none;
      color: inherit;
      cursor: pointer;
      padding: 0 2px;
      font-size: 11px;
      opacity: 0.8;
    }

    .ctx-chip .chip-x:hover { opacity: 1; }

    .chip-btn.active {
      border-color: rgba(59, 130, 246, 0.6);
      color: #3b82f6;
      opacity: 1;
      cursor: pointer;
    }

    .user-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      justify-content: flex-end;
      margin-top: 4px;
    }

    .user-chips .ctx-chip { cursor: default; }

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
        <button class="seg-btn" data-mode="auto" onclick="setMode('auto')" title="Auto: keep routine work on this device, route complex reasoning to the cloud"><span class="dot auto"></span>Auto</button>
        <button class="seg-btn" data-mode="online" onclick="setMode('online')" title="Answer from the Surf cloud gateway"><span class="dot" id="netDot"></span>Online Cloud</button>
      </div>
      <div class="toolbar">
        <button class="icon-btn" onclick="clearChat()" title="New chat">＋</button>
        <button class="icon-btn decorative" aria-disabled="true" title="History">⌄</button>
        <button class="icon-btn" id="pauseBtn" title="Stop the current turn">⏸</button>
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

    <!-- Select Model / Engine popover (opened by the composer engine pill) -->
    <div class="engine-popover" id="enginePopover" hidden>
      <div class="engine-head">
        <span class="engine-title">🧠 Select Model / Engine</span>
        <button class="icon-btn" onclick="toggleEngine(false)" title="Close">✕</button>
      </div>
      <div class="engine-tabs">
        <button class="engine-tab" data-eg="offline" onclick="pickEngine('offline')" title="Answer from the local model on this device"><span class="dot offline"></span>Offline Models</button>
        <button class="engine-tab" data-eg="online" onclick="pickEngine('online')" title="Answer from the Surf cloud gateway"><span class="dot online"></span>Online Models</button>
        <button class="engine-tab" data-eg="auto" onclick="pickEngine('auto')" title="Dynamic hybrid routing between local and cloud">⚡ Auto</button>
      </div>
      <div class="engine-field" id="offlineField">
        <span class="engine-field-label">On this device</span>
        <select id="localSelect" class="model-pill" onchange="selectLocalModel()" title="Offline model"></select>
      </div>
      <div class="engine-field" id="onlineField">
        <span class="engine-field-label">Surf cloud</span>
        <select id="modelSelect" class="model-pill" onchange="selectModel()" title="Online model"></select>
      </div>
      <div class="auto-card" id="autoCard" hidden>
        <div class="auto-card-title">⚡ Why use Auto? Dynamic Hybrid Routing</div>
        <div class="auto-card-body">Routine edits and code-local work run on the model on this device; genuinely complex reasoning is routed to the Surf cloud automatically — no manual switching. Choose Offline Mode if nothing may ever leave this machine.</div>
      </div>
    </div>

    <!-- Composer -->
    <div class="composer">
      <textarea
        id="inputField"
        class="input-field"
        placeholder="Describe what to build or code refactor..."
        onkeydown="handleKeyDown(event)"
      ></textarea>
      <div class="chips-row" id="chipsRow"></div>
      <div class="composer-row">
        <button class="icon-btn" onclick="attachContext()" title="Attach context (@file, @selection, @git, @problems)">＋</button>
        <button class="engine-pill" id="enginePill" onclick="toggleEngine()" title="Choose the model / engine">🧠 Choose Model ▾</button>
        <button class="chip-btn" id="agentToggle" onclick="toggleAgent()" title="Run the multi-step coding agent (tools: files, search, edits, commands)">◎ Agent</button>
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
    const enginePopover = document.getElementById('enginePopover');
    let currentMode = 'offline';

    // Handle messages from extension
    window.addEventListener('message', (event) => {
      const message = event.data;
      
      switch (message.type) {
        case 'addMessage':
          addMessage(message.role, message.content, message.chips);
          break;
        case 'streamOpen':
          openStream(message.id);
          break;
        case 'streamDelta':
          appendDelta(message.id, message.kind, message.text);
          break;
        case 'streamEnd':
          endStream(message.id);
          break;
        case 'step':
          addStep(message.id, message.label);
          break;
        case 'chips':
          renderChips(message.chips);
          break;
        case 'agentState':
          renderAgent(message.value);
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

    function addMessage(role, content, chips) {
      const messageDiv = document.createElement('div');
      messageDiv.className = \`message \${role}\`;
      
      const avatar = role === 'user' ? '👤' : '';
      const label = role === 'user' ? 'You' : 'Surf AI';
      
      // Simple markdown rendering
      const renderedContent = renderMarkdown(content);
      const chipRow = (chips && chips.length)
        ? '<div class="user-chips">' + chips.map((c) => '<span class="ctx-chip">' + escapeHtml(c) + '</span>').join('') + '</div>'
        : '';
      
      messageDiv.innerHTML = \`
        <div class="message-header">
          <div class="message-avatar">\${avatar}</div>
          <span>\${label}</span>
        </div>
        <div class="message-content">
          \${renderedContent}
        </div>
        \${chipRow}
      \`;
      
      messagesContainer.appendChild(messageDiv);
      attachCopy(messageDiv, () => content);
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
      updateEnginePill(currentMode);
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
      updateEnginePill(currentMode);
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
      updateEnginePill(currentMode);
      vscode.postMessage({ type: 'selectLocalModel', value: localSelect.value });
    }

    function applyMode(mode) {
      currentMode = mode;
      const offline = mode === 'offline';
      const online = mode === 'online';
      const auto = mode === 'auto';
      document.querySelectorAll('.seg-btn').forEach((b) => {
        b.classList.toggle('active', b.getAttribute('data-mode') === mode);
      });
      document.querySelectorAll('.engine-tab').forEach((b) => {
        b.classList.toggle('active', b.getAttribute('data-eg') === mode);
      });
      // Auto shows both pickers (it routes between them); each explicit mode
      // shows only the field it actually uses.
      const offlineField = document.getElementById('offlineField');
      const onlineField = document.getElementById('onlineField');
      const autoCard = document.getElementById('autoCard');
      if (offlineField) { offlineField.hidden = !(offline || auto); }
      if (onlineField) { onlineField.hidden = !(online || auto); }
      if (autoCard) { autoCard.hidden = !auto; }
      updateEnginePill(mode);
      const scope = auto ? 'Auto' : (offline ? 'Local' : 'Cloud');
      const crumbScope = document.getElementById('crumbScope');
      if (crumbScope) { crumbScope.textContent = scope; }
      const footScope = document.getElementById('footScope');
      if (footScope) { footScope.textContent = auto ? '⚡ Auto' : (offline ? '🖥 Local' : '☁ Cloud'); }
    }

    /** Reflect the active engine + its chosen model on the composer pill. */
    function updateEnginePill(mode) {
      const pill = document.getElementById('enginePill');
      if (!pill) { return; }
      let label;
      if (mode === 'auto') {
        label = '⚡ Auto';
      } else if (mode === 'offline') {
        const opt = localSelect.selectedOptions && localSelect.selectedOptions[0];
        label = '● ' + ((opt && opt.textContent) || 'Local model');
      } else {
        const opt = modelSelect.selectedOptions && modelSelect.selectedOptions[0];
        label = '☁ ' + ((opt && opt.textContent) || 'Cloud model');
      }
      pill.textContent = label + ' ▾';
      pill.className = 'engine-pill ' + mode;
    }

    function toggleEngine(force) {
      const show = (typeof force === 'boolean') ? force : enginePopover.hidden;
      enginePopover.hidden = !show;
    }

    // Choosing a tab sets the routing mode; applyMode re-syncs the tabs, the
    // visible model fields, the Auto card and the composer pill. The popover
    // stays open so the model list for the chosen engine is right there.
    function pickEngine(mode) {
      setMode(mode);
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
      if (btn) {
        btn.setAttribute('aria-disabled', working ? 'false' : 'true');
        btn.textContent = working ? '■' : '⏸';
        btn.title = working ? 'Stop the current turn' : 'Pause';
      }
      const status = document.getElementById('footStatus');
      if (status) { status.textContent = working ? '● Working' : '● Ready'; status.style.color = working ? '#3b82f6' : '#22c55e'; }
    }

    // Stop is live only while a turn runs; clicking it aborts the stream or the
    // agent loop extension-side (AbortController), never just the rendering.
    document.getElementById('pauseBtn').addEventListener('click', () => {
      if (document.getElementById('pauseBtn').getAttribute('aria-disabled') !== 'true') {
        vscode.postMessage({ type: 'stopGeneration' });
      }
    });

    function toggleAgent() {
      const btn = document.getElementById('agentToggle');
      const next = !btn.classList.contains('active');
      renderAgent(next);
      vscode.postMessage({ type: 'toggleAgent', value: next });
    }

    function renderAgent(on) {
      const btn = document.getElementById('agentToggle');
      if (!btn) { return; }
      btn.classList.toggle('active', Boolean(on));
      btn.title = on
        ? 'Agent mode: the assistant plans steps and uses workspace tools (click to turn off)'
        : 'Agent mode is off: one streamed answer per turn (click to turn on)';
    }

    function attachContext() {
      vscode.postMessage({ type: 'attachContext' });
    }

    function renderChips(chips) {
      const row = document.getElementById('chipsRow');
      if (!row) { return; }
      row.innerHTML = '';
      row.classList.toggle('active', (chips || []).length > 0);
      for (const c of chips || []) {
        const chip = document.createElement('span');
        chip.className = 'ctx-chip';
        chip.title = 'Attached to your next message';
        const label = document.createElement('span');
        label.textContent = c.label;
        const x = document.createElement('button');
        x.className = 'chip-x';
        x.textContent = '✕';
        x.title = 'Remove';
        x.onclick = () => vscode.postMessage({ type: 'removeChip', id: c.id });
        chip.appendChild(label);
        chip.appendChild(x);
        row.appendChild(chip);
      }
    }

    // --- Live streaming turns -------------------------------------------
    const streams = new Map();

    /** Right-hand duration badge on the reasoning disclosure. */
    function setThoughtSummary(s, active) {
      const summary = s.thinkingEl.querySelector('summary');
      if (!summary) { return; }
      if (active) { summary.textContent = 'Thinking\u2026'; return; }
      const secs = s.thinkMs ? Math.max(1, Math.round(s.thinkMs / 1000)) : 0;
      summary.innerHTML = 'Thought' + (secs ? ' <span class="thought-badge">' + secs + 's</span>' : '');
    }

    /** Attach a hover Copy action to a message bubble. */
    function attachCopy(container, getText) {
      const bar = document.createElement('div');
      bar.className = 'msg-actions';
      const btn = document.createElement('button');
      btn.className = 'msg-copy';
      btn.textContent = '\u29C9 Copy';
      btn.title = 'Copy this message';
      btn.onclick = () => vscode.postMessage({ type: 'copyMessage', value: getText() });
      bar.appendChild(btn);
      container.appendChild(bar);
    }

    function openStream(id) {
      hideTypingForStream();
      const div = document.createElement('div');
      div.className = 'message assistant';
      div.innerHTML =
        '<div class="message-header"><div class="message-avatar"></div><span>Surf AI</span></div>'
        + '<div class="steps" hidden></div>'
        + '<details class="stream-thinking" hidden><summary>Thinking…</summary><div class="stream-thinking-body"></div></details>'
        + '<div class="message-content"></div>';
      messagesContainer.appendChild(div);
      const details = div.querySelector('.stream-thinking');
      details.addEventListener('toggle', (e) => {
        e.stopPropagation();
        const s = streams.get(id);
        if (s) { s.thinkingOpen = details.open; }
      });
      streams.set(id, {
        div,
        raw: '',
        thinking: '',
        thinkingOpen: false,
        thinkStart: 0,
        thinkMs: 0,
        renderTimer: null,
        contentEl: div.querySelector('.message-content'),
        stepsEl: div.querySelector('.steps'),
        thinkingEl: details,
        thinkingBody: div.querySelector('.stream-thinking-body')
      });
      scrollBottom();
    }

    function appendDelta(id, kind, text) {
      const s = streams.get(id);
      if (!s || !text) { return; }
      if (kind === 'thinking') {
        if (!s.thinkStart) { s.thinkStart = Date.now(); setThoughtSummary(s, true); }
        s.thinking += text;
        s.thinkingEl.hidden = false;
        s.thinkingBody.textContent = s.thinking;
        scrollBottom();
        return;
      }
      if (s.thinkStart && !s.thinkMs) { s.thinkMs = Date.now() - s.thinkStart; setThoughtSummary(s, false); }
      s.raw += text;
      if (!s.renderTimer) {
        s.renderTimer = setTimeout(() => {
          s.renderTimer = null;
          s.contentEl.innerHTML = renderMarkdown(s.raw);
          scrollBottom();
        }, 80);
      }
    }

    function addStep(id, label) {
      const s = streams.get(id);
      if (!s) { return; }
      const last = s.stepsEl.lastElementChild;
      if (last) { last.classList.add('done'); }
      s.stepsEl.hidden = false;
      const pill = document.createElement('span');
      pill.className = 'step-pill';
      pill.textContent = label;
      s.stepsEl.appendChild(pill);
      scrollBottom();
    }

    function endStream(id) {
      const s = streams.get(id);
      if (!s) { return; }
      if (s.renderTimer) { clearTimeout(s.renderTimer); }
      if (s.thinkStart && !s.thinkMs) { s.thinkMs = Date.now() - s.thinkStart; }
      if (!s.thinkingEl.hidden) { setThoughtSummary(s, false); }
      s.contentEl.innerHTML = renderMarkdown(s.raw || 'Done.');
      attachCopy(s.div, () => s.raw);
      const last = s.stepsEl.lastElementChild;
      if (last) { last.classList.add('done'); }
      if (s.thinkingEl.open) {
        // Auto-collapsed once the answer landed; the user can reopen it.
        s.thinkingEl.open = false;
      }
      streams.delete(id);
      scrollBottom();
    }

    function hideTypingForStream() {
      typingIndicator.classList.remove('active');
    }

    function scrollBottom() {
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
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
      updateEnginePill(currentMode);
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
      // A bare '@' opens the context picker, once per @ token.
      const before = this.value.slice(0, this.selectionStart);
      if (/(^|\s)@$/.test(before)) {
        vscode.postMessage({ type: 'inputAtToken', textBefore: before });
      }
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
