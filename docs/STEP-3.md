# Step 3 — web search, and a hard offline switch

Day 4 of the plan. The desktop still answers from local documents first. When those are weak, and the computer is online with web search allowed, it asks a self-hosted search service. The model and the embeddings stay on the device.

## What is wired

- `POST /v1/search` proxies SearXNG JSON. `POST /v1/fetch` downloads a public HTML page, cleans it with trafilatura, and returns short text slices.
- SSRF checks block private, loopback, link-local, and metadata addresses, including redirects to them. HTML or plain text only, with a size cap and a timeout. `robots.txt` is honored when the site returns one.
- Per-device rate limits (10 per minute, 100 per day by default) and a short response cache. The cache key is a hash. Query text is not stored. `search_requests.query_text` stays null.
- `POST /v1/devices/register` issues a temporary HS256 device JWT (`typ: device`, 30 days). It is not a row in `devices`, because that table needs a user. Step 5 replaces the issuer. The desktop already sends `Authorization: Bearer`, so the swap does not change the call.
- The desktop decides: local documents, then a relevance gate. A strong hit answers from those documents. A fresh question (words such as latest, today, 2026, price) can add the web even when local hits are decent, and the answer blends both. A weak hit with web allowed searches. A weak hit while offline, or with web turned off, replies with exactly: `I don't have enough information to answer that from the sources on this computer.` plus a hint.
- Offline only is enforced in the main process before registration, search, fetch, and the health probe. The renderer toggle is not the only check.
- Search queries are written by the local chat model (1–3 short strings). Page text is chunked and embedded on the device with EmbeddingGemma 2, then reranked. User documents are never uploaded.
- The chat shows an online/offline pill with a reason, a per-chat web switch, a seahorse-with-telescope state while searching, and web source cards (title, domain, date) that open in the system browser.

## Run the API locally

From the repo root, with Python 3.12:

```bash
python3 -m pip install -r services/api/requirements.txt
cd services/api
SURF_API_LITE=1 \
SEARXNG_URL=http://127.0.0.1:8080/search \
JWT_SECRET=dev-only-secret-change-me-at-least-32-bytes \
JWT_AUDIENCE=authenticated \
python3 -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

`SURF_API_LITE=1` skips Postgres and uses an in-memory rate limit. That is for tests and a single laptop. The compose file is the production shape.

SearXNG has to be running at `SEARXNG_URL` or health reports it down. The full stack:

```bash
cd deploy
cp .env.example .env
docker compose up -d --build
curl -s localhost/v1/health
```

Point the desktop at `http://127.0.0.1:8000` in Settings → Search service. Turn on Allow web search. Offline only must be off.

Tests:

```bash
cd services/api && python3 -m pytest
cd apps/desktop && npm run test:unit
```

## Deploy on a GCP VM inside the trial credit

One VM. Do not add Cloud SQL, Memorystore, or a load balancer.

1. Create an `e2-small` (2 GB) in a nearby region. The compose stack (API, SearXNG, Postgres, Valkey, Caddy) sits around a few hundred megabytes, so the small machine is enough for the search service alone. Use `e2-medium` if you also want room to build images on the box. Stop the VM when you are not using it. A new account's $300 credit covers a single small VM for a trial; this guide does not pin a monthly dollar figure because the price list moves.
2. Install Docker and the compose plugin. Clone the repo and copy `deploy/.env.example` to `deploy/.env`. Replace `JWT_SECRET`, `POSTGRES_PASSWORD`, and `SEARXNG_SECRET`. Leave `FETCH_ALLOW_HOSTS` empty.
3. Point a DNS name at the VM. In `deploy/Caddyfile`, replace `:80` with that name so Caddy fetches a certificate. Open the firewall to TCP 80 and 443 only. Use IAP for SSH. Do not publish Postgres, Valkey, or SearXNG.
4. `docker compose up -d --build` from `deploy/`. `curl -fsS https://your-domain/v1/health` should report postgres, valkey, and searxng.
5. In the desktop app, set Search service to `https://your-domain`.

An nginx TLS reverse proxy can sit in front of port 8000 the same way. The compose file ships Caddy.

## Environment

| Variable | Role |
|---|---|
| `DATABASE_URL` | Postgres. Omit it, or set `SURF_API_LITE=1`, for the in-memory mode |
| `VALKEY_URL` | Rate-limit and cache store. Memory stand-in when lite |
| `SEARXNG_URL` | SearXNG `/search` endpoint |
| `JWT_SECRET` / `JWT_AUDIENCE` | Temporary device tokens. Audience stays `authenticated` so Step 5 can reuse the verifier |
| `SEARCH_PER_MIN` / `SEARCH_PER_DAY` | Defaults 10 and 100 |
| `SEARCH_CACHE_TTL` | Seconds. Default 600 |
| `FETCH_ALLOW_HOSTS` | Empty in production. A host name here skips the private-address check, for the local fixture only |
| `SURF_API_BASE` | Desktop override of the settings URL, used by the self-test |

## Privacy

Query text is not written to Postgres, Valkey, or the process audit list. The cache stores result JSON under a hash of the normalized query. Fetched page text is returned to the device and not saved on the server. The desktop keeps passages in memory for that answer only. There is no web-page table yet.

The device token is a signed random id. It is not an account.

## Deferred

- Real login and a `devices` row (Step 5). The register route is the stand-in.
- A 7-day on-disk cache of fetched pages.
- Knowledge-pack search. The pack list is still empty until signatures land.
- macOS and Windows installer runs. CI builds the desktop bundle on Linux.
