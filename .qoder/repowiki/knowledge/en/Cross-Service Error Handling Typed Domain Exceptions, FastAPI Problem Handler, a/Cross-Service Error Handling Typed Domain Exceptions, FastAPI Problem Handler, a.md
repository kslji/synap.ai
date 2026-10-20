---
kind: error_handling
name: 'Cross-Service Error Handling: Typed Domain Exceptions, FastAPI Problem Handler, and Stable JSON Error Schema'
category: error_handling
scope:
    - '**'
source_files:
    - services/api/app/main.py
    - services/api/app/auth_store.py
    - services/api/app/licences.py
    - apps/host/errors.py
    - apps/host/schemas/error.json
---

## Overview

The monorepo uses two complementary error-handling strategies depending on the runtime:

- **Python services** (FastAPI `services/api` and `apps/host`) define domain-specific exception classes that carry HTTP status, a machine-readable code string, and an optional `retry_after`. A single FastAPI `exception_handler` converts them into a stable JSON envelope.
- **TypeScript desktop app** (`apps/desktop/src/main`) throws plain `Error`s from network calls, reading the server's `error.message` field via a local `problem(res)` helper. There is no shared typed error class in the renderer; errors are surfaced as strings to callers.

## Python side — typed exceptions + central handler

### Service API (`services/api/app/main.py`)

- `Problem(status, code, detail, retry_after=None)` is the sole HTTP-facing exception type. It is raised throughout route handlers for auth failures, rate limits, invalid input, upstream failures, and configuration errors.
- `@app.exception_handler(Problem)` serializes it to `{"error": {"code": ..., "message": ...}}` with the original HTTP status and an optional `Retry-After` header.
- Domain layers raise their own exceptions:
  - `AuthError` in `auth_store.py` — carries `status`, `code`, `detail`, `retry_after` (e.g. `resend_cooldown`, `invalid_code`, `expired`, `too_many_attempts`, `device_revoked`, `device_limit`, `refresh_reused`).
  - `LicenceError` in `licences.py` — same shape, used for licence validation, activation limits, webhook parsing, and subscription state (e.g. `invalid_key`, `licence_inactive`, `licence_revoked`, `licence_refunded`, `no_licence`, `not_found`).
- Route handlers translate these into `Problem` via thin helpers `_auth_problem` and `_licence_problem`, which forward all four fields unchanged. This keeps business logic free of HTTP concerns while ensuring every user-visible failure has a stable `code`.
- Additional sentinel exceptions exist for non-HTTP paths: `SsrfBlocked` (in `ssrf.py`, caught in `/v1/fetch`), `ConvertError`/`NoInstanceError` in `apps/host`.

### Host service (`apps/host/errors.py`)

- `STATUS_CODES` maps numeric HTTP codes to stable string codes (`invalid_request`, `unauthorized`, `forbidden`, `not_found`, `conflict`, `payload_too_large`, `validation_error`, `locked`, `rate_limited`, `internal_error`, `not_implemented`, `bad_gateway`, `unavailable`).
- `code_for(status, explicit?)` resolves a code from the map or returns the fallback `"error"`.
- `error_payload(detail, code, request_id?)` builds the canonical body `{detail, code, request_id?}`.
- The comment explicitly states the contract: *"Stable JSON error shape. `detail` stays a string or validation list so the site parser keeps working."*
- `apps/host/schemas/error.json` is a JSON Schema declaring the host API error envelope with `required: ["detail", "code"]`, an enum of allowed codes, and an optional `request_id`. The schema description repeats the stability guarantee.

## TypeScript side — throw-and-catch with `problem(res)`

In `apps/desktop/src/main/core/auth-session.ts`:

- Every outbound call checks `res.ok`; on failure it throws `new Error(await problem(res))`.
- `problem(res)` parses the response body as `{ error?: { message?: string } }` and returns `body.error?.message || 'request failed (X)'`. It swallows parse failures, falling back to a generic message.
- Callers catch `Error` and display `error.message` (see repeated patterns like `const msg = error instanceof Error ? error.message : String(error)` in `code-agent/loop.ts`, `sandbox.ts`, `split.ts`, `dev-web-tools.ts`).
- There is no client-side equivalent of `Problem` / `AuthError` / `LicenceError`; the client treats all non-2xx responses uniformly by extracting the human-readable message.

## Conventions observed

1. **Every user-facing error has a stable machine-readable `code`** — defined either in `STATUS_CODES` (host) or directly on the exception instance (service API). Codes include `invalid_email`, `invalid_token`, `rate_limited`, `search_unavailable`, `unconfigured`, `bad_signature`, `invalid_body`, `invalid_query`, `gone`, etc.
2. **Domain exceptions never leak raw stack traces** — they carry only `status`, `code`, `detail`, and optionally `retry_after`, which the `Problem` handler serializes.
3. **Rate-limiting errors set `Retry-After`** — both the global limiter and the per-IP/device activation limiter pass `retry_after` through `Problem`, and the handler emits the `Retry-After` header.
4. **Validation errors use 422 + `validation_error`** — FastAPI's default Pydantic validation goes through the host's `STATUS_CODES` mapping rather than being custom-formatted.
5. **Client-side error handling is uniform** — `auth-session.ts` wraps every fetch failure in a plain `Error` whose message comes from the server's `error.message`; callers do not branch on `code`.
6. **Errors are logged at warning level when dev-only** — e.g. `SURF_DEV_OPEN` logs once via `log.warning` before bypassing auth/quota.
7. **Host error schema is versioned** — `apps/host/schemas/error.json` pins the expected shape and enumerates allowed codes, acting as a contract between host and any consumer.

## Rules enforced by the implementation

- Raising `Problem` is the only way to return a structured HTTP error from a FastAPI route in `services/api/app/main.py`; all other routes raise domain exceptions that are converted by `_auth_problem` / `_licence_problem`.
- The `Problem` exception handler is registered exactly once via `@app.exception_handler(Problem)`, so every `Problem` produces the `{"error": {"code", "message"}}` shape with the correct status code.
- `apps/host/errors.STATUS_CODES` is the single source of truth for numeric-to-string code mapping; `code_for()` falls back to `"error"` for unmapped statuses, preventing unknown codes from leaking.
- The JSON Schema in `apps/host/schemas/error.json` declares `additionalProperties: false`, enforcing that host error bodies contain only `detail`, `code`, and optional `request_id`.