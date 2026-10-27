# 🏄 Surf IDE — Quick Start

## What is Surf IDE?

Surf IDE is a **VS Code fork** that ships the Surf assistant as a **built-in
extension** (`extensions/surf-ai/`), docked in the right secondary sidebar next
to a real editor, file tree, terminal and diff review.

It has exactly **two chat modes** — there is no automatic/"smart" routing and no
`auto` mode:

- **Offline Mode (Air-Gapped)** — the local model, reached over the on-device
  bridge (`surf.localBridgeFile`). Zero network egress.
- **Online Cloud** — the OpenRouter-backed gateway (`surf.gatewayBaseUrl`),
  authenticated with the launch-injected token. Model access is credit-tiered
  (see [ADR 0008](../docs/adr/0008-credit-tiers-and-unlocks.md)).

You pick the mode; the product never picks it for you.

## Current status

- ✅ **Fork builds and launches** — `./scripts/code.sh` opens a Surf IDE window.
- ✅ **Surf AI built-in** — right-docked chat panel, dual-mode picker, and
  side-by-side (`vscode.diff`) before/after review with Accept / Reject.
- ✅ **Reproducible setup** — `setup.sh` prepares the checkout and
  `fork-setup.mjs` re-applies every unversioned Surf change in one idempotent pass.

## One command

```bash
cd surf-ide
./setup.sh
```

`setup.sh` does five things, in order:

1. **Ensure the VS Code checkout** at the pinned commit
   (`22440e0276be6fa9554868660a41dff33785d5e6`), merging upstream over the top of
   the tracked `extensions/surf-ai/` without ever writing into it.
2. **Install dependencies** — the fork, then the Surf AI extension.
3. **Apply the Surf fork changes** via `node fork-setup.mjs` — branding, the Open
   VSX gallery, the Surf `defaultChatAgent`, the Copilot strip-out, and the
   extension-enablement / chat guards. Idempotent; fails loudly if upstream moved.
4. **Build and test the Surf AI extension** — `npm run compile` then `npm test`.
5. **Compile the workbench** — `npm run compile-client` (deliberately *not* the
   full `compile`, which would also build the Copilot extension Surf replaces).

## Launch

```bash
cd code-oss
VSCODE_SKIP_PRELAUNCH=1 ./scripts/code.sh /path/to/project \
  --disable-extension=GitHub.copilot-chat \
  --skip-welcome --skip-release-notes --disable-workspace-trust
```

`--disable-workspace-trust` matters: without it the extension host can stall on a
large folder and Surf AI never activates. The desktop app's **Code** surface
passes the same arguments and injects `SURF_GATEWAY_BASE_URL` / `SURF_GATEWAY_TOKEN`,
so launching from the desktop app is the normal path — you rarely run `code.sh`
by hand.

## After you change something

- Edited a **fork source** (`src/vs/…`)? Re-transpile instead of a full compile:
  `cd code-oss && npm run transpile-client` (~10 s).
- Edited the **extension**? `npm --prefix extensions/surf-ai run compile`
  (then `npm --prefix extensions/surf-ai test`).
- Changed **branding / product.json / the chat guards**? They live in
  `fork-setup.mjs`, not in the fork — re-run `node fork-setup.mjs`.

## Production installers

```bash
cd code-oss
npm run gulp vscode-darwin-arm64   # macOS Apple Silicon
npm run gulp vscode-darwin-x64     # macOS Intel
npm run gulp vscode-win32-x64      # Windows
```

## macOS / arm64 runtime note

The fork compiles, but its native modules are not built by `npm ci` on this
machine (`.npmrc` pins `build_from_source=true`, and the default make generator
sets a `-mmacosx-version-min` too old for `@vscode/policy-watcher`). If startup
fails with `Could not locate the bindings file`, rebuild the native addons
against Electron with a modern deployment target — see the block in
[SETUP_GUIDE.md](SETUP_GUIDE.md#native-addons-macos--arm64).

The bundled `@github/copilot-sdk` may log `failed to load runtime … dlopen` on
the agent-host subprocess; that is unrelated to Surf AI and does not block the IDE.

## Layout of this folder

```
surf-ide/
├── setup.sh            # 5-step reproducible setup (above)
├── fork-setup.mjs      # every unversioned Surf change to the fork, in one script
├── QUICKSTART.md       # this file
├── SETUP_GUIDE.md      # detailed walkthrough + troubleshooting
└── code-oss/           # the VS Code checkout (git-ignored) ...
    └── extensions/surf-ai/   # ...except this, which is the real built-in extension
```

## Key references

- `fork-setup.mjs` header comment — *why* each fork change is needed.
- [docs/adr/0006-surf-ide-vscode-fork.md](../docs/adr/0006-surf-ide-vscode-fork.md) — the fork decision.
- [docs/adr/0008-credit-tiers-and-unlocks.md](../docs/adr/0008-credit-tiers-and-unlocks.md) — credit tiers and model unlocks.
- [services/api/app/gateway/README.md](../services/api/app/gateway/README.md) — the Online Cloud gateway.

---

**Ready?** Run `./setup.sh` 🚀
