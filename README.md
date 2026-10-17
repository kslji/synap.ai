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

## Web search on your laptop

Production search stays on the VM until step 10. This path is for development only. It runs SearXNG (JSON format on) and the FastAPI API on localhost. The desktop app uses it when you start it with `npm run dev` (`NODE_ENV=development`). Packaged installers ignore it unless you set the variables below.

`npm run dev:web` is still the marketing site. The local search stack is `npm run dev:search`.

### Mac (Docker Desktop)

1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) and start it.
2. From the repo root:

```bash
npm ci
npm run dev:search
```

3. Wait until the API is healthy, then in a second terminal:

```bash
curl -s http://127.0.0.1:8000/v1/health
npm run dev:desktop
```

4. In the app, leave **Offline only** off. Open **Settings**. The **Dev web search** card is there (it is hidden in a packaged build). Search, or fetch one `https` page. In chat you can also type `/web pier beacon` or `/fetch https://example.com/`. No account and no search quota on this local API.

Stop the stack with Ctrl+C, then `docker compose -f deploy/docker-compose.dev.yml down`.

### Windows (Docker Desktop)

1. Install Docker Desktop and start it. Use PowerShell.
2. From the repo root:

```powershell
npm ci
npm run dev:search
```

3. In a second PowerShell window:

```powershell
curl.exe -s http://127.0.0.1:8000/v1/health
npm run dev:desktop
```

4. Same Settings card and chat commands as on Mac. Ctrl+C stops Compose. Then:

```powershell
docker compose -f deploy/docker-compose.dev.yml down
```

Command Prompt uses the same `npm` and `docker compose` lines.

### Without Docker

Run the API with pip and point it at a SearXNG that has JSON enabled (`search.formats` includes `json`). That can be SearXNG on this machine (port 8080) or a public instance you trust. A public instance may log the query. The local container does not.

Mac:

```bash
cd services/api
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export SURF_API_LITE=1
export SURF_DEV_OPEN=1
export SEARXNG_URL=http://127.0.0.1:8080/search
export JWT_SECRET=dev-only-secret-change-me-at-least-32-bytes
export JWT_AUDIENCE=authenticated
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Windows PowerShell, from `services\api`:

```powershell
py -3 -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:SURF_API_LITE = "1"
$env:SURF_DEV_OPEN = "1"
$env:SEARXNG_URL = "http://127.0.0.1:8080/search"
$env:JWT_SECRET = "dev-only-secret-change-me-at-least-32-bytes"
$env:JWT_AUDIENCE = "authenticated"
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Command Prompt uses `set SURF_API_LITE=1` (and the same names) instead of `$env:`.

For a public SearXNG, set `SEARXNG_URL` to that instance's `/search` URL. If JSON is disabled, search returns 403.

`SURF_DEV_OPEN=1` skips sign-in and the daily quota. It only works in lite mode (no `DATABASE_URL`). Do not set it on a public host.

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
