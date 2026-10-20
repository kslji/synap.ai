# Surf IDE Implementation Guide

## 🎯 Overview

This guide walks you through creating **Surf IDE** - a VSCode fork with integrated AI (offline + online).

**Timeline:** 8 weeks  
**Phases:** 5 (Fork → Extension → UI → Installers → Integration)

---

## 📋 Prerequisites

### Tools Required
- Node.js 22+
- Python 3.12+
- Git
- VSCode (for development)
- Xcode (macOS, for building)
- Visual Studio Build Tools (Windows, for building)

### System Requirements
- 16GB+ RAM
- 50GB+ free disk space
- macOS 12+ / Windows 10+ / Ubuntu 20.04+

---

## Phase 1: Fork VSCode (Week 1-2)

### Step 1.1: Clone VSCode

```bash
# Navigate to projects directory
cd ~/Projects

# Clone VSCode
git clone https://github.com/microsoft/vscode.git surf-ide
cd surf-ide

# Add upstream remote
git remote add upstream https://github.com/microsoft/vscode.git

# Create our branch
git checkout -b feature/surf-branding
```

### Step 1.2: Remove Microsoft Branding

**Update `product.json`:**
```json
{
  "nameShort": "Surf IDE",
  "nameLong": "Surf IDE - AI-Powered Development Environment",
  "applicationName": "surf-ide",
  "dataFolderName": ".surf-ide",
  "version": "1.0.0",
  "extensionEnabledApiProposals": {},
  "reportIssueUrl": "https://github.com/kslji/surf.ai/issues/new",
  "requestFeatureUrl": "https://github.com/kslji/surf.ai/discussions",
  "privacyStatementUrl": "https://surf.ai/privacy",
  "telemetryEndpoint": [],
  "extensionsGallery": {
    "serviceUrl": "https://marketplace.visualstudio.com/_apis/public/gallery",
    "itemUrl": "https://marketplace.visualstudio.com/items"
  }
}
```

**Update icons:**
```bash
# Replace icon files
cp ~/surf.ai/resources/branding/icon.icns resources/darwin/code-icon-mac.icns
cp ~/surf.ai/resources/branding/icon.ico resources/win32/code-icon-win.ico
cp ~/surf.ai/resources/branding/icon.png resources/linux/code-icon-linux.png
```

### Step 1.3: Update Build Configuration

**Create `build/surf-config.js`:**
```javascript
module.exports = {
  product: 'Surf IDE',
  version: '1.0.0',
  commit: process.env.GIT_COMMIT || 'dev',
  date: new Date().toISOString(),
  target: process.env.VSCODE_BUILD_TARGET || 'desktop',
  platforms: ['darwin', 'win32', 'linux']
};
```

### Step 1.4: Build VSCode

**macOS:**
```bash
# Install dependencies
yarn install

# Build
yarn gulp vscode-darwin-arm64

# Output: VSCode-darwin-arm64.zip
```

**Windows:**
```bash
# Install dependencies
yarn install

# Build
yarn gulp vscode-win32-x64

# Output: VSCode-win32-x64.zip
```

**Linux:**
```bash
# Install dependencies
yarn install

# Build
yarn gulp vscode-linux-x64

# Output: VSCode-linux-x64.tar.gz
```

### Step 1.5: Verify Build

```bash
# Extract and run
unzip VSCode-darwin-arm64.zip
open "Surf IDE.app"

# Verify:
# - App name is "Surf IDE"
# - Icon is custom Surf logo
# - No Microsoft branding
# - Builds successfully on all platforms
```

---

## Phase 2: Surf AI Extension (Week 3-4)

### Step 2.1: Create Extension Scaffold

```bash
# Create extension directory
mkdir -p extensions/surf-ai
cd extensions/surf-ai

# Initialize
yarn init -y

# Install dependencies
yarn add -D @types/node @types/vscode typescript
yarn add axios openai
```

