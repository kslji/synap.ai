---
kind: configuration_system
name: Configuration System — Environment-Driven Settings Across Python Services and Electron Desktop
category: configuration_system
scope:
    - '**'
source_files:
    - deploy/.env.example
    - services/api/.env
    - apps/host/config.py
    - apps/host/gunicorn.conf.py
    - services/api/app/main.py
    - services/api/alembic/env.py
    - deploy/docker-compose.yml
    - apps/desktop/src/main/core/surf-env.ts
    - apps/desktop/electron.vite.config.ts
---

## Approach

The monorepo has no single shared configuration framework. Each runtime component defines its own settings surface, all ultimately sourced from environment variables (`.env` files for local dev, Docker `env_file`, or host process env). Secrets are never committed; `.env.example` documents every required key.

Two patterns coexist:
- **Python services** (`apps/host`, `services/api`) use `pydantic_settings.BaseSettings` plus raw `os.environ` / `ENV.get()` calls.
- **Electron desktop** reads `process.env` directly through a thin `SURF_*` prefix helper that also falls back to legacy `HARBOR_*` names.

## Key Files

- `deploy/.env.example` — canonical inventory of every environment variable consumed by the deployment stack (Postgres, Valkey, SearXNG, JWT, SMTP, pack backend, Stripe/Razorpay webhooks, licence keys, rate limits).
- `services/api/.env` — local defaults for the auth/search API (Moss keys, LiveKit, SMTP, SURF_ENV, CORS, Gunicorn bind, rate limits, admin console).
- `apps/host/config.py` — `BaseSettings` class with typed defaults and `SettingsConfigDict(env_file=ROOT / ".env", extra="ignore")`; exposes `settings = Settings()` singleton.
- `apps/host/gunicorn.conf.py` — process-level config read via `os.getenv` (bind, concurrency, timeouts, log dir, log level).
- `services/api/app/main.py` — FastAPI lifespan that branches on `DATABASE_URL` / `SURF_API_LITE` to select in-memory vs Postgres+Valkey backends; reads most runtime flags directly from `os.environ`.
- `services/api/alembic/env.py` — Alembic migration env that reads `DATABASE_URL` from the process environment and rewrites it to `postgresql+psycopg://`.
- `deploy/docker-compose.yml` — wires `.env` into `api` and `postgres` containers; passes `SEARXNG_SECRET` explicitly to the SearXNG service.
- `apps/desktop/src/main/core/surf-env.ts` — `surfEnv(name)` helper that reads `SURF_<name>` first, then falls back to `HARBOR_<name>` for backward compatibility.
- `apps/desktop/electron.vite.config.ts` — build-time aliases for `@surf/ui` and `@surf/shared`; renderer server allows filesystem access to repo root during development.

## Architecture and Conventions

### Per-service settings classes
`apps/host/config.py` is the only place that centralizes settings via Pydantic: a single `Settings(BaseSettings)` class declares every field with a default, and `model_config = SettingsConfigDict(env_file=ROOT / ".env", extra="ignore")` tells Pydantic to load from `<repo-root>/.env` while silently ignoring unknown env vars. The module resolves `ROOT` by walking parents looking for `harness/` so it works both inside the monorepo and when unzipped as `local-ai/host`.

### Raw env access alongside typed settings
`services/api/app/main.py` does not define a `BaseSettings` class. Instead it assigns `ENV = os.environ` at module top and reads values inline (`ENV.get("SURF_DEV_OPEN")`, `ENV["DATABASE_URL"]`, `ENV.get("SEARCH_PER_MIN", "10")`). This is intentional: the API's behaviour switches between Lite (in-memory) and full (Postgres + Valkey) modes based on whether `DATABASE_URL` is set, and many per-request flags (webhook secrets, admin token, fetch allow-list) are read at call time rather than startup.

### Environment-driven feature toggles
- `SURF_ENV` (`development` | `production`) controls host behaviour (hide `/docs`, warn about missing SMTP).
- `SURF_API_LITE` or absence of `DATABASE_URL` selects in-memory stores over Postgres/Valkey in the API.
- `MAIL_MODE=console` vs `smtp` controls OTP delivery and whether the dev code is echoed in the response.
- `PACK_BACKEND=file|s3` (from `deploy/.env.example`) selects local file serving vs R2 presigning.
- `FETCH_ALLOW_HOSTS` (comma-separated list) whitelists private IPs for local fixtures only.

### Secret handling
Secrets live in `.env` files that are gitignored. `deploy/.env.example` documents every secret with comments such as `# Do not commit a production secret.` and `# Never commit a real seed.` Production values are injected via Docker Compose `env_file` or host process environment. The API uses `hmac.compare_digest` for constant-time comparison of `LICENCE_ADMIN_TOKEN` and webhook signatures.

### Deployment-layer configuration
`docker-compose.yml` pins images by digest and mounts `Caddyfile` and `searxng/settings.yml` as read-only volumes. It passes `SEARXNG_SECRET` explicitly to the SearXNG container while letting `api` and `postgres` consume the rest from the shared `.env` via `env_file: .env`. Health checks probe `/v1/health` and `pg_isready`.

### Legacy name support
`srf-env.ts` in the Electron main process supports both `SURF_*` and the older `HARBOR_*` prefixes, allowing scripts and notes written before the product rename to keep working without changes.

## Conventions and Constraints

- All runtime configuration is supplied through environment variables; there is no YAML/JSON/TOML application config loader used by the running services.
- `.env.example` under `deploy/` is the authoritative source of truth for which variables exist; each service's local `.env` mirrors those names.
- Secrets are never committed: comments in `services/api/.env` say `Never commit real values`, and `deploy/.env.example` contains placeholder strings like `change-me-long-random`.
- The host service validates settings types via Pydantic (`int`, `Path`, `bool`, `str`) and provides sensible defaults so the service can start locally without any `.env`.
- `extra="ignore"` on the host's `SettingsConfigDict` means unknown environment variables are silently dropped rather than raising an error.
- Database URLs flow through `DATABASE_URL` exclusively: the API constructs `AsyncConnectionPool(ENV["DATABASE_URL"])` and Alembic's `env.py` rewrites `postgresql://` to `postgresql+psycopg://` before passing to SQLAlchemy.
- Rate-limit and activation-bucket parameters are read from env at startup/lifespan time (`ACTIVATION_LIMIT`, `ACTIVATION_WINDOW`, `SEARCH_PER_MIN`, `SEARCH_PER_DAY`, `SEARCH_CACHE_TTL`) and stored on `app.state`.
- Webhook endpoints (`/v1/billing/stripe`, `/v1/billing/razorpay`) reject requests when their corresponding `_WEBHOOK_SECRET` env var is empty, returning a 503 `unconfigured` error.
- The Gunicorn config reads bind address from either `HOST_BIND` alone or the combined `HOST_BIND:HOST_PORT` form, falling back to `127.0.0.1:18765`.
- The Electron build externalizes Node dependencies (`externalizeDeps: true` for main, `false` for preload) so the desktop consumes the bundled `node_modules` rather than embedding them.