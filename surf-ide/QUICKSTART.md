# 🏄 Surf IDE - Quick Start

## What is Surf IDE?

Surf IDE is a **VSCode fork** with integrated AI capabilities:
- Offline mode (Qwen local models)
- Online mode (OpenRouter gateway)
- Smart routing (automatic selection)
- Cache-augmented inference (60%+ cost reduction)

## Current Status

✅ **Planning complete** - ADR approved, architecture designed  
⏳ **Implementation not started** - Ready to begin

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
