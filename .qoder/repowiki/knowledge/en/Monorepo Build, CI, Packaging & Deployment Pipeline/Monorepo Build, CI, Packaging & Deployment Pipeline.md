---
kind: build_system
name: Monorepo Build, CI, Packaging & Deployment Pipeline
category: build_system
scope:
    - '**'
source_files:
    - package.json
    - .github/workflows/ci.yml
    - .github/workflows/release.yml
    - .github/workflows/installers.yml
    - apps/desktop/package.json
    - apps/desktop/electron-builder.cjs
    - apps/desktop/electron.vite.config.ts
    - apps/web/package.json
    - apps/web/vite.config.ts
    - services/api/Dockerfile
    - services/api/requirements.txt
    - services/api/alembic.ini
    - deploy/docker-compose.yml
    - deploy/docker-compose.dev.yml
    - deploy/Caddyfile
    - deploy/.env.example
    - scripts/check.sh
    - harness/run.sh
    - scripts/build-code-pack
---

## Approach

The repository is a **npm workspaces monorepo** (root `package.json`) that orchestrates four Node/TypeScript packages (`apps/desktop`, `apps/web`, `packages/ui`, `packages/shared`) plus two Python services (`services/api`, `apps/host`), an evaluation harness, and deployment manifests. There is no Makefile at the root; orchestration lives in GitHub Actions workflows and per-package npm scripts.

- **Node toolchain**: Node ≥22 (enforced via `engines`), `npm ci` for deterministic installs, `electron-vite` for the desktop app build, Vite for the marketing site.
- **Desktop packaging**: Electron + `electron-builder` producing AppImage (Linux x64), DMG/Zipped `.app` (macOS arm64+x64), NSIS installer (Windows x64). Code signing is disabled on free runners (`CSC_IDENTITY_AUTO_DISCOVERY: false`).
- **Python toolchain**: `pip install -r requirements*.txt`, isolated venvs for host checks, Alembic migrations under `services/api/alembic/`.
- **Containerization**: Docker Compose stack (`deploy/docker-compose.yml`) with Caddy reverse proxy, FastAPI, Postgres+pgvector, Valkey, SearXNG — all images pinned by SHA digest.
- **CI/CD**: GitHub Actions workflows under `.github/workflows/`.

## Key Files

| Area | File(s) |
|---|---|
| Monorepo root | `package.json`, `eslint.config.mjs`, `pyrightconfig.json`, `ruff.toml` |
| Desktop app build | `apps/desktop/package.json`, `apps/desktop/electron.vite.config.ts`, `apps/desktop/electron-builder.cjs`, `apps/desktop/playwright.config.mjs` |
| Web app build | `apps/web/package.json`, `apps/web/vite.config.ts` |
| API container | `services/api/Dockerfile`, `services/api/requirements.txt`, `services/api/alembic.ini` |
| Host checks | `scripts/check.sh`, `apps/host/requirements.txt` |
| Evaluation harness | `harness/run.sh`, `harness/requirements.txt` |
| Offline pack builder | `scripts/build-code-pack`, `scripts/code-pack-src/build.ts` |
| CI entrypoint | `.github/workflows/ci.yml` |
| Release pipeline | `.github/workflows/release.yml`, `.github/workflows/installers.yml`, `.github/workflows/model-eval-full.yml`, `.github/workflows/code-pack.yml`, `.github/workflows/eval-full.yml`, `.github/workflows/codeql.yml` |
| Deployment stack | `deploy/docker-compose.yml`, `deploy/docker-compose.dev.yml`, `deploy/Caddyfile`, `deploy/.env.example` |

## Architecture of the Build System

### Root-level orchestration

`package.json` defines workspace members and top-level scripts:
- `build` → builds both `@surf/desktop` and `@surf/web`
- `typecheck` → runs TypeScript typecheck across both apps
- `selftest` → delegates to `@surf/desktop:selftest`
- `eval` → runs `harness/run.sh quick`
- `dev:search` → starts the Docker Compose dev stack

Each workspace package owns its own `package.json` with `typecheck`, `build`, `test:*`, and `dist:*` scripts. The root never invokes TypeScript or Python directly — it shells out through npm workspaces.

### Desktop build pipeline

1. `electron-vite build` compiles main-process TS and the React renderer into `out/main/index.js` and `out/renderer/`.
2. `electron-builder` (configured via `electron-builder.cjs`) consumes the built output and produces platform-specific artifacts.
3. Prebuilt native assets are fetched at runtime before build: `scripts/fetch-sidecars.mjs` (llama.cpp binaries), `scripts/fetch-whisper.mjs`, `scripts/fetch-tessdata.mjs`.
4. After packaging, `after-pack.cjs` post-processes the bundle.
5. Smoke tests run against each produced artifact inside the CI jobs.

### Python service builds

- `services/api`: Dockerfile based on `python:3.12-slim` (pinned by SHA), runs `uvicorn app.main:app` as non-root user `api` (uid 10001).
- `apps/host`: No container image; checked via `scripts/check.sh` which runs unittest discovery under `apps/host/tests/` plus harness unit evals.
- Migrations: Alembic under `services/api/alembic/versions/`; CI validates schema drift via `alembic heads`.

