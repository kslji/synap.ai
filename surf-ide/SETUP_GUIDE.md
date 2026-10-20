# Surf IDE - VSCode Fork Setup Guide

## Overview

This guide walks you through setting up Surf IDE, a VSCode fork with integrated AI capabilities.

## Prerequisites

- **macOS 12+** or **Windows 10/11**
- **Node.js 22+** (verified: `node --version`)
- **Python 3.12+** (verified: `python3 --version`)
- **Git** (verified: `git --version`)
- **Xcode Command Line Tools** (macOS): `xcode-select --install`
- **Visual Studio Build Tools** (Windows): Download from https://visualstudio.microsoft.com/visual-cpp-build-tools/

## Step 1: Fork VSCode Repository

### Option A: Create Your Own Fork (Recommended)

1. Go to https://github.com/microsoft/vscode
2. Click "Fork" button (top-right)
3. Select your GitHub account
4. Clone your fork:

```bash
cd /Users/arjunsingh/Desktop/surf.ai/surf-ide
git clone https://github.com/YOUR_GITHUB_USERNAME/vscode.git code-oss
cd code-oss
git remote add upstream https://github.com/microsoft/vscode.git
```

### Option B: Direct Clone (Quick Start)

```bash
cd /Users/arjunsingh/Desktop/surf.ai/surf-ide
git clone https://github.com/microsoft/vscode.git code-oss
cd code-oss
```

## Step 2: Install Dependencies

### macOS

```bash
# Install build dependencies
brew install python pkg-config pixman pango cairo

# Install Node dependencies
npm install
```

### Windows

```powershell
# Install Node dependencies
npm install

# Install Python dependencies
npm install --global windows-build-tools
```

## Step 3: Apply Surf Branding

### 3.1 Update product.json

Create `product.json` in the VSCode root:

```bash
cd /Users/arjunsingh/Desktop/surf.ai/surf-ide/code-oss
cp product.json product.json.backup
```

Edit `product.json` and update these fields:

```json
{
  "nameShort": "Surf IDE",
  "nameLong": "Surf IDE - AI-Powered Development Environment",
  "applicationName": "surf-ide",
  "dataFolderName": ".surf-ide",
  "win32AppId": "{E3F7C2A1-8B4D-4F3E-9C5A-2D6B8F1E3A7C}",
  "win32DirName": "Surf IDE",
  "win32NameVersion": "Surf IDE",
  "darwinBundleIdentifier": "ai.surf.ide",
  "reportIssueUrl": "https://github.com/kslji/surf.ai/issues",
  "urlProtocol": "surf-ide",
  "webEndpointUrl": "https://vscode.dev",
  "extensionsGallery": {
    "serviceUrl": "https://marketplace.visualstudio.com/_apis/public/gallery",
    "itemUrl": "https://marketplace.visualstudio.com/items"
  }
}
```

### 3.2 Add Surf Logo

Download or create a Surf logo:
- `resources/darwin/code.icns` (macOS)
- `resources/win32/code.ico` (Windows)
- `resources/linux/code.png` (Linux)

For now, you can use placeholder icons or generate them with AI tools.

### 3.3 Update Package.json

```bash
# Update package name
npm pkg set name="surf-ide"
npm pkg set productName="Surf IDE"
```

## Step 4: Build VSCode

### Development Build

```bash
# Compile
npm run watch

# In another terminal, run Electron
./scripts/code.sh  # macOS/Linux
.\scripts\code.bat  # Windows
```

### Production Build

```bash
# macOS
npm run gulp vscode-darwin-arm64  # Apple Silicon
npm run gulp vscode-darwin-x64    # Intel

# Windows
npm run gulp vscode-win32-x64
```

The built app will be in:
- macOS: `VSCode-darwin-arm64/` or `VSCode-darwin-x64/`
- Windows: `VSCode-win32-x64/`

## Step 5: Create Surf AI Extension

### 5.1 Extension Scaffold

