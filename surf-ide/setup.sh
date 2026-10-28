#!/bin/bash
# Surf IDE Setup Script
#
# Prepares surf-ide/code-oss: the VS Code checkout that the Surf shell runs on,
# plus the Surf changes that this repository cannot carry because the fork is
# git-ignored (only code-oss/extensions/surf-ai/ is tracked).
#
# This script must never write into the fork's extensions/surf-ai directory:
# that is the real Surf assistant, not a scaffold.

set -e  # Exit on error

echo "🏄 Surf IDE Setup"
echo "================"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VSCODE_DIR="$SCRIPT_DIR/code-oss"

# The commit the Surf shell is verified against. fork-setup.mjs patches
# extensionEnablementService.ts by exact text, so tracking a floating `main`
# would break a fresh setup on an unrelated upstream day.
SURF_VSCODE_COMMIT=22440e0276be6fa9554868660a41dff33785d5e6

# Check prerequisites
echo "📋 Checking prerequisites..."

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

if ! command -v python3 &> /dev/null; then
    echo -e "${RED}❌ Python3 not found. Please install Python 3.12+${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Python3 $(python3 --version)${NC}"

if ! command -v git &> /dev/null; then
    echo -e "${RED}❌ Git not found. Please install Git${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Git $(git --version)${NC}"

if ! command -v rsync &> /dev/null; then
    echo -e "${RED}❌ rsync not found — it is how the upstream source is merged${NC}"
    echo "   into a checkout that already holds our tracked extension folder."
    exit 1
fi
echo -e "${GREEN}✅ rsync available${NC}"

echo ""
echo "📦 Step 1: Ensure the VS Code checkout"
echo "======================================"

# code-oss exists as soon as the repository is cloned, because extensions/surf-ai
# is tracked inside it. Testing for the directory would therefore always skip the
# clone; test for the workbench source instead.
if [ -f "$VSCODE_DIR/src/vs/workbench/workbench.common.main.ts" ]; then
    CURRENT=$(git -C "$VSCODE_DIR" rev-parse HEAD 2>/dev/null || echo "unknown")
    if [ "$CURRENT" = "$SURF_VSCODE_COMMIT" ]; then
        echo -e "${GREEN}✅ Checkout is at $CURRENT${NC}"
    elif [ "$CURRENT" = "unknown" ]; then
        echo -e "${YELLOW}⚠️  $VSCODE_DIR has workbench sources but is not a git checkout.${NC}"
        echo "   Continuing; fork-setup.mjs will fail loudly if the patches do not apply."
    else
        echo -e "${YELLOW}⚠️  Checkout is at $CURRENT, Surf is verified against $SURF_VSCODE_COMMIT.${NC}"
        echo "   Not resetting — that would discard local work. If fork-setup.mjs reports a"
        echo "   patch that no longer applies, re-derive it for this commit."
    fi
else
    echo "Fetching VS Code $SURF_VSCODE_COMMIT (this may take several minutes)..."
    mkdir -p "$VSCODE_DIR/extensions"
    STAGE=$(mktemp -d)
    trap 'rm -rf "$STAGE"' EXIT
    git init -q "$STAGE/vscode"
    git -C "$STAGE/vscode" remote add origin https://github.com/microsoft/vscode.git
    git -C "$STAGE/vscode" fetch --depth 1 origin "$SURF_VSCODE_COMMIT"
    git -C "$STAGE/vscode" checkout -q FETCH_HEAD
    # Copy the upstream source over the top of our extension folder rather than
    # beside it, and leave extensions/surf-ai exactly as the repository has it.
    rsync -a --exclude='/extensions/surf-ai/' "$STAGE/vscode/" "$VSCODE_DIR/"
    rm -rf "$STAGE"
    trap - EXIT
    echo -e "${GREEN}✅ VS Code checkout ready${NC}"
fi

cd "$VSCODE_DIR"

echo ""
echo "📦 Step 2: Install dependencies"
echo "================================"

echo "Installing fork dependencies (this may take several minutes)..."
npm install

echo "Installing Surf AI extension dependencies..."
npm --prefix extensions/surf-ai install
echo -e "${GREEN}✅ Dependencies installed${NC}"

echo ""
echo "🎨 Step 3: Apply the Surf fork changes"
echo "======================================"

