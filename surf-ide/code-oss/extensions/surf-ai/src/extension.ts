/**
 * Surf AI Extension - Main Entry Point
 * 
 * AI-powered coding assistant with offline + online modes
 */

import * as vscode from 'vscode';
import { extractContext, buildPromptWithContext } from './context-extractor';
import { ChatSidebarProvider } from './chat-sidebar';

export function activate(context: vscode.ExtensionContext) {
  console.log('Surf AI extension activated');

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

  // Register inline completion provider
  const completionProvider = new SurfInlineCompletionProvider();
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
 * Inline completion provider (ghost text)
 */
class SurfInlineCompletionProvider implements vscode.InlineCompletionItemProvider {
  private debounceTimer: NodeJS.Timeout | undefined;
  private lastTriggerTime = 0;

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
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

          const prompt = `Complete this code naturally:

${prefix}
// Continue from here:
${suffix}
`;

          const response = await fetch('http://localhost:8080/completion', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              prompt: prompt,
              n_predict: 100,
              temperature: 0.2,
              stop: ['\n\n', 'User:', 'Human:']
            })
          });

          if (!response.ok) {
            resolve([]);
            return;
          }

          const data = await response.json() as { content: string };
          const completion = data.content.trim();

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
}
