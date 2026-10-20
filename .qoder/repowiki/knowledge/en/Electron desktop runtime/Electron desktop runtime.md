---
kind: external_dependency
name: Electron desktop runtime
slug: electron
category: external_dependency
category_hints:
    - framework_behavior
scope:
    - '**'
source_files:
    - apps/desktop/package.json
    - apps/desktop/electron.vite.config.ts
    - apps/desktop/electron-builder.cjs
---

### Electron 44
- Role: cross-platform desktop shell for Synap.surf (macOS .dmg, Windows .exe, Linux AppImage).
- Integration: `apps/desktop` is an electron-vite project; main process lives under `src/main`, renderer under `src/renderer`, secure bridge in `src/preload`.
- Build/pack via `electron-builder` (`dist:mac`, `dist:win`, `dist:linux` scripts); updater wired through `electron-updater`.
- Stable shape: Node.js backend runs inside the app's own process and talks to the optional cloud API over HTTP; models are sidecar binaries fetched at first launch, never bundled.