# Branding, the Open VSX gallery, the Surf `defaultChatAgent`, the Copilot
# strip-out, and the extension enablement guards. Idempotent, and it fails loudly
# instead of half-patching when upstream has moved.
node "$SCRIPT_DIR/fork-setup.mjs"
echo -e "${GREEN}✅ Surf fork changes applied${NC}"

echo ""
echo "🔌 Step 4: Build and test the Surf AI extension"
echo "================================================"

npm --prefix extensions/surf-ai run compile
npm --prefix extensions/surf-ai test
echo -e "${GREEN}✅ Surf AI extension built and tested${NC}"

echo ""
echo "🔨 Step 5: Compile the workbench"
echo "==============================="

# compile-client only. The fork's `compile` script also builds extensions/copilot,
# which Surf does not ship — Surf AI replaces it.
echo "Compiling the workbench (this takes a few minutes)..."
npm run compile-client
echo -e "${GREEN}✅ Workbench compiled${NC}"

echo ""
echo "🧩 Step 6: Compile the built-in extensions"
echo "==================================="

# Git, GitHub sign-in/push/PRs and the language features live in the fork's
# built-in extensions. Without them the IDE opens but `git status` in the
# sidebar, GitHub authentication, and IntelliSense are dead. They compile via
# gulp, not `compile-client`, and npm postinstall already fetched their deps.
# Copilot is deliberately excluded: Surf AI replaces it.
BUILT_IN_REQUIRED=(git git-base github github-authentication typescript-language-features configuration-editing merge-conflict)
MISSING=0
for ext in "${BUILT_IN_REQUIRED[@]}"; do
    if [ ! -f "extensions/$ext/package.json" ] || [ ! -d "extensions/$ext/out" ]; then
        MISSING=1
        break
    fi
done
if [ "$MISSING" -eq 1 ]; then
    echo "Compiling built-in extensions (this takes a few minutes)..."
    # compile-extensions builds every extension that postinstall installed; if
    # its deps are missing too, re-run postinstall for the extensions tree.
    if [ ! -d "extensions/git/node_modules" ] && [ -f "extensions/git/package.json" ]; then
        echo "Installing extension dependencies..."
        pushd extensions > /dev/null && npm install --no-audit --no-fund > /dev/null && popd > /dev/null
    fi
    npm run gulp compile-extensions
    for ext in "${BUILT_IN_REQUIRED[@]}"; do
        if [ ! -d "extensions/$ext/out" ]; then
            echo -e "${YELLOW}⚠️  extensions/$ext did not compile; Git/GitHub/language features may be unavailable.${NC}"
        fi
    done
    echo -e "${GREEN}✅ Built-in extensions compiled${NC}"
else
    echo -e "${GREEN}✅ Built-in extensions already compiled${NC}"
fi

echo ""
echo "🎉 Setup Complete!"
echo "=================="
echo ""
echo "Next steps:"
echo ""
echo "1. Launch Surf IDE on a project:"
echo "   cd $VSCODE_DIR"
echo "   VSCODE_SKIP_PRELAUNCH=1 ./scripts/code.sh /path/to/project \\"
echo "     --disable-extension=GitHub.copilot-chat \\"
echo "     --skip-welcome --skip-release-notes --disable-workspace-trust"
echo ""
echo "   --disable-workspace-trust matters: without it the extension host can"
echo "   stall without activating anything when the folder is large. The desktop"
echo "   app passes the same arguments."
echo ""
echo "2. Or launch it from the desktop app: the Code surface's"
echo "   'Open Surf IDE' button starts this fork and hands it the signed-in"
echo "   gateway credentials through SURF_GATEWAY_BASE_URL / SURF_GATEWAY_TOKEN."
echo ""
echo "3. After changing fork sources, re-transpile instead of a full compile:"
echo "   npm run transpile-client   (~10s)"
echo "   After changing the extension, npm --prefix extensions/surf-ai run compile."
echo ""
echo "4. To build production installers:"
echo "   npm run gulp vscode-darwin-arm64  # macOS Apple Silicon"
echo "   npm run gulp vscode-darwin-x64    # macOS Intel"
echo "   npm run gulp vscode-win32-x64     # Windows"
echo ""
echo "📖 See QUICKSTART.md for the architecture, and fork-setup.mjs for why"
echo "   the Step 3 changes are needed."
