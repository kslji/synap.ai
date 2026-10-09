# Surf AI API

Search proxy and page fetch. The desktop calls it only when web search is allowed and Offline only is off. User documents are not uploaded. Query text is not stored.

Local lite mode (no Postgres):

```bash
python3 -m pip install -r requirements.txt
SURF_API_LITE=1 SEARXNG_URL=http://127.0.0.1:8080/search \
  JWT_SECRET=dev-only-secret-change-me-at-least-32-bytes \
  python3 -m uvicorn app.main:app --app-dir . --host 127.0.0.1 --port 8000
```

The compose stack in `deploy/` is the production shape (Caddy, API, Postgres, Valkey, SearXNG). See `docs/STEP-4.md` for login, pack files, and the GCP notes.

Sign in with `POST /v1/auth/otp/start` and `POST /v1/auth/otp/verify`. The access JWT is HS256, audience `authenticated`, `typ` `access`, and `sub` is the device id. `POST /v1/devices/register` returns 410. In lite mode `MAIL_MODE=console` includes `dev_code` in the start response.

```bash
python3 -m pip install -r requirements-dev.txt
python3 -m pytest
```