```bash
cd /Users/arjunsingh/Desktop/surf.ai/surf-ide/code-oss
mkdir -p extensions/surf-ai
cd extensions/surf-ai
npm init -y
```

### 5.2 Extension Structure

Create the following files:

```
extensions/surf-ai/
├── package.json
├── tsconfig.json
├── src/
│   ├── extension.ts          # Main entry point
│   ├── chat-sidebar.ts       # Chat UI
│   ├── offline-mode.ts       # llama.cpp integration
│   ├── online-mode.ts        # OpenRouter API
│   ├── router.ts             # Smart routing
│   ├── inline-completions.ts # Code completions
│   └── billing.ts            # Usage tracking
└── media/
    └── icon.png
```

### 5.3 package.json

```json
{
  "name": "surf-ai",
  "displayName": "Surf AI",
  "description": "AI-powered coding assistant with offline + online modes",
  "version": "0.1.0",
  "publisher": "surf-ai",
  "engines": {
    "vscode": "^1.85.0"
  },
  "categories": ["AI", "Machine Learning", "Chat"],
  "activationEvents": ["onStartupFinished"],
  "main": "./out/extension.js",
  "contributes": {
    "viewsContainers": {
      "activitybar": [
        {
          "id": "surf-ai",
          "title": "Surf AI",
          "icon": "media/icon.png"
        }
      ]
    },
    "views": {
      "surf-ai": [
        {
          "type": "webview",
          "id": "surf-ai.chat",
          "name": "Chat"
        }
      ]
    },
    "commands": [
      {
        "command": "surf-ai.openChat",
        "title": "Surf AI: Open Chat"
      },
      {
        "command": "surf-ai.toggleMode",
        "title": "Surf AI: Toggle Offline/Online Mode"
      }
    ],
    "configuration": {
      "title": "Surf AI",
      "properties": {
        "surf-ai.mode": {
          "type": "string",
          "default": "auto",
          "enum": ["auto", "offline", "online"],
          "description": "AI mode: auto (smart routing), offline (local), online (cloud)"
        },
        "surf-ai.apiBaseUrl": {
          "type": "string",
          "default": "http://localhost:8000",
          "description": "Surf API base URL"
        },
        "surf-ai.localModelPath": {
          "type": "string",
          "default": "",
          "description": "Path to local Qwen model (GGUF format)"
        }
      }
    }
  },
  "scripts": {
    "vscode:prepublish": "npm run compile",
    "compile": "tsc -p ./",
    "watch": "tsc -watch -p ./"
  },
  "devDependencies": {
    "@types/vscode": "^1.85.0",
    "@types/node": "^22.0.0",
    "typescript": "^5.3.0"
  },
  "dependencies": {
    "axios": "^1.6.0"
  }
}
```

