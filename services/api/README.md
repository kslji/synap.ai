# Surf AI API

Account, licence and billing service, plus the OpenRouter chat gateway the desktop uses in Online mode. No browsing endpoints exist: the server stores no AI replies and no user code.

Local lite mode (no Postgres):

```bash
python3 -m pip install -r requirements.txt
SURF_API_LITE=1 MAIL_MODE=console \
  JWT_SECRET=dev-only-secret-change-me-at-least-32-bytes \
  python3 -m uvicorn app.main:app --app-dir . --host 127.0.0.1 --port 8000
```

The compose stack in `deploy/` is the production shape (Caddy, API, Postgres, Valkey). See `docs/STEP-4.md` for login, pack files, and the GCP notes.

Sign in with `POST /v1/auth/otp/start` and `POST /v1/auth/otp/verify`. The access JWT is HS256, audience `authenticated`, `typ` `access`, and `sub` is the device id. `POST /v1/devices/register` returns 410. In lite mode `MAIL_MODE=console` includes `dev_code` in the start response.

```bash
python3 -m pip install -r requirements-dev.txt
python3 -m pytest
```
