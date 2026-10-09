# Surf AI API

FastAPI service from the verified backend slice: health, model registry, pack manifest, and a SearXNG search proxy that does not store query text.

Run it with the compose file at the repo root:

```bash
cd deploy
cp .env.example .env
docker compose up -d --build
curl -s localhost/v1/health
```

This is Day 4–5 work. The desktop app does not call it yet. Search from the app is a stub until that day: if local sources are weak and web search is allowed, Surf says it does not have enough information and that web search is not connected.

Postgres defaults in `.env.example` use the database name `surf`. The original verification run used the placeholder name `harbor`; the schema file is unchanged.