### 5.4 tsconfig.json

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2022",
    "outDir": "out",
    "lib": ["ES2022"],
    "sourceMap": true,
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "exclude": ["node_modules", ".vscode-test"]
}
```

### 5.5 extension.ts (Basic Scaffold)

```typescript
import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
  console.log('Surf AI extension activated');

  // Register chat sidebar
  const provider = new ChatViewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('surf-ai.chat', provider)
  );

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('surf-ai.openChat', () => {
      vscode.commands.executeCommand('workbench.view.extension.surf-ai');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('surf-ai.toggleMode', async () => {
      const config = vscode.workspace.getConfiguration('surf-ai');
      const currentMode = config.get<string>('mode');
      const newMode = currentMode === 'offline' ? 'online' : 'offline';
      await config.update('mode', newMode, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(`Surf AI: Switched to ${newMode} mode`);
    })
  );
}

export function deactivate() {
  console.log('Surf AI extension deactivated');
}

class ChatViewProvider implements vscode.WebviewViewProvider {
  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    token: vscode.CancellationToken
  ) {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri]
    };

    webviewView.webview.html = this.getHtmlForWebview();
  }

  private getHtmlForWebview() {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: var(--vscode-font-family); padding: 10px; }
          .chat-container { display: flex; flex-direction: column; height: 100vh; }
          .messages { flex: 1; overflow-y: auto; margin-bottom: 10px; }
          .input-area { display: flex; gap: 5px; }
          input { flex: 1; padding: 8px; }
          button { padding: 8px 16px; }
        </style>
      </head>
      <body>
        <div class="chat-container">
          <div class="messages" id="messages">
            <p>Welcome to Surf AI! Ask me anything about your code.</p>
          </div>
          <div class="input-area">
            <input type="text" id="input" placeholder="Ask a question..." />
            <button onclick="sendMessage()">Send</button>
          </div>
        </div>
        <script>
          const vscode = acquireVsCodeApi();
          function sendMessage() {
            const input = document.getElementById('input');
            const messages = document.getElementById('messages');
            const text = input.value;
            if (text.trim()) {
              messages.innerHTML += '<p><strong>You:</strong> ' + text + '</p>';
              vscode.postMessage({ type: 'message', text: text });
              input.value = '';
            }
          }
          window.addEventListener('message', event => {
            const messages = document.getElementById('messages');
            messages.innerHTML += '<p><strong>Surf AI:</strong> ' + event.data.text + '</p>';
          });
        </script>
      </body>
      </html>
    `;
  }
}
```

## Step 6: Connect to Backend

### 6.1 Update API Base URL

The extension should connect to your existing Surf API:

```typescript
// In online-mode.ts
const API_BASE_URL = vscode.workspace.getConfiguration('surf-ai').get<string>('apiBaseUrl') || 'http://localhost:8000';

async function sendToOpenRouter(prompt: string, context: string): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/api/v1/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${await getAuthToken()}`
    },
    body: JSON.stringify({ prompt, context })
  });
  const data = await response.json();
  return data.response;
}
```

### 6.2 Authentication

Connect to your MySQL auth backend:

```typescript
async function getAuthToken(): Promise<string> {
  // Get token from VSCode secret storage
  const token = await context.secrets.get('surf-ai.authToken');
  if (!token) {
    // Prompt user to login
    const email = await vscode.window.showInputBox({ prompt: 'Enter your email' });
    const password = await vscode.window.showInputBox({ prompt: 'Enter your password', password: true });
    const response = await fetch(`${API_BASE_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await response.json();
    await context.secrets.store('surf-ai.authToken', data.access_token);
    return data.access_token;
  }
  return token;
}
```

## Step 7: Build & Test

### 7.1 Compile Extension

```bash
cd extensions/surf-ai
npm install
npm run compile
```

### 7.2 Test in Development

```bash
# From VSCode root
./scripts/code.sh  # macOS
```

The extension should load automatically. Open the Surf AI sidebar and test the chat.

## Next Steps

After completing this setup:

1. ✅ Implement offline mode (llama.cpp integration)
2. ✅ Implement smart routing (cache → cloud → local)
3. ✅ Add inline code completions
4. ✅ Build installers (DMG/EXE)
5. ✅ Test with existing backend

## Troubleshooting

### Build Errors

- **Node version mismatch**: Ensure Node 22+ (`nvm use 22`)
- **Python not found**: Install Python 3.12+ and ensure it's in PATH
- **Missing dependencies**: Run `npm install` again

### Extension Not Loading

- Check VSCode Developer Tools (Help > Toggle Developer Tools)
- Verify `package.json` has correct `engines.vscode` version
- Ensure extension is in `extensions/` directory

### Backend Connection Issues

- Verify API is running: `curl http://localhost:8000/api/v1/health`
- Check CORS settings in `services/api/app/main.py`
- Verify auth token is valid

## Resources

- [VSCode Extension API](https://code.visualstudio.com/api)
- [VSCode Fork Guide](https://github.com/microsoft/vscode/wiki/Forking)
- [Surf API Documentation](../services/api/README.md)
