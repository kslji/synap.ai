---
kind: logging_system
name: Per-Service Structured Logging (Python stdlib JSON + Electron console wrapper)
category: logging_system
scope:
    - '**'
source_files:
    - apps/host/logging_setup.py
    - apps/host/main.py
    - apps/host/asgi_guard.py
    - apps/host/rate_limit.py
    - apps/desktop/src/main/core/main-log.ts
---

## What is used

There is no shared logging framework across the monorepo. Each service configures its own logger:

- **apps/host** (FastAPI host): Python `logging` module with a custom `_JsonFormatter` that emits one JSON object per line to `stderr`. Gunicorn captures stderr into `apps/host/logs/error.log`.
- **apps/desktop** (Electron main process): A hand-rolled `main-log.ts` that wraps `console.log/warn/error`, writes ISO-timestamped lines to a rotating file under `userData/logs/main.log`, and installs `uncaughtException` / `unhandledRejection` handlers that log the stack and show a user notification.
- **services/api** (Surf web API): Uses plain `import logging` and `logging.info`/`logging.error` directly from the stdlib; no custom formatter or structured output was found in this service.
- **scripts/**, **harness/**, **apps/web**: Use bare `console.log` / `process.stderr.write`; no structured logging.

## Key files

- `apps/host/logging_setup.py` — defines the `surf` logger, `_JsonFormatter`, `configure()`, and `log_boot()`.
- `apps/host/main.py` — calls `configure()` and `log_boot()` during FastAPI lifespan; also logs request errors via `LOG.exception(...)`.
- `apps/host/asgi_guard.py` — central request/response logger using `LOG.debug/info/error` with `extra={}` fields (`request_id`, `method`, `path`, `status`, `duration_ms`, `client_ip`).
- `apps/host/rate_limit.py` — uses `LOG.warning` for degraded-rate-limit-store cases.
- `apps/desktop/src/main/core/main-log.ts` — `installMainLog`, `createRotatingLog`, `attachPipeGuard`, `installProcessGuards`.

## Architecture and conventions

### Host (Python)

1. All host code imports the singleton `LOG = logging.getLogger("surf")` from `logging_setup` rather than creating ad-hoc loggers.
2. `configure()` is idempotent: it returns early if `LOG.handlers` already exist, sets level from `settings.log_level` (default `INFO`), attaches a single `StreamHandler(sys.stderr)`, and disables propagation.
3. The custom `_JsonFormatter` produces flat JSON objects with these fixed keys:
   - `ts` — UTC ISO timestamp
   - `level` — lowercase level name
   - `logger` — logger name (`surf`)
   - `msg` — `record.getMessage()`
   - Optional fields pulled from `record.__dict__` via `getattr`: `request_id`, `method`, `path`, `status`, `duration_ms`, `client_ip`
   - `exc` — formatted exception traceback when `record.exc_info` is set
4. Request-scoped context is attached through `extra=` on every `LOG.*` call inside `asgi_guard.py` (e.g. `LOG.debug("request", extra=extra)`). There is no thread-local context manager; callers must pass `extra` explicitly.
5. Boot-time diagnostics are centralized in `log_boot()`, which warns about missing SMTP, admin password, default LiveKit credentials, and CORS origins.
6. Log levels observed in the host: `debug`, `info`, `warning`, `error`, `exception`.

### Desktop (Electron main)

1. `installMainLog(dir)` creates a rotating file writer under `dir` (typically `userData/logs`) and patches `console.log`, `console.warn`, `console.error` so every line is written as `${ISO timestamp} ${level} ${args...}`.
2. Rotation keeps at most `KEEP = 3` rotated files (`main.log`, `main.1.log`, `main.2.log`, `main.3.log`) and rotates when size exceeds `MAX_BYTES = 512 KiB`.
3. `attachPipeGuard(process.stdout)` / `attachPipeGuard(process.stderr)` swallows `EPIPE` / `EIO` errors so closing the terminal does not crash the app.
4. `installProcessGuards(log, notify)` installs global `uncaughtException` and `unhandledRejection` listeners that write the error stack to the file and show a clipped user-facing notification dialog (clipped via `clipWords` + `NOTIFY_LIMIT`). Benign errors (`AbortError`, `EPIPE`, `EIO`) are ignored.
5. Errors are serialized by `formatArg`: `Error.stack` or `.message`, strings passthrough, otherwise `JSON.stringify` with a fallback to `String(value)`.

### services/api

The Surf web API service (`services/api/app/*.py`) imports the stdlib `logging` module directly and calls `logging.info` / `logging.error` without configuring a custom formatter or attaching it to a named logger. No structured JSON output is produced here.

## Conventions and constraints

- **Host log format is JSON-lines on stderr.** Enforced by the custom `_JsonFormatter` in `logging_setup.py` and the comment "JSON logs on stderr. Gunicorn already captures stderr into apps/host/logs/error.log." Consumers should parse each line as JSON.
- **Structured fields are passed via `extra=`**, not via string interpolation. The formatter reads them from the record dict; only the six documented keys (`request_id`, `method`, `path`, `status`, `duration_ms`, `client_ip`) are automatically promoted to top-level fields.
- **Logger initialization is centralized and idempotent.** `configure()` guards against double-installation via `if LOG.handlers: return`, and `log_boot()` is the canonical entry point called from FastAPI lifespan.
- **Desktop logs never crash the process on I/O failure.** Both the rotating-file writer and the stdout/stderr pipe guard swallow disk-full and closed-pipe errors (`try/except` around `appendFileSync`/`renameSync`, `isClosedPipe` check).
- **Unhandled exceptions in the desktop main process are persisted and surfaced to the user.** `installProcessGuards` writes stacks to the log file and shows a one-shot friendly notification; benign `AbortError` / `EPIPE` / `EIO` events are suppressed.
- **No cross-service logger abstraction exists.** Each service owns its own logging setup; there is no shared package exporting a common logger instance.