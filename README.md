# Synap.surf

A local-first desktop assistant. The model runs on your computer. Chats stay there. When you are online, the app can catch up.

**Works offline. Stays up to date when you're online.**

## Quick start

Node.js 22.

```bash
npm ci
cd apps/desktop
node scripts/fetch-sidecars.mjs
node scripts/fetch-tessdata.mjs         # English and Hindi OCR models
node node_modules/electron/install.js   # only if the Electron binary is missing
npm run dev
```

The website:

```bash
npm run dev:web
```

<!-- BETA_UNSIGNED: delete this section when apps/web/src/beta.ts sets BETA_UNSIGNED to false. -->

### Beta: opening on Mac

Mac users: during the beta, Synap.surf isn't signed by Apple yet, so macOS may say it can't be opened or is from an unidentified developer. You only need to do this once.

1. Open Synap.surf once so macOS blocks it.
2. Go to System Settings → Privacy & Security.
3. Scroll to the Security section.
4. Click Open Anyway next to Synap.surf, then confirm.

Windows users: if you see "Windows protected your PC", click the small underlined More info link under the warning. The window then shows the app name and Unknown publisher, with a Run anyway button at the bottom right. Click Run anyway to install. You only need to do this once.

Self-test (models not included in git):

```bash
cd apps/desktop
SURF_MODELS_DIR=~/surf-models npm run selftest
```

Mac notes, including the self-test path, are in `apps/desktop/README.md`. Step 1 is `docs/STEP-1.md`. Document chat is `docs/STEP-2.md`. Web search and the offline switch are `docs/STEP-3.md`. Email login and signed knowledge packs are `docs/STEP-4.md`. The shared eval is `docs/HARNESS.md`.

```bash
python3 -m pip install -r harness/requirements.txt
SURF_MODELS_DIR=~/surf-models npm run eval
```

## Layout

| Path | What |
|---|---|
| `apps/desktop` | Electron app |
| `apps/web` | Marketing site. Download is macOS .dmg and Windows .exe only |
| `apps/host` | Existing OTP / feedback API. The new app and site do not call it |
| `services/api` | FastAPI search proxy, email OTP login, and the pack catalog |
| `services/packs` | Build and sign a knowledge pack from a folder of documents |
| `deploy` | Docker Compose: Caddy, API, Postgres/pgvector, Valkey, SearXNG |
| `pipelines/ingest` | Day 6 placeholder |
| `packages/ui` | Theme and Star Surf |
| `packages/shared` | Product constants |
| `docs` | Architecture, diagrams, code samples |

## Design

One theme, in `packages/ui/src/tokens.css`: white and near-black surfaces, black or white text, orange `#F97316` as the only accent. Light and dark both read those variables. The default is Light. Star Surf is the only character. The motion is CSS, and it respects reduced motion.

The portable zip pack (RAM picker, `LOCAL-SETUP`, `SURF-OPEN`, in-zip `check-pack`) is removed. Model size is chosen in the desktop app's first launch. `build.txt` publishes `apps/web/dist` and drops the old zip pages from the live site.

No paid services, no bundled model weights. `resources/bin` and `*.gguf` are gitignored.

## Auth host

`apps/host` is the existing OTP, account, and feedback API. The desktop app and the marketing site do not call it. The desktop signs in through `services/api` (email code, device row, access and refresh tokens). The host reuses the same OTP hash and attempt rules from `services/api/app/otp_policy.py`. Rate limits, health routes, and the VPS unit files are in `apps/host/README.md`.

```bash
python3 -m venv apps/host/.venv
apps/host/.venv/bin/pip install -r apps/host/requirements.txt
cp .env.example .env
apps/host/.venv/bin/python -m uvicorn main:app --app-dir apps/host --host 127.0.0.1 --port 18765
```

Checks that do not need a model:

```bash
./scripts/check.sh
```
