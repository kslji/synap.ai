# Surf AI

A local-first desktop assistant. The model runs on your computer. Chats stay there. When you are online, the app can catch up.

**Works offline. Stays up to date when you're online.**

## Quick start

Node.js 22.

```bash
npm ci
cd apps/desktop
node scripts/fetch-sidecars.mjs
node node_modules/electron/install.js   # only if the Electron binary is missing
npm run dev
```

The website:

```bash
npm run dev:web
```

Self-test (models not included in git):

```bash
cd apps/desktop
SURF_MODELS_DIR=~/surf-models npm run selftest
```

Mac notes, including the self-test path, are in `apps/desktop/README.md`. What this step finished, and what is stubbed, is in `docs/STEP-1.md`.

## Layout

| Path | What |
|---|---|
| `apps/desktop` | Electron app |
| `apps/web` | Marketing site. Download is macOS .dmg and Windows .exe only |
| `apps/host` | Existing OTP / feedback API. The new app and site do not call it |
| `services/api` | FastAPI (Day 4) |
| `deploy` | Docker Compose: Caddy, API, Postgres/pgvector, Valkey, SearXNG |
| `pipelines/ingest` | Day 6 placeholder |
| `packages/ui` | Theme, jellyfish, seahorse, octopus |
| `packages/shared` | Product constants |
| `docs` | Architecture, diagrams, code samples |

## Design

One theme, in `packages/ui/src/tokens.css`: white and near-black surfaces, black or white text, orange `#F97316` as the only accent. Light and dark both read those variables. The jellyfish, seahorse, octopus, and the app icon use the same black, white, and orange. They are SVG and CSS, not a copied mascot, and they respect reduced motion. Light, dark, and system share one control.

The portable zip pack (RAM picker, `LOCAL-SETUP`, `SURF-OPEN`, in-zip `check-pack`) is removed. Model size is chosen in the desktop app's first launch. `build.txt` publishes `apps/web/dist` and drops the old zip pages from the live site.

No paid services, no bundled model weights. `resources/bin` and `*.gguf` are gitignored.
