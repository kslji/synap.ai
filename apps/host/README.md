# Auth host

`apps/host` is the small cloud for **accounts, OTP, and feedback**. Chat and files stay on the laptop (Ollama). The same process can serve a local instance when someone runs the host on their own machine; the marketing VPS should not store chats.

The public site UI in `apps/web` is separate. This package does not change that design.

## Run locally

From the repo root:

```bash
python3 -m venv apps/host/.venv
apps/host/.venv/bin/pip install -r apps/host/requirements.txt
cp .env.example .env
apps/host/.venv/bin/python -m uvicorn main:app --app-dir apps/host --host 127.0.0.1 --port 18765
```

Gunicorn (what the VPS unit runs):

```bash
cd apps/host
.venv/bin/gunicorn -c gunicorn.conf.py main:app
```

Website, from `apps/web`:

```bash
npm ci
npm run dev
```

`npm run build` writes a static export to `apps/web/out`. Moss keys are optional; without them the pack vault is empty and search falls back to on-device keywords.

## Checks

```bash
./scripts/check.sh
```

That runs host unit tests and harness evals that do not need a model. With the host already on port 18765:

```bash
./harness/run.sh
```

`harness/evals/smoke.py` reads the OTP from `data/platform/mail-outbox.jsonl` when `SMTP_HOST` is empty. Do not point smoke at a production SMTP host.

## What production changes

| Area | Behavior |
| --- | --- |
| Rate limits | OTP, login, and auth posts share a SQLite window across gunicorn workers. Defaults: 5 OTP sends / 15 min / email, 20 / 15 min / IP. |
| Errors | `{ "detail", "code", "request_id" }`. `detail` stays a string or the usual validation list. Schema: `schemas/error.json`. |
| Headers | `nosniff`, `DENY` frames, `no-referrer`, `X-Request-ID`. Auth responses are `Cache-Control: no-store`. |
| Health | `GET /healthz` is liveness (no Ollama probe). `GET /ready` pings the platform DB. `GET /health` is the full snapshot, cached for a few seconds. |
| Public paths | Browsers that arrive through nginx do not see `data_dir` or home paths. A curl to `127.0.0.1` still does. |
| OTP mail | With `SMTP_HOST` set, the outbox file stores `[redacted]` instead of the code. Without SMTP, the local outbox is mode `0600` so the harness can read it. |
| Sessions | A password reset invalidates older email-login tokens. |
| Feedback | `GET /v1/feedback` returns only that account's rows. |
| Purge | `POST /v1/platform/purge` requires an admin token. The timer still calls `purge_platform.py` directly. |
| Docs | `/docs` is off when `SURF_ENV=production`. |

`allowInBrowserLlm()` in `apps/web/src/lib/browserCaps.ts` stays false for every public hostname, including synap.surf.

## Deploy notes

`deploy/synap-host.service` matches the current VPS user. `deploy/synap-purge.service` uses that same user and `PLATFORM_DATA_DIR=/var/lib/synap/platform`. `deploy/nginx-synap.surf.conf` is an example of the proxy headers the rate limiter expects (`X-Real-IP` or `X-Forwarded-For` from loopback nginx only).

If the VPS user is not `prajugatmachrayt`, edit both unit files before copying them to `/etc/systemd/system/`.