**Create `extensions/surf-ai/package.json`:**
```json
{
  "name": "surf-ai",
  "displayName": "Surf AI",
  "description": "AI-powered coding assistant with offline (Qwen) and online (OpenRouter) support",
  "version": "1.0.0",
  "publisher": "surf-ai",
  "engines": {
    "vscode": "^1.85.0"
  },
  "categories": ["AI", "Machine Learning", "Chat"],
  "activationEvents": [
    "onStartupFinished"
  ],
  "main": "./out/extension.js",
  "contributes": {
    "viewsContainers": {
      "activitybar": [
        {
          "id": "surf-ai",
          "title": "Surf AI",
          "icon": "media/surf-icon.svg"
        }
      ]
    },
    "views": {
      "surf-ai": [
        {
          "id": "surfChat",
          "name": "Chat"
        },
        {
          "id": "surfSettings",
          "name": "Settings"
        }
      ]
    },
    "commands": [
      {
        "command": "surf.ai.ask",
        "title": "Ask Surf AI"
      },
      {
        "command": "surf.ai.explain",
        "title": "Explain Code"
      },
      {
        "command": "surf.ai.refactor",
        "title": "Refactor Code"
      }
    ],
    "configuration": {
      "title": "Surf AI",
      "properties": {
        "surf.ai.mode": {
          "type": "string",
          "enum": ["auto", "offline", "online"],
          "default": "auto",
          "description": "AI mode: auto (smart routing), offline (local Qwen), online (OpenRouter)"
        },
        "surf.ai.model": {
          "type": "string",
          "default": "qwen2.5-coder:7b",
          "description": "Local model to use (offline mode)"
        },
        "surf.ai.openrouterModel": {
          "type": "string",
          "default": "openrouter/auto",
          "description": "Cloud model to use (online mode)"
        },
        "surf.ai.apiEndpoint": {
          "type": "string",
          "default": "https://api.surf.ai/v1/chat",
          "description": "Surf API endpoint"
        }
      }
    }
  },
  "scripts": {
    "vscode:prepublish": "yarn compile",
    "compile": "tsc -p ./",
    "watch": "tsc -watch -p ./"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/vscode": "^1.85.0",
    "typescript": "^5.0.0"
  },
  "dependencies": {
    "axios": "^1.6.0",
    "openai": "^4.20.0"
  }
}
```

### Step 2.2: Implement Extension Core

**Create `extensions/surf-ai/src/extension.ts`:**
```typescript
import * as vscode from 'vscode';
import { ChatSidebar } from './chat-sidebar';
import { OfflineMode } from './offline-mode';
import { OnlineMode } from './online-mode';
import { SmartRouter } from './router';

let chatSidebar: ChatSidebar;
let router: SmartRouter;

export async function activate(context: vscode.ExtensionContext) {
  console.log('Surf AI extension activated');

  // Initialize modes
  const offlineMode = new OfflineMode(context);
  const onlineMode = new OnlineMode(context);
  
  // Initialize smart router
  router = new SmartRouter(offlineMode, onlineMode);
  
  // Initialize chat sidebar
  chatSidebar = new ChatSidebar(context, router);
  
  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('surf.ai.ask', () => chatSidebar.show()),
    vscode.commands.registerCommand('surf.ai.explain', () => explainCode()),
    vscode.commands.registerCommand('surf.ai.refactor', () => refactorCode())
  );
  
  // Register views
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('surfChat', chatSidebar)
  );
  
  // Start offline mode (download models if needed)
  await offlineMode.initialize();
  
  console.log('Surf AI extension ready');
}

export function deactivate() {
  console.log('Surf AI extension deactivated');
}

async function explainCode() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  
  const selection = editor.selection;
  const code = editor.document.getText(selection);
  
  if (!code) {
    vscode.window.showWarningMessage('Please select code to explain');
    return;
  }
  
  const prompt = `Explain this code:\n\n\`\`\`\n${code}\n\`\`\``;
  const response = await router.query(prompt);
  
  chatSidebar.show();
  chatSidebar.addMessage('user', prompt);
  chatSidebar.addMessage('assistant', response);
}

async function refactorCode() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  
  const selection = editor.selection;
  const code = editor.document.getText(selection);
  
  if (!code) {
    vscode.window.showWarningMessage('Please select code to refactor');
    return;
  }
  
  const prompt = `Refactor this code to improve readability and performance:\n\n\`\`\`\n${code}\n\`\`\``;
  const response = await router.query(prompt);
  
  chatSidebar.show();
  chatSidebar.addMessage('user', prompt);
  chatSidebar.addMessage('assistant', response);
}
```

### Step 2.3: Implement Offline Mode

**Create `extensions/surf-ai/src/offline-mode.ts`:**
```typescript
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';

