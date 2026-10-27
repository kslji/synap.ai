# Surf IDE — Setup Guide

This is the manual walkthrough behind `./setup.sh`. Run the script unless you are
debugging a step or working on a platform where it does not fit; the script and
this guide describe the *same* five steps, so they stay in sync.

- Overview ................................ step 0
- Prerequisites ......................... step 0
- Step 1 — the VS Code checkout ........... pinned commit, non-destructive merge
- Step 2 — dependencies ................. fork + Surf AI extension
- Step 3 — the Surf fork changes ........... `fork-setup.mjs`, explained key by key
- Step 4 — build and test the extension ... the real built-in, not a scaffold
- Step 5 — compile the workbench .......... `compile-client`, why not `compile`
- Launch ................................ dev launch + desktop handoff
- Native addons (macOS / arm64) ......... the `bindings file` fix
- Production installers ................ gulp targets
- Troubleshooting
- What this guide deliberately does **not** cover

## Overview

Surf IDE is a VS Code fork with the Surf assistant shipped as a **built-in
extension**. The fork itself (`surf-ide/code-oss/`) is upstream material that this
repository **git-ignores**; the only tracked part inside it is
`code-oss/extensions/surf-ai/`. That split is the whole reason this setup exists:
every change Surf needs in `product.json` and the workbench sources is unversioned,
so it must be re-applied on a fresh checkout. `fork-setup.mjs` is the single source
of truth for those changes.

There are **two chat modes and no automatic routing**: **Offline Mode (Air-Gapped)**
(local model over the on-device bridge) and **Online Cloud** (the OpenRouter gateway).
The old `auto` / "Smart routing" mode described in earlier drafts does not exist and
must not be reintroduced — the internal `SurfMode 'auto'` is retained in the model
router only as a fallback sentinel, never as a selectable UI mode.

## Prerequisites

- **macOS 12+**, **Windows 10/11**, or a recent **Linux**.
- **Node.js 22+** (`node --version`) — the fork's own `.nvmrc` may pin higher.
- **Python 3.12+** (`python3 --version`).
- **Git** and **rsync** — `rsync` is how upstream is merged into a checkout that
  already holds the tracked extension folder.
- **Xcode Command Line Tools** (macOS): `xcode-select --install`.
- **Visual Studio Build Tools** (Windows): the C++ workload.

## Step 1 — the VS Code checkout

Surf is verified against one specific upstream commit. `fork-setup.mjs` patches
workbench sources **by exact text**, so a floating `main` would break a fresh
setup on an unrelated upstream day. The pin lives in `setup.sh`:

```bash
SURF_VSCODE_COMMIT=22440e0276be6fa9554868660a41dff33785d5e6
```

`code-oss/` exists the moment the repository is cloned, because
`extensions/surf-ai/` is tracked inside it — so a script that tests for the
*directory* would always skip the clone. The checkout is detected by testing for
the workbench source instead:

```bash
test -f code-oss/src/vs/workbench/workbench.common.main.ts
```

If it is missing, the exact commit is fetched shallowly into a temp dir and merged
over the top of our folder, leaving the tracked extension untouched:

```bash
STAGE=$(mktemp -d)
git init -q "$STAGE/vscode"
git -C "$STAGE/vscode" remote add origin https://github.com/microsoft/vscode.git
git -C "$STAGE/vscode" fetch --depth 1 origin "$SURF_VSCODE_COMMIT"
git -C "$STAGE/vscode" checkout -q FETCH_HEAD
rsync -a --exclude='/extensions/surf-ai/' "$STAGE/vscode/" code-oss/
```

The `--exclude` is what makes this non-destructive: upstream never overwrites
`extensions/surf-ai/`. If you already have a checkout at another commit, the
script does **not** reset it (that would discard local work) — it warns, and
`fork-setup.mjs` will fail loudly if a patch no longer applies, at which point you
re-derive that one fragment for your commit.

## Step 2 — dependencies

```bash
cd code-oss
npm install                              # the fork
npm --prefix extensions/surf-ai install  # the Surf AI extension
```

## Step 3 — the Surf fork changes

Everything here is done by one idempotent script. Re-run it any time; it reports
"already applied" when there is nothing to change:

```bash
node surf-ide/fork-setup.mjs
```

It writes four files. What each change is, and *why* it is needed:

### 3.1 `product.json` — branding + gallery

Surf identity (`nameShort`/`nameLong` `Surf IDE`, `applicationName` `surf-ide`,
`dataFolderName` `.surf-ide`, `darwinBundleIdentifier` `ai.surf.ide`, the
`win32*`/`linux*` variants, `urlProtocol`, `sharedDataFolderName`) and the
**Open VSX** gallery (not the Microsoft marketplace, which a fork may not use):

