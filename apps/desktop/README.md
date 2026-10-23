# Surf AI desktop

Electron 44 + electron-vite + React 19. The main process is the verified skeleton (encrypted SQLite, llama.cpp sidecar, embeddings, calculator, retrieval, token budget) with a Surf AI window on top.

## Mac

From the repo root (Node 22):

```bash
npm ci
cd apps/desktop
node scripts/fetch-sidecars.mjs
node scripts/fetch-tessdata.mjs
# if the Electron binary did not download:
node node_modules/electron/install.js
npm run dev
```

Self-test (needs the small models on disk):

```bash
mkdir -p ~/surf-models
# embeddinggemma-2-Q8_0.gguf and Qwen3.5-2B-Q4_K_M.gguf — see docs/IMPLEMENTATION.md
cd apps/desktop
SURF_MODELS_DIR=~/surf-models npm run selftest
```

On a Mac without a display the self-test is just `npm run selftest`. Linux CI and this repo's Linux notes use `xvfb-run -a`.

`SURF_SELFTEST=1` writes `~/Library/Application Support/surf-ai/selftest.json` on macOS (`~/.config/surf-ai/` on Linux, `%APPDATA%\surf-ai\` on Windows).

Older notes used `HARBOR_*`. Those names still work as a fallback.

## What the window does

- Onboarding reads RAM, offers the registry model that fits, and downloads it with resume and SHA-256.
- Chat streams from `llama-server`. Plain arithmetic and unit conversions go to the calculator worker.
- Drop a PDF, Word file, spreadsheet, slide deck, or image into the chat, or add it under Documents. Surf reads it in the background and can cite the page, slide, or sheet. Details are in `docs/STEP-2.md`.
- Retrieval and the relevance gate also run when a verified pack is installed. Pack install is later, so a chat with no documents uses the local model directly.
- Offline only blocks network calls (downloads, update checks, and the future web search).

## Scripts

| Command | What |
|---|---|
| `npm run dev` | Surf AI window |
| `npm run typecheck` | strict main, preload, renderer |
| `npm run build` | typecheck + electron-vite |
| `npm run selftest` | build, then the in-Electron checks |
| `npm run dist:mac` | `.dmg` + zip, arm64 and x64 (run on a Mac) |
| `npm run dist:win` | NSIS `.exe` (run on Windows) |

Sidecars land in `resources/bin/<platform>-<arch>/` and are gitignored. For a universal Mac build, fetch both arches first:

```bash
node scripts/fetch-sidecars.mjs --platform=darwin --arch=arm64
node scripts/fetch-sidecars.mjs --platform=darwin --arch=x64
```
