# 🏄 Surf IDE - Quick Start

## What is Surf IDE?

Surf IDE is a **VSCode fork** with integrated AI capabilities:
- Offline mode (Qwen local models)
- Online mode (OpenRouter gateway)
- Smart routing (automatic selection)
- Cache-augmented inference (60%+ cost reduction)

## Current Status

✅ **Planning complete** - ADR approved, architecture designed  
✅ **Fork builds and launches** - `./scripts/code.sh` opens a working Surf IDE window  
✅ **Surf AI extension** - chat sidebar + curated model picker + diff-apply edits, routed through the gateway

## Runtime Notes (macOS / arm64)

The fork compiles, but its native modules are not built by `npm ci` on this machine
(`.npmrc` pins `build_from_source=true`, and the default make generator sets
`-mmacosx-version-min=10.7`, too old for `@vscode/policy-watcher`'s use of
`std::variant`). If the IDE crashes on startup with
`Could not locate the bindings file`, rebuild the native addons against
Electron 43.7.7 with a modern deployment target:

```bash
cd code-oss
nvm use 24.18.0            # .nvmrc
NG=node_modules/.bin/../node-gyp/bin/node-gyp.js   # or the npm-bundled node-gyp
export MACOSX_DEPLOYMENT_TARGET=11.0
export CXXFLAGS="-mmacosx-version-min=11.0 -std=c++20"
export CFLAGS="-mmacosx-version-min=11.0"
for m in policy-watcher spdlog native-watchdog fs-copyfile deviceid sqlite3; do
  (cd node_modules/@vscode/$m && node "$NG" rebuild \
    --runtime=electron --target=43.7.7 --arch=arm64 \
    --dist-url=https://electronjs.org/headers --build-from-source)
done
(cd node_modules/native-keymap && node "$NG" rebuild \
  --runtime=electron --target=43.7.7 --arch=arm64 \
  --dist-url=https://electronjs.org/headers --build-from-source)
```

Launch through `./scripts/code.sh` (it exports `VSCODE_DEV=1`, which enables the
dev CSS import-map loader; running the Electron binary directly without it makes
every `*.css` import fail and the workbench never loads). The desktop app spawns
`code.sh` for you and injects `SURF_GATEWAY_TOKEN` / `SURF_GATEWAY_BASE_URL` so
the extension authenticates against the gateway.

The bundled `@github/copilot-sdk` may log `failed to load runtime ... dlopen` on
the agent-host subprocess; that is unrelated to the Surf AI extension and does
not block the IDE from running.

## Quick Start (Automated)

Run the setup script:

```bash
cd /Users/arjunsingh/Desktop/surf.ai/surf-ide
./setup.sh
```

This will:
1. Clone VSCode repository (~5-10 min)
2. Install dependencies (~3-5 min)
3. Apply Surf branding
4. Create Surf AI extension scaffold
5. Start compilation

**Total time:** ~20-30 minutes

## Quick Start (Manual)

If you prefer manual setup, follow [SETUP_GUIDE.md](SETUP_GUIDE.md).

## After Setup

### Run Surf IDE

```bash
cd code-oss
./scripts/code.sh  # macOS/Linux
```

### Build Production Installers

```bash
# macOS Apple Silicon
npm run gulp vscode-darwin-arm64

# macOS Intel
npm run gulp vscode-darwin-x64

# Windows
npm run gulp vscode-win32-x64
```

## Next Implementation Steps

After the basic fork is working:

### Phase 1: Backend Integration (Week 2)
- [ ] Connect to Surf API (`services/api/`)
- [ ] Implement authentication (MySQL backend)
- [ ] Add OpenRouter gateway integration
- [ ] Test online mode

### Phase 2: Offline Mode (Week 2-3)
- [ ] Integrate llama.cpp sidecar
- [ ] Download Qwen models
- [ ] Implement local inference
- [ ] Test offline mode

### Phase 3: Smart Routing (Week 3)
- [ ] Implement routing logic (cache → cloud → local)
- [ ] Add Local Context Cache
- [ ] Test cost reduction
- [ ] Measure performance

### Phase 4: Polish & Release (Week 4)
- [ ] Custom theme (Surf Dark/Light)
- [ ] Branded installers (DMG/EXE)
- [ ] Performance optimization
- [ ] Documentation

## Architecture

```
┌─────────────────────────────────────────┐
│         Surf IDE (VSCode Fork)          │
├─────────────────────────────────────────┤
│  Surf AI Extension                      │
│  ├─ Chat Sidebar                        │
│  ├─ Inline Completions                  │
│  ├─ Smart Router                        │
│  │   ├─ Cache (SQLite + sqlite-vec)    │
│  │   ├─ Cloud (OpenRouter)              │
│  │   └─ Local (llama.cpp + Qwen)        │
│  └─ Billing & Usage Tracking            │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│      Surf Backend (services/api/)       │
│  ├─ OpenRouter Gateway                  │
│  ├─ MySQL Auth                          │
│  ├─ Billing (Stripe/Razorpay)           │
│  └─ User Management                     │
└─────────────────────────────────────────┘
```

## Key Files

- `setup.sh` - Automated setup script
- `SETUP_GUIDE.md` - Detailed manual setup guide
- `README.md` - Project overview
- `docs/adr/0006-surf-ide-vscode-fork.md` - Architecture decision

## Resources

- [VSCode Fork Guide](https://github.com/microsoft/vscode/wiki/Forking)
- [VSCode Extension API](https://code.visualstudio.com/api)
- [Surf API Docs](../services/api/README.md)

## Support

Issues: https://github.com/kslji/surf.ai/issues

---

**Ready to start?** Run `./setup.sh` 🚀
