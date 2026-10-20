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

## API and chat gateway on your laptop

`npm run dev:api` runs the FastAPI API in lite mode (in-memory stores) on `127.0.0.1:8000` with `deploy/docker-compose.dev.yml`. Set `OPENROUTER_API_KEY` in your shell first to enable `POST /api/v1/chat`; new dev accounts start with $2.00 of credit. Without Docker:

```bash
cd services/api
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
SURF_API_LITE=1 JWT_SECRET=dev-only-secret-change-me-at-least-32-bytes OPENROUTER_API_KEY=... \
  python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

The SearXNG search proxy (`/v1/search`, `/v1/fetch`) was removed; see `docs/adr/0005-openrouter-gateway.md`.

### Desktop address

In development the app calls `http://127.0.0.1:8000` unless you override it:

```bash
SYNAP_API_URL=http://127.0.0.1:8000 npm run dev:desktop
```

PowerShell: `$env:SYNAP_API_URL = "http://127.0.0.1:8000"`.

A packaged build does not use that default. Set `SYNAP_API_URL` only when you mean to. `web_search` and `fetch_page` stay off unless `NODE_ENV=development` or `SYNAP_DEV_WEB=1`. `SURF_API_BASE` still wins over the localhost default, which is what the eval fixture uses.

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
| `packages/ui` | Theme and the Surf Bot blob |
| `packages/shared` | Product constants |
| `docs` | Architecture, diagrams, code samples |

## Design

One theme, in `packages/ui/src/tokens.css`: white and near-black surfaces, black or white text, orange `#F97316` as the only accent. Light and dark both read those variables. The default is Light. Surf Bot is the only character, an SVG blob. Reduced motion lowers the amplitude and skips sparkles. The installed icon stays the default orange.

The portable zip pack (RAM picker, `LOCAL-SETUP`, `SURF-OPEN`, in-zip `check-pack`) is removed. Model files are downloaded from the website. The app finds a verified file and moves it in. `build.txt` publishes `apps/web/dist` and drops the old zip pages from the live site.

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