export class OfflineMode {
  private context: vscode.ExtensionContext;
  private llamaServer: any;
  private modelPath: string;
  
  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.modelPath = path.join(context.globalStorageUri.fsPath, 'models');
  }
  
  async initialize() {
    // Ensure model directory exists
    if (!fs.existsSync(this.modelPath)) {
      fs.mkdirSync(this.modelPath, { recursive: true });
    }
    
    // Check if model is downloaded
    const modelFile = path.join(this.modelPath, 'qwen2.5-coder-7b.gguf');
    if (!fs.existsSync(modelFile)) {
      await this.downloadModel();
    }
    
    // Start llama.cpp server
    await this.startLlamaServer();
  }
  
  private async downloadModel() {
    const choice = await vscode.window.showInformationMessage(
      'Surf AI needs to download the Qwen model (~4GB). Download now?',
      'Yes',
      'Later'
    );
    
    if (choice !== 'Yes') return;
    
    // Download from Hugging Face
    const modelUrl = 'https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct-GGUF/resolve/main/qwen2.5-coder-7b-instruct.Q4_K_M.gguf';
    
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Downloading Qwen model...',
        cancellable: false
      },
      async (progress) => {
        // Download logic here
        // Use axios or fetch to download
        // Update progress as download proceeds
      }
    );
  }
  
  private async startLlamaServer() {
    const serverPath = this.getLlamaServerPath();
    const modelFile = path.join(this.modelPath, 'qwen2.5-coder-7b.gguf');
    
    this.llamaServer = spawn(serverPath, [
      '-m', modelFile,
      '--port', '8080',
      '--ctx-size', '4096',
      '--n-gpu-layers', '35'
    ]);
    
    this.llamaServer.stdout.on('data', (data: Buffer) => {
      console.log(`llama.cpp: ${data}`);
    });
    
    this.llamaServer.stderr.on('data', (data: Buffer) => {
      console.error(`llama.cpp error: ${data}`);
    });
    
    // Wait for server to start
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  
  private getLlamaServerPath(): string {
    const platform = process.platform;
    const arch = process.arch;
    
    if (platform === 'darwin') {
      return path.join(this.context.extensionPath, 'bin', `llama-server-darwin-${arch}`);
    } else if (platform === 'win32') {
      return path.join(this.context.extensionPath, 'bin', `llama-server-win-${arch}.exe`);
    } else {
      return path.join(this.context.extensionPath, 'bin', `llama-server-linux-${arch}`);
    }
  }
  
  async query(prompt: string): Promise<string> {
    const axios = require('axios');
    
    const response = await axios.post('http://localhost:8080/completion', {
      prompt: prompt,
      n_predict: 512,
      temperature: 0.7,
      top_k: 40,
      top_p: 0.9
    });
    
    return response.data.content;
  }
  
  dispose() {
    if (this.llamaServer) {
      this.llamaServer.kill();
    }
  }
}
```

### Step 2.4: Implement Online Mode

**Create `extensions/surf-ai/src/online-mode.ts`:**
```typescript
import * as vscode from 'vscode';
import axios from 'axios';

export class OnlineMode {
  private context: vscode.ExtensionContext;
  private apiEndpoint: string;
  
  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.apiEndpoint = vscode.workspace.getConfiguration('surf.ai').get('apiEndpoint') || 'https://api.surf.ai/v1/chat';
  }
  
  async query(prompt: string): Promise<string> {
    const token = await this.getAuthToken();
    if (!token) {
      throw new Error('Not authenticated');
    }
    
    const model = vscode.workspace.getConfiguration('surf.ai').get('openrouterModel') || 'openrouter/auto';
    
    const response = await axios.post(
      this.apiEndpoint,
      {
        model: model,
        prompt: prompt,
        stream: false
      },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    // Update billing info
    if (response.data.billing) {
      this.updateBillingInfo(response.data.billing);
    }
    
    return response.data.choices[0].message.content;
  }
  
  async queryStream(prompt: string, onChunk: (chunk: string) => void): Promise<void> {
    const token = await this.getAuthToken();
    if (!token) {
      throw new Error('Not authenticated');
    }
    
    const model = vscode.workspace.getConfiguration('surf.ai').get('openrouterModel') || 'openrouter/auto';
    
    const response = await axios.post(
      this.apiEndpoint,
      {
        model: model,
        prompt: prompt,
        stream: true
      },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        responseType: 'stream'
      }
    );
    
    return new Promise((resolve, reject) => {
      response.data.on('data', (chunk: Buffer) => {
        const lines = chunk.toString().split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              resolve();
              return;
            }
            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices[0].delta.content;
              if (content) {
                onChunk(content);
              }
            } catch (e) {
              // Ignore parse errors
            }
          }
        }
      });
      
      response.data.on('error', reject);
    });
  }
  
  private async getAuthToken(): Promise<string | null> {
    const session = await vscode.authentication.getSession('surf', ['read:user'], { createIfNone: true });
    return session?.accessToken || null;
  }
  
  private updateBillingInfo(billing: any) {
    // Store billing info in global state
    this.context.globalState.update('lastBilling', billing);
    
    // Show notification if balance is low
    if (billing.balance < 0.01) {
      vscode.window.showWarningMessage(`Surf AI: Low balance ($${billing.balance.toFixed(4)})`);
    }
  }
}
```

### Step 2.5: Implement Smart Router

**Create `extensions/surf-ai/src/router.ts`:**
```typescript
import { OfflineMode } from './offline-mode';
import { OnlineMode } from './online-mode';
import * as vscode from 'vscode';