```
extensionsGallery.serviceUrl = https://open-vsx.org/vscode/gallery
```

### 3.2 `product.json` — the Surf `defaultChatAgent`

`product.defaultChatAgent` is dereferenced at **module scope** by the chat and
onboarding contributions. If the key is absent, those imports throw during
startup and the Electron window — created with `show:false` — is never shown. The
script replaces the key outright rather than merging over it: upstream's copy
points at the Copilot extensions and carries Copilot command ids whose callers use
`?? fallback`, so an inherited value would beat the fallback. The replacement
describes Surf's own assistant (`extensionId: 'surf-ai.surf-ai'`, the Surf provider
and `synap.surf` URLs).

### 3.3 `product.json` — Copilot / Microsoft strip-out

So that no shipped path points at a Microsoft or GitHub endpoint from a product
that advertises no egress. `trustedExtensionAuthAccess` → `{}`,
`builtInExtensionsEnabledWithAutoUpdates` → `[]`, `reportIssueUrl` → `""`, and
`voiceWsUrl` (a Microsoft realtime voice endpoint) is removed. Legal
license/notice URLs are left untouched.

### 3.4 Workbench source guards

Two files get small, principled guards, all keyed off the same fact — Surf ships
one built-in extension that is *both* the completions and the chat extension:

- `extensionEnablementService.ts` — upstream's "extension unification" retires the
  completions extension and disables the chat extension on profiles that haven't
  finished chat setup (`EnablementState = DisabledByUnification`). Both rules key
  off `defaultChatAgent`. Because Surf's single extension fills both roles,
  unguarded it would disable Surf's own built-in. The guards no-op unification when
  the completions and chat ids are the same.
