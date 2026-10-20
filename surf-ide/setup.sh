#!/bin/bash
# Surf IDE Setup Script
# This script automates the VSCode fork setup process

set -e  # Exit on error

echo "🏄 Surf IDE Setup"
echo "================"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check prerequisites
echo "📋 Checking prerequisites..."

# Check Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js not found. Please install Node.js 22+${NC}"
    exit 1
fi
NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 22 ]; then
    echo -e "${RED}❌ Node.js version must be 22+. Current: $(node --version)${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Node.js $(node --version)${NC}"

# Check Python
if ! command -v python3 &> /dev/null; then
    echo -e "${RED}❌ Python3 not found. Please install Python 3.12+${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Python3 $(python3 --version)${NC}"

# Check Git
if ! command -v git &> /dev/null; then
    echo -e "${RED}❌ Git not found. Please install Git${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Git $(git --version)${NC}"

echo ""
echo "📦 Step 1: Clone VSCode repository"
echo "==================================="

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VSCODE_DIR="$SCRIPT_DIR/code-oss"

if [ -d "$VSCODE_DIR" ]; then
    echo -e "${YELLOW}⚠️  VSCode directory already exists. Skipping clone.${NC}"
    echo "   To re-clone, run: rm -rf $VSCODE_DIR"
else
    echo "Cloning VSCode (this may take several minutes)..."
    git clone --depth 1 https://github.com/microsoft/vscode.git "$VSCODE_DIR"
    echo -e "${GREEN}✅ VSCode cloned successfully${NC}"
fi

cd "$VSCODE_DIR"

echo ""
echo "📦 Step 2: Install dependencies"
echo "================================"

echo "Installing Node dependencies (this may take several minutes)..."
npm install
echo -e "${GREEN}✅ Dependencies installed${NC}"

echo ""
echo "🎨 Step 3: Apply Surf branding"
echo "==============================="

# Backup original product.json
if [ ! -f product.json.backup ]; then
    cp product.json product.json.backup
    echo -e "${GREEN}✅ Backed up original product.json${NC}"
fi

# Update product.json with Surf branding
echo "Updating product.json..."
cat > product.json << 'EOF'
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
  "extensionsGallery": {
    "serviceUrl": "https://marketplace.visualstudio.com/_apis/public/gallery",
    "itemUrl": "https://marketplace.visualstudio.com/items"
  }
}
EOF
echo -e "${GREEN}✅ Applied Surf branding${NC}"

echo ""
echo "🔌 Step 4: Create Surf AI extension scaffold"
echo "============================================="

EXTENSION_DIR="extensions/surf-ai"
mkdir -p "$EXTENSION_DIR/src"
mkdir -p "$EXTENSION_DIR/media"

# Create package.json for extension
cat > "$EXTENSION_DIR/package.json" << 'EOF'
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
      }
    ],
    "configuration": {
      "title": "Surf AI",
      "properties": {
        "surf-ai.apiBaseUrl": {
          "type": "string",
          "default": "http://localhost:8000",
          "description": "Surf API base URL"
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
  }
}
EOF

# Create tsconfig.json
cat > "$EXTENSION_DIR/tsconfig.json" << 'EOF'
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
EOF

# Create basic extension.ts
cat > "$EXTENSION_DIR/src/extension.ts" << 'EOF'
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

  vscode.window.showInformationMessage('Surf AI is ready!');
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
          button { padding: 8px 16px; cursor: pointer; }
        </style>
      </head>
      <body>
        <div class="chat-container">
          <div class="messages" id="messages">
            <p>🏄 Welcome to Surf AI! Ask me anything about your code.</p>
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
EOF

# Create placeholder icon
echo "Creating placeholder icon..."
cat > "$EXTENSION_DIR/media/icon.svg" << 'EOF'
<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
  <circle cx="12" cy="12" r="10" fill="#007ACC"/>
  <text x="12" y="16" font-size="12" fill="white" text-anchor="middle" font-family="Arial">🏄</text>
</svg>
EOF

echo -e "${GREEN}✅ Created Surf AI extension scaffold${NC}"

echo ""
echo "🔨 Step 5: Build VSCode"
echo "======================="

echo "Compiling VSCode (this may take 10-20 minutes)..."
npm run watch &
WATCH_PID=$!

# Wait a bit for initial compilation
sleep 30

echo -e "${GREEN}✅ VSCode compilation started (PID: $WATCH_PID)${NC}"

echo ""
echo "🎉 Setup Complete!"
echo "=================="
echo ""
echo "Next steps:"
echo ""
echo "1. In one terminal, VSCode is compiling (npm run watch)"
echo "   Wait for it to finish, then press Ctrl+C to stop"
echo ""
echo "2. In another terminal, run Surf IDE:"
echo "   cd $VSCODE_DIR"
echo "   ./scripts/code.sh"
echo ""
echo "3. The Surf AI extension should load automatically"
echo "   Look for the Surf AI icon in the activity bar"
echo ""
echo "4. To build production installers:"
echo "   npm run gulp vscode-darwin-arm64  # macOS Apple Silicon"
echo "   npm run gulp vscode-darwin-x64    # macOS Intel"
echo "   npm run gulp vscode-win32-x64     # Windows"
echo ""
echo -e "${YELLOW}⚠️  Note: The extension is a basic scaffold. Next steps:${NC}"
echo "   - Implement offline mode (llama.cpp integration)"
echo "   - Implement online mode (OpenRouter API)"
echo "   - Add smart routing logic"
echo "   - Connect to Surf backend (services/api/)"
echo ""
echo "📖 See SETUP_GUIDE.md for detailed instructions"
echo ""
