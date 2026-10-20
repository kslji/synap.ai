/**
 * Surf AI Extension - Main Entry Point
 * 
 * AI-powered coding assistant with offline + online modes
 */

import * as vscode from 'vscode';
import { extractContext, buildPromptWithContext } from './context-extractor';

let chatView: vscode.WebviewView | undefined;

export function activate(context: vscode.ExtensionContext) {
  console.log('Surf AI extension activated');

  // Register chat sidebar
  const chatProvider = new ChatViewProvider(context.extensionUri, context);
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
        await chatProvider.handleUserMessage(question);
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

      await chatProvider.handleUserMessage(`Explain this code:\n\n${selection}`);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('surf-ai.fixErrors', async () => {
      await chatProvider.handleUserMessage('Fix the errors in my code');
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
 * Chat sidebar webview provider
 */
class ChatViewProvider implements vscode.WebviewViewProvider {
  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly context: vscode.ExtensionContext
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    token: vscode.CancellationToken
  ) {
    chatView = webviewView;
    
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri]
    };

    webviewView.webview.html = this.getHtmlForWebview();

    // Handle messages from webview
    webviewView.webview.onDidReceiveMessage(async (data) => {
      if (data.type === 'userMessage') {
        await this.handleUserMessage(data.text);
      }
    });
  }

  async handleUserMessage(message: string) {
    // Show loading state
    chatView?.webview.postMessage({
      type: 'assistantMessage',
      text: 'Thinking...',
      loading: true
    });

    try {
      // Extract context from IDE
      const context = await extractContext();
      
      // Build prompt with context
      const prompt = buildPromptWithContext(message, context);
      
      // Send to AI (online or offline)
      const config = vscode.workspace.getConfiguration('surf-ai');
      const mode = config.get<string>('mode') || 'auto';
      const apiBaseUrl = config.get<string>('apiBaseUrl') || 'http://localhost:8000';
      
      let response: string;
      
      if (mode === 'offline') {
        response = await this.sendToLocalModel(prompt);
      } else if (mode === 'online') {
        response = await this.sendToCloudAPI(prompt, apiBaseUrl);
      } else {
        // Auto mode: try offline first, fall back to online
        try {
          response = await this.sendToLocalModel(prompt);
        } catch (error) {
          response = await this.sendToCloudAPI(prompt, apiBaseUrl);
        }
      }
      
      // Send response to webview
      chatView?.webview.postMessage({
        type: 'assistantMessage',
        text: response,
        loading: false
      });
    } catch (error) {
      chatView?.webview.postMessage({
        type: 'assistantMessage',
        text: `Error: ${(error as Error).message}`,
        loading: false
      });
    }
  }

  private async sendToLocalModel(prompt: string): Promise<string> {
    const response = await fetch('http://localhost:8080/completion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: prompt,
        n_predict: 2000,
        temperature: 0.7,
        stop: ['</s>', 'User:', 'Human:']
      })
    });
    
    if (!response.ok) {
      throw new Error('Local model unavailable');
    }
    
    const data = await response.json();
    return data.content;
  }

  private async sendToCloudAPI(prompt: string, baseUrl: string): Promise<string> {
    const authToken = await this.context.secrets.get('surf-ai.authToken');
    
    const response = await fetch(`${baseUrl}/api/v1/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({
        model: 'gpt-4',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 2000
      })
    });
    
    if (!response.ok) {
      throw new Error(`API error: ${response.statusText}`);
    }
    
    const data = await response.json();
    return data.choices[0].message.content;
  }

  private getHtmlForWebview() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Surf AI Chat</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      padding: 0;
      margin: 0;
      height: 100vh;
      display: flex;
      flex-direction: column;
    }
    .chat-container {
      display: flex;
      flex-direction: column;
      height: 100%;
    }
    .messages {
      flex: 1;
      overflow-y: auto;
      padding: 10px;
    }
    .message {
      margin-bottom: 15px;
      padding: 10px;
      border-radius: 5px;
    }
    .message.user {
      background: var(--vscode-input-background);
      border-left: 3px solid var(--vscode-focusBorder);
    }
    .message.assistant {
      background: var(--vscode-editor-background);
      border-left: 3px solid var(--vscode-terminal-ansiGreen);
    }
    .message.loading {
      opacity: 0.6;
    }
    .message pre {
      background: var(--vscode-textCodeBlock-background);
      padding: 10px;
      border-radius: 3px;
      overflow-x: auto;
    }
    .message code {
      font-family: var(--vscode-editor-font-family);
    }
    .input-area {
      display: flex;
      gap: 5px;
      padding: 10px;
      border-top: 1px solid var(--vscode-panel-border);
    }
    .input-area textarea {
      flex: 1;
      padding: 8px;
      border: 1px solid var(--vscode-input-border);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      resize: none;
      font-family: var(--vscode-font-family);
    }
    .input-area button {
      padding: 8px 16px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      cursor: pointer;
    }
    .input-area button:hover {
      background: var(--vscode-button-hoverBackground);
    }
  </style>
</head>
<body>
  <div class="chat-container">
    <div class="messages" id="messages">
      <div class="message assistant">
        <p>🏄 Welcome to Surf AI! Ask me anything about your code.</p>
        <p>Try:</p>
        <ul>
          <li>"Explain this function"</li>
          <li>"Fix the errors in my code"</li>
          <li>"How do I implement X?"</li>
        </ul>
      </div>
    </div>
    <div class="input-area">
      <textarea id="input" placeholder="Ask a question..." rows="3"></textarea>
      <button onclick="sendMessage()">Send</button>
    </div>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    
    function sendMessage() {
      const input = document.getElementById('input');
      const text = input.value.trim();
      if (text) {
        addMessage('user', text);
        vscode.postMessage({ type: 'userMessage', text: text });
        input.value = '';
      }
    }
    
    function addMessage(role, text, loading = false) {
      const messages = document.getElementById('messages');
      const div = document.createElement('div');
      div.className = 'message ' + role + (loading ? ' loading' : '');
      
      // Simple markdown-like rendering
      let html = text
        .replace(/\\\`\\\`\\\`(\\w+)?\\n([\\s\\S]*?)\\n\\`\\`\\`/g, '<pre><code>$2</code></pre>')
        .replace(/\\`([^\\`]+)\\`/g, '<code>$1</code>')
        .replace(/\\*\\*([^\\*]+)\\*\\*/g, '<strong>$1</strong>')
        .replace(/\\n/g, '<br>');
      
      div.innerHTML = html;
      messages.appendChild(div);
      messages.scrollTop = messages.scrollHeight;
    }
    
    window.addEventListener('message', event => {
      const message = event.data;
      if (message.type === 'assistantMessage') {
        // Remove loading message
        const loadingMsg = document.querySelector('.message.assistant.loading');
        if (loadingMsg) {
          loadingMsg.remove();
        }
        addMessage('assistant', message.text, message.loading);
      }
    });
    
    // Send on Enter (Shift+Enter for newline)
    document.getElementById('input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
  </script>
</body>
</html>`;
  }
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

          const data = await response.json();
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