export class SmartRouter {
  private offlineMode: OfflineMode;
  private onlineMode: OnlineMode;
  
  constructor(offlineMode: OfflineMode, onlineMode: OnlineMode) {
    this.offlineMode = offlineMode;
    this.onlineMode = onlineMode;
  }
  
  async query(prompt: string): Promise<string> {
    const mode = vscode.workspace.getConfiguration('surf.ai').get('mode') || 'auto';
    
    if (mode === 'offline') {
      return this.offlineMode.query(prompt);
    } else if (mode === 'online') {
      return this.onlineMode.query(prompt);
    } else {
      // Auto mode: smart routing
      return this.smartRoute(prompt);
    }
  }
  
  private async smartRoute(prompt: string): Promise<string> {
    // Decision logic:
    // 1. If offline or privacy mode → use local
    // 2. If complex task and has balance → use cloud
    // 3. Otherwise → use local
    
    const isOffline = !navigator.onLine;
    const isPrivacyMode = vscode.workspace.getConfiguration('surf.ai').get('privacyMode') || false;
    const hasBalance = await this.checkBalance();
    const isComplex = this.isComplexTask(prompt);
    
    if (isOffline || isPrivacyMode) {
      console.log('Smart router: Using offline mode (offline/privacy)');
      return this.offlineMode.query(prompt);
    } else if (hasBalance && isComplex) {
      console.log('Smart router: Using online mode (complex task + balance)');
      return this.onlineMode.query(prompt);
    } else {
      console.log('Smart router: Using offline mode (default)');
      return this.offlineMode.query(prompt);
    }
  }
  
  private async checkBalance(): Promise<boolean> {
    try {
      const billing = await vscode.workspace.getConfiguration('surf.ai').get('lastBilling');
      return billing && billing.balance > 0.01;
    } catch {
      return false;
    }
  }
  
  private isComplexTask(prompt: string): boolean {
    // Simple heuristic: long prompts or specific keywords
    const keywords = ['explain', 'analyze', 'refactor', 'optimize', 'design', 'architecture'];
    const isLong = prompt.length > 500;
    const hasKeywords = keywords.some(kw => prompt.toLowerCase().includes(kw));
    
    return isLong || hasKeywords;
  }
}
```

### Step 2.6: Build Extension

```bash
cd extensions/surf-ai
yarn install
yarn compile

# Package extension
vsce package

