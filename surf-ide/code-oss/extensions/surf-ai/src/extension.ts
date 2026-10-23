/**
 * Surf AI Extension - Main Entry Point
 * 
 * AI-powered coding assistant with offline + online modes
 */

import * as vscode from 'vscode';
import { extractContext, buildPromptWithContext } from './context-extractor';
import { ChatSidebarProvider } from './chat-sidebar';
import { GatewayClient } from './gateway-client';
import { LocalModelClient } from './local-model-client';
import { MODE_STATE_KEY, resolveRoute, type SurfMode } from './model-router';

export async function activate(context: vscode.ExtensionContext) {
  console.log('Surf AI extension activated');

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

  // Register chat sidebar with new Qoder-like UI
  const chatProvider = new ChatSidebarProvider(context.extensionUri, context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('surf-ai.chat', chatProvider)
  );

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('surf-ai.openChat', () => {
      vscode.commands.executeCommand('workbench.view.extension.surf-ai');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('surf-ai.askQuestion', async () => {
      const question = await vscode.window.showInputBox({
        prompt: 'Ask Surf AI a question',
        placeHolder: 'How do I fix this error?'
      });
      
      if (question) {
        // Focus the chat sidebar
        vscode.commands.executeCommand('workbench.view.extension.surf-ai');
        // Note: Direct message passing would require additional implementation
        vscode.window.showInformationMessage('Please use the chat sidebar to ask questions');
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('surf-ai.explainSelection', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage('No active editor');
        return;
      }

      const selection = editor.document.getText(editor.selection);
      if (!selection) {
        vscode.window.showErrorMessage('No text selected');
        return;
      }

      // Focus the chat sidebar
      vscode.commands.executeCommand('workbench.view.extension.surf-ai');
      vscode.window.showInformationMessage('Selection copied. Paste it in the chat sidebar.');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('surf-ai.fixErrors', async () => {
      // Focus the chat sidebar
      vscode.commands.executeCommand('workbench.view.extension.surf-ai');
      vscode.window.showInformationMessage('Please type your question in the chat sidebar');
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
  await setIfUnset('chat', 'commandCenter.enabled', false);
  await setIfUnset('chat', 'detectParticipant.enabled', false);
}

/**
 * Inline completion provider (ghost text).
 *
 * Routes by the same explicit choice the chat sidebar stores (Offline or
 * Online); with no choice yet, the sidebar's default Offline wins and nothing
 * leaves the device. The old hardcoded `localhost:8080` never matched the
 * desktop's random-port bridge, so offline completions did not actually work;
 * the bridge descriptor does.
 */
class SurfInlineCompletionProvider implements vscode.InlineCompletionItemProvider {
  private debounceTimer: NodeJS.Timeout | undefined;
  private readonly gateway: GatewayClient;
  private readonly local: LocalModelClient;
  private readonly context: vscode.ExtensionContext;
  private onlineModel: string | null = null;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.gateway = new GatewayClient(context);
    this.local = new LocalModelClient();
  }

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _context: vscode.InlineCompletionContext,
    _token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionItem[]> {
    // Debounce: wait 500ms after typing stops
    return new Promise((resolve) => {
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }

      this.debounceTimer = setTimeout(async () => {
        try {
          const prefix = document.getText(new vscode.Range(
            new vscode.Position(Math.max(0, position.line - 10), 0),
            position
          ));

          const suffix = document.getText(new vscode.Range(
            position,
            new vscode.Position(Math.min(document.lineCount, position.line + 5), 0)
          ));

          const prompt = `Complete this code naturally:\n\n${prefix}\n// Continue from here:\n${suffix}\n`;

          const mode: SurfMode = this.context.workspaceState.get<SurfMode>(MODE_STATE_KEY) === 'online' ? 'online' : 'offline';
          const route = await resolveRoute(mode, this.gateway, this.local);
          let completion = '';
          if (route === 'offline') {
            completion = await this.local.complete(prompt);
          } else {
            const model = await this.pickOnlineModel();
            if (!model) {
              resolve([]);
              return;
            }
            completion = await this.gateway.chat(model, prompt);
          }

          completion = (completion || '').trim();
          if (completion) {
            resolve([{
              insertText: completion,
              range: new vscode.Range(position, position)
            }]);
          } else {
            resolve([]);
          }
        } catch (error) {
          resolve([]);
        }
      }, 500);
    });
  }

  /** First allowlisted gateway model, cached. Null when none are available. */
  private async pickOnlineModel(): Promise<string | null> {
    if (this.onlineModel) {
      return this.onlineModel;
    }
    try {
      const models = await this.gateway.listModels();
      this.onlineModel = models[0]?.id ?? null;
    } catch {
      this.onlineModel = null;
    }
    return this.onlineModel;
  }
}