- `chatSetupContributions.ts` + `chat.shared.contribution.ts` — `chat.disableAIFeatures`
  is defaulted to **on**, so VS Code's own Chat view never appears beside Surf AI in
  the right bar. The two `chatSetupContributions.ts` guards keep that default from
  being stomped: the setup listener won't write it back off unless the user set it
  explicitly, and the AI-features toggle won't enable/disable the built-in it now
  points at (Surf's own assistant). The default is registered rather than written at
  runtime because flipping `chat.disableAIFeatures` mid-session makes the workbench
  re-register its views and takes the Surf AI view with it.

### 3.5 Built-in Git and GitHub are untouched

The source-control stack — `vscode.git`, `vscode.github` and
`vscode.github-authentication` — ships in the fork's `extensions/` folder and is
compiled by `npm run compile-client` like every other core built-in. Nothing in
`setup.sh` or `fork-setup.mjs` disables or excludes it:

- `fork-setup.mjs` clears `trustedExtensionAuthAccess` and
  `builtInExtensionsEnabledWithAutoUpdates`, but upstream populated those keys only
  for `GitHub.copilot-chat`. Emptying them revokes Copilot's silent GitHub sign-in
  delegation and stops the auto-update list reinstalling retired extensions; it does
  not remove the `vscode.*` built-ins, which provide and consume auth through their
  own mechanism.
- The only extension the launch command disables is the external
  `GitHub.copilot-chat` marketplace id, not `vscode.github`.

So `git` blame/diff, the built-in GitHub PR provider, and GitHub sign-in keep
working in a Surf IDE window.

## Step 4 — build and test the extension

This builds the **real** Surf AI extension. It is a genuine VS Code built-in, not a
scaffold you create — the files already live in the repo:

```
extensions/surf-ai/src/
├── extension.ts            # activation, view registration, default settings
├── chat-sidebar.ts         # the right-docked webview (Offline / Online Cloud)
├── model-router.ts         # resolves mode + model; 'auto' is an internal sentinel only
├── gateway-client.ts       # Online Cloud: OpenRouter-backed gateway
├── local-model-client.ts   # Offline: the on-device model bridge
├── context-extractor.ts    # editor/workspace context for a turn
├── edit-core.ts / .test.ts # edit parsing + application logic
├── edit-proposal.ts        # proposal lifecycle
└── diff-review.ts          # side-by-side vscode.diff before/after review
```

```bash
npm --prefix extensions/surf-ai run compile
npm --prefix extensions/surf-ai test
```

The extension reads two settings — `surf.gatewayBaseUrl` and `surf.localBridgeFile`
— and contributes the commands `surf-ai.openChat`, `askQuestion`,
`explainSelection`, `fixErrors`, `backToLobby`, `acceptProposal`, `rejectProposal`,
plus the `surf-ai.chat` webview. Authentication is **launch-time token injection**
(`SURF_GATEWAY_TOKEN`), not a login form in the panel.

## Step 5 — compile the workbench

```bash
cd code-oss
npm run compile-client
```

`compile-client` only. The fork's full `compile` script also builds
`extensions/copilot`, which Surf does not ship — Surf AI replaces it. For iteration
after a source edit, `npm run transpile-client` (~10 s) is enough.

## Launch

```bash
cd code-oss
VSCODE_SKIP_PRELAUNCH=1 ./scripts/code.sh /path/to/project \
  --disable-extension=GitHub.copilot-chat \
  --skip-welcome --skip-release-notes --disable-workspace-trust
```

- `VSCODE_SKIP_PRELAUNCH=1` skips the pre-launch compile step for the dev path.
- `--disable-extension=GitHub.copilot-chat` targets the id the Copilot container in
  the fork actually declares.
- `--disable-workspace-trust` prevents the extension host stalling on a large folder.

The normal path is the **desktop app's Code surface**: it spawns `code.sh` with the
same arguments and injects `SURF_GATEWAY_BASE_URL` / `SURF_GATEWAY_TOKEN` (and
`SURF_LOCAL_BRIDGE_FILE` for Offline).

## Native addons (macOS / arm64)

`npm ci` does not build the fork's native modules on this machine: `.npmrc` pins
`build_from_source=true` and the default make generator emits
`-mmacosx-version-min=10.7`, too old for `@vscode/policy-watcher`'s `std::variant`.
Startup then dies with `Could not locate the bindings file`. Rebuild the addons
against Electron with a modern target:

```bash
cd code-oss
nvm use                      # honour .nvmrc
NG=node_modules/node-gyp/bin/node-gyp.js   # or the npm-bundled node-gyp
export MACOSX_DEPLOYMENT_TARGET=11.0
export CXXFLAGS="-mmacosx-version-min=11.0 -std=c++20"
export CFLAGS="-mmacosx-version-min=11.0"
for m in policy-watcher spdlog native-watchdog fs-copyfile deviceid sqlite3; do
  (cd node_modules/@vscode/$m && node "$NG" rebuild \
    --runtime=electron --target="$(node -p "require('./package.json').devDependencies.electron.replace(/^\^/,'')")" \
    --arch=arm64 --dist-url=https://electronjs.org/headers --build-from-source)
done
(cd node_modules/native-keymap && node "$NG" rebuild \
  --runtime=electron --target="$(node -p "require('./package.json').devDependencies.electron.replace(/^\^/,'')")" \
  --arch=arm64 --dist-url=https://electronjs.org/headers --build-from-source)
```

Always launch through `./scripts/code.sh` — it exports `VSCODE_DEV=1`, which enables
the dev CSS import-map loader. Running the Electron binary directly makes every
`*.css` import fail and the workbench never loads.

## Production installers

```bash
cd code-oss
npm run gulp vscode-darwin-arm64   # macOS Apple Silicon
npm run gulp vscode-darwin-x64     # macOS Intel
npm run gulp vscode-win32-x64      # Windows
```

Output lands in `VSCode-darwin-arm64/`, `VSCode-darwin-x64/`, `VSCode-win32-x64/`
as upstream names them; branding comes from the `product.json` written in Step 3.

## Troubleshooting

**`fork-setup.mjs` says a fragment no longer applies.** Upstream moved off the
pinned commit. Re-derive that one edit against your checkout — the script fails
loudly on purpose rather than half-patching.

**The Surf AI panel is missing, or VS Code's own "Chat" tab shows up beside it.**
`chat.disableAIFeatures` is the mechanism that hides the native Chat view. Confirm
the guard edits landed (`node fork-setup.mjs` prints the changed files) and that you
re-transpiled after editing the sources.

**Surf AI never activates.** Check the folder is trusted (`--disable-workspace-trust`
for dev), and look in the window's `views.log` / `exthost.log` under the profile's
`logs/` dir — `ExtensionService#_doActivateExtension surf-ai.surf-ai` should appear
as a genuine built-in on `onStartupFinished`.

**`Could not locate the bindings file` on startup.** Native addons weren't built —
see [Native addons](#native-addons-macos--arm64).

**A model call fails with `Unknown model` / `model_locked`.** That's the gateway,
not the fork: the model is off the allowlist, or your credit tier doesn't unlock it.
See [ADR 0008](../docs/adr/0008-credit-tiers-and-unlocks.md) and the
[gateway README](../services/api/app/gateway/README.md).

## What this guide deliberately does **not** cover

No manual `product.json` editing (Step 3 automates it), no hand-written extension
scaffold (the extension is real and tracked), and no in-panel email/password login
(auth is launch-time token injection). Any older text describing a "Create Surf AI
extension scaffold" step, an `auto`/`Smart routing` mode, `router.ts`, a Microsoft
marketplace gallery, or a MySQL auth form in the panel is **superseded** by this
guide.