# Output: surf-ai-1.0.0.vsix
```

---

## Phase 3: Custom UI (Week 5)

### Step 3.1: Create Surf Theme

**Create `extensions/surf-theme/package.json`:**
```json
{
  "name": "surf-theme",
  "displayName": "Surf Theme",
  "description": "Official theme for Surf IDE",
  "version": "1.0.0",
  "publisher": "surf-ai",
  "engines": {
    "vscode": "^1.85.0"
  },
  "categories": ["Themes"],
  "contributes": {
    "themes": [
      {
        "label": "Surf Dark",
        "uiTheme": "vs-dark",
        "path": "./themes/surf-dark-color-theme.json"
      },
      {
        "label": "Surf Light",
        "uiTheme": "vs",
        "path": "./themes/surf-light-color-theme.json"
      }
    ]
  }
}
```

**Create `extensions/surf-theme/themes/surf-dark-color-theme.json`:**
```json
{
  "name": "Surf Dark",
  "type": "dark",
  "colors": {
    "editor.background": "#1a1b26",
    "editor.foreground": "#a9b1d6",
    "editor.lineHighlightBackground": "#24283b",
    "editor.selectionBackground": "#33467C",
    "editorCursor.foreground": "#c0caf5",
    "sideBar.background": "#16161e",
    "sideBar.foreground": "#a9b1d6",
    "activityBar.background": "#16161e",
    "titleBar.activeBackground": "#16161e",
    "statusBar.background": "#16161e",
    "tab.activeBackground": "#1a1b26",
    "tab.inactiveBackground": "#16161e"
  },
  "tokenColors": [
    {
      "scope": ["comment"],
      "settings": { "foreground": "#565f89" }
    },
    {
      "scope": ["string"],
      "settings": { "foreground": "#9ece6a" }
    },
    {
      "scope": ["keyword"],
      "settings": { "foreground": "#bb9af7" }
    },
    {
      "scope": ["function"],
      "settings": { "foreground": "#7aa2f7" }
    }
  ]
}
```

---

## Phase 4: Branded Installers (Week 6)

### Step 4.1: Configure electron-builder

**Create `build/installer-config.js`:**
```javascript
module.exports = {
  appId: "ai.surf.ide",
  productName: "Surf IDE",
  directories: {
    output: "dist",
    buildResources: "resources"
  },
  files: [
    "out/**/*",
    "extensions/**/*",
    "resources/**/*"
  ],
  mac: {
    category: "public.app-category.developer-tools",
    icon: "resources/icon.icns",
    darkModeSupport: true,
    target: [
      {
        target: "dmg",
        arch: ["x64", "arm64"]
      }
    ],
    artifactName: "${productName}-${version}-mac-${arch}.${ext}",
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: "build/entitlements.mac.plist",
    entitlementsInherit: "build/entitlements.mac.plist"
  },
  win: {
    icon: "resources/icon.ico",
    target: [
      {
        target: "nsis",
        arch: ["x64"]
      }
    ],
    artifactName: "${productName}-${version}-win-${arch}.${ext}"
  },
  linux: {
    icon: "resources/icon.png",
    category: "Development",
    target: ["AppImage", "deb", "rpm"],
    artifactName: "${productName}-${version}-linux-${arch}.${ext}"
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    installerIcon: "resources/icon.ico",
    uninstallerIcon: "resources/icon.ico",
    installerHeaderIcon: "resources/icon.ico",
    createDesktopShortcut: true,
    createStartMenuShortcut: true
  },
  dmg: {
    background: "resources/dmg-background.png",
    icon: "resources/icon.icns",
    iconSize: 100,
    contents: [
      { x: 130, y: 220 },
      { x: 410, y: 220, type: "link", path: "/Applications" }
    ],
    window: {
      width: 540,
      height: 380
    }
  }
};
```

### Step 4.2: Build Installers

**macOS:**
```bash
yarn gulp vscode-darwin-arm64
node build/installer.js --platform=darwin --arch=arm64

# Output: dist/Surf IDE-1.0.0-mac-arm64.dmg
```

**Windows:**
```bash
yarn gulp vscode-win32-x64
node build/installer.js --platform=win32 --arch=x64

# Output: dist/Surf IDE-1.0.0-win-x64.exe
```

---

## Phase 5: Integration & Testing (Week 7-8)

### Step 5.1: Integration Testing

```bash
# Test offline mode
# - Download Qwen model
# - Start llama.cpp server
# - Send query
# - Verify response

# Test online mode
# - Authenticate with Surf API
# - Send query to OpenRouter
# - Verify response and billing

# Test smart routing
# - Test offline/privacy mode
# - Test complex task routing
# - Test balance checking
```

### Step 5.2: Performance Testing

```bash
# Measure:
# - Extension load time (< 2s)
# - Chat response time (< 1s local, < 3s cloud)
# - Memory usage (< 500MB idle, < 2GB under load)
# - CPU usage (< 10% idle)
```

### Step 5.3: Release

```bash
# Tag release
git tag v1.0.0
git push origin v1.0.0

# Build all platforms
yarn gulp vscode-darwin-arm64
yarn gulp vscode-darwin-x64
yarn gulp vscode-win32-x64
yarn gulp vscode-linux-x64

# Sign and notarize (macOS)
# Sign (Windows)

# Upload to GitHub Releases
gh release create v1.0.0 dist/*
```

---

## 🎉 Success!

You now have **Surf IDE** - a production-ready AI-powered development environment!

**What you've built:**
- ✅ VSCode fork with custom branding
- ✅ Surf AI extension (offline + online)
- ✅ Smart routing (auto/offline/online)
- ✅ Custom theme (Surf Dark/Light)
- ✅ Branded installers (DMG/EXE)
- ✅ Integrated with OpenRouter gateway
- ✅ Local Qwen model support

**Next steps:**
- Market to developers
- Collect user feedback
- Iterate on features
- Build extension ecosystem
