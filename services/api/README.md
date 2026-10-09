# Surf AI API

Search proxy and page fetch. The desktop calls it only when web search is allowed and Offline only is off. User documents are not uploaded. Query text is not stored.

Local lite mode (no Postgres):

```bash
python3 -m pip install -r requirements.txt
SURF_API_LITE=1 SEARXNG_URL=http://127.0.0.1:8080/search \
  JWT_SECRET=dev-only-secret-change-me-at-least-32-bytes \
  python3 -m uvicorn app.main:app --app-dir . --host 127.0.0.1 --port 8000
```

The compose stack in `deploy/` is the production shape (Caddy, API, Postgres, Valkey, SearXNG). See `docs/STEP-3.md` for the GCP VM notes.

`POST /v1/devices/register` returns a temporary HS256 device JWT. Step 5 replaces that issuer with login. The verifier (`sub`, `aud`, HS256) stays.

```bash
python3 -m pip install -r requirements-dev.txt
python3 -m pytest
```