### CI workflow structure (`.github/workflows/ci.yml`)

Parallel jobs on every push/PR:

| Job | Purpose |
|---|---|
| `desktop` | Installs deps, fetches sidecars/whisper/tessdata, runs unit tests, builds desktop |
| `web` | Builds marketing site, runs link/site tests |
| `api` | Installs Python deps, runs pytest, validates Alembic schema, validates docker compose configs |
| `host` | Runs `scripts/check.sh` (unit tests + harness evals) |
| `eval` | Full harness eval with xvfb, model cache, report upload |
| `lint` | ESLint + Ruff |
| `typecheck` | tsc + pyright |
| `unit-coverage` | Desktop coverage threshold test |
| `no-fabrication` | Deterministic hallucination guard suite |
| `security` | npm audit + pip-audit + gitleaks |
| `licences` | Dependency/license audit across all Python requirement files |
| `e2e` | Playwright smoke + model-reply tests against built desktop |
| `visual` | Visual regression snapshot tests |
| `budget` | Bundle size / startup time budget check |
| `model-eval` | Model eval subset |
| `code-pack-eval` | Code pack eval |

Every job repeats the same `npm ci` retry loop (up to 3 attempts) because the registry sometimes resets connections during `node-gyp` builds of `better-sqlite3`.

### Release pipeline (`.github/workflows/release.yml`)

Triggered on `push` of tags matching `v*`:

1. `checks` — reuses `ci.yml` via `workflow_call`.
2. `model-eval-full` — full model eval gate.
3. `installers` — reusable workflow building macOS (arm64+x64 DMG), Windows (NSIS), Linux (AppImage) installers; uploads artifacts named `installer-macos`, `installer-windows`, `installer-linux`.
4. `offline-windows` / `offline-mac` — download installer payloads, embed Qwen 2B/4B/9B GGUF models via `scripts/pack-offline-zip.ts`, produce offline zip catalogs uploaded to Hugging Face (`HF_OFFLINE_REPO`).
5. `publish` — merges offline package catalogs, generates `SHA256SUMS`, publishes a GitHub Release via `softprops/action-gh-release@v2` (prerelease when tag contains `-beta`).

### Versioning strategy

- The root `package.json` declares `version: "0.1.0"` but is marked `private: true` — it is not published.
- Each workspace has its own version (`@surf/desktop` is `0.2.0`).
- Release tags follow `v<major>.<minor>.<patch>` with optional prerelease suffix `-beta.<n>`.
- The release script reads the desktop app's version from `apps/desktop/package.json` to name offline packages.

### Deployment stack

`deploy/docker-compose.yml` defines five services:
- `caddy` — reverse proxy (image pinned by SHA, comment notes verified date).
- `api` — built from `services/api/Dockerfile`, health-checked on `/v1/health`.
- `searxng` — search engine, internal port only.
- `valkey` — Redis-compatible cache with LRU eviction.
- `postgres` — pgvector image, initialized from `deploy/initdb/01_schema.sql`.

Environment variables come from `deploy/.env` (generated from `deploy/.env.example`).

## Conventions and Constraints

1. **Deterministic installs everywhere**: All CI steps use `npm ci` (not `npm install`) and pin Node versions via `actions/setup-node` with caching.
2. **Native dependency resilience**: Every CI job wraps `npm ci` in a three-attempt loop that deletes `node_modules` between retries, documented as a workaround for ECONNRESET and node-gyp hangs on Windows.
3. **Node version lock**: Root `engines.node = ">=22"`; all `setup-node` actions request `node-version: 22`.
4. **No prebuilt Electron binaries in CI**: Jobs install system dependencies (`make`, `g++`, X11/Electron libs, xvfb) rather than relying on cached Electron binaries.
5. **Model weights are cached**: CI caches `.surf-models/Qwen3.5-2B-Q4_K_M.gguf` keyed by the file id and sha256 so model downloads are skipped after the first run.
6. **Sidecar assets are fetched, not committed**: llama.cpp sidecars, whisper binaries, and tessdata OCR data are downloaded at build time via Node scripts under `apps/desktop/scripts/`.
7. **Code signing is opt-in**: Installer workflows set `CSC_IDENTITY_AUTO_DISCOVERY: false`; comments state signing secrets stay empty until `docs/RELEASE.md` says otherwise.
8. **Docker images are pinned by SHA digest**: Both `docker-compose.yml` and `services/api/Dockerfile` use `image:...@sha256:...` references with inline version comments.
9. **Python environments are isolated per service**: `services/api/requirements.txt`, `services/api/requirements-dev.txt`, `apps/host/requirements.txt`, and `harness/requirements.txt` are separate; license checks iterate over each.
10. **Smoke testing is mandatory for installers**: Each platform's installer job launches the built binary with `SURF_SMOKE=1` and waits for a `smoke ok` log line before considering the build successful.
11. **Offline zips are gated behind tags**: The `offline-*` release jobs have `if: startsWith(github.ref, 'refs/tags/v')`; pull requests do not download GGUF files.
12. **Release artifacts include checksums**: The publish step generates `SHA256SUMS` for every file in the release.
13. **Pre-release detection**: Releases containing `-beta` in the tag are published as GitHub prereleases automatically.