# Surf AI API

Login, devices, licences, pack catalog, and the OpenRouter chat gateway (`POST /api/v1/chat`, code in `app/gateway/`, decision in `docs/adr/0005-openrouter-gateway.md`).

Gateway flow per request: bearer token → user id → that user's history only (sliding window, `GATEWAY_HISTORY_TOKENS`) → pre-flight (tiktoken count × 1.15 × input price; 402 if the balance cannot cover it, otherwise `max_tokens` = affordable output) → OpenRouter with the master `OPENROUTER_API_KEY` → bill native `usage` × `GATEWAY_MARKUP` (default 1.20), lock the account at balance ≤ 0, write a `billing_transactions` audit row and the chat turn. Prices live in `models_pricing`, synced from `GET https://openrouter.ai/api/v1/models` every `PRICING_SYNC_SECONDS` (6 h).

Local lite mode (no Postgres): `npm run dev:api`, or

```bash
python3 -m pip install -r requirements.txt
SURF_API_LITE=1 JWT_SECRET=dev-only-secret-change-me-at-least-32-bytes OPENROUTER_API_KEY=... \
  python3 -m uvicorn app.main:app --app-dir . --host 127.0.0.1 --port 8000
```

The compose stack in `deploy/` is the production shape (Caddy, API, Postgres, Valkey). See `docs/STEP-4.md` for login, pack files, and the GCP notes.

Sign in with `POST /v1/auth/otp/start` and `POST /v1/auth/otp/verify`. The access JWT is HS256, audience `authenticated`, `typ` `access`, and `sub` is the device id. `POST /v1/devices/register` returns 410. In lite mode `MAIL_MODE=console` includes `dev_code` in the start response.

```bash
python3 -m pip install -r requirements-dev.txt
python3 -m pytest
```
