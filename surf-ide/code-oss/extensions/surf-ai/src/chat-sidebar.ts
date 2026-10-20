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

export class ChatSidebarProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private _messageHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  private _isProcessing = false;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _context: vscode.ExtensionContext
  ) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

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
        case 'copyMessage':
          vscode.env.clipboard.writeText(data.value);
          vscode.window.showInformationMessage('Copied to clipboard');
          break;
      }
    });

    // Send welcome message
    this._sendWelcomeMessage();
  }

  private async _handleUserMessage(message: string) {
    if (this._isProcessing) {
      return;
    }

    this._isProcessing = true;
    this._messageHistory.push({ role: 'user', content: message });

    // Show user message in UI
    this._postMessage({
      type: 'addMessage',
      role: 'user',
      content: message
    });

    // Show typing indicator
    this._postMessage({ type: 'showTyping' });

    try {
      // Extract IDE context
      const context = await extractContext();
      
      // Build prompt with context
      const prompt = buildPromptWithContext(message, context);

      // Route to AI (smart routing: cache → cloud → local)
      const response = await this._routeQuery(prompt);

      // Add to history
      this._messageHistory.push({ role: 'assistant', content: response });

      // Hide typing indicator and show response
      this._postMessage({
        type: 'addMessage',
        role: 'assistant',
        content: response
      });
    } catch (error) {
      this._postMessage({
        type: 'addMessage',
        role: 'assistant',
        content: `❌ Error: ${(error as Error).message}`
      });
    } finally {
      this._isProcessing = false;
      this._postMessage({ type: 'hideTyping' });
    }
  }

  private async _routeQuery(prompt: string): Promise<string> {
    // TODO: Implement smart routing
    // For now, use local model if available, otherwise show error
    
    try {
      // Try local model first
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

      if (response.ok) {
        const data = await response.json() as { content: string };
        return data.content;
      }
    } catch (error) {
      // Local model not available
    }

    // Fallback: Try cloud API
    try {
      const token = await this._context.secrets.get('surf-ai.authToken');
      if (token) {
        const response = await fetch('http://localhost:8000/api/v1/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            model: 'gpt-4',
            messages: [{ role: 'user', content: prompt }]
          })
        });

        if (response.ok) {
          const data = await response.json() as { choices: Array<{ message: { content: string } }> };
          return data.choices[0].message.content;
        }
      }
    } catch (error) {
      // Cloud API not available
    }

    return '⚠️ No AI backend available. Please start llama.cpp server or connect to the backend.\n\nTo start local model:\n```bash\n./llama-server --model ~/.surf-ide/models/Qwen2.5-2B-Q4_K_M.gguf --port 8080\n```';
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
    <div class="header">
      <div class="header-title">
        <span>🏄</span>
        <span>Surf AI Chat</span>
      </div>
      <div class="header-actions">
        <button class="icon-button" onclick="clearChat()" title="Clear chat">
          🗑️
        </button>
      </div>
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

    <!-- Input Area -->
    <div class="input-area">
      <div class="input-wrapper">
        <textarea 
          id="inputField" 
          class="input-field" 
          placeholder="Ask a question about your code..."
          onkeydown="handleKeyDown(event)"
        ></textarea>
        <div class="input-actions">
          <span class="input-hint">⌘ + Enter to send</span>
          <button class="send-button" id="sendButton" onclick="sendMessage()">
            Send
          </button>
        </div>
      </div>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const messagesContainer = document.getElementById('messages');
    const inputField = document.getElementById('inputField');
    const sendButton = document.getElementById('sendButton');
    const typingIndicator = document.getElementById('typingIndicator');

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
          break;
        case 'hideTyping':
          typingIndicator.classList.remove('active');
          break;
        case 'clearChat':
          messagesContainer.innerHTML = '';
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
      html = html.replace(codeBlockRegex, '<pre><code class="language-$1">$2</code></pre>');
      
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
