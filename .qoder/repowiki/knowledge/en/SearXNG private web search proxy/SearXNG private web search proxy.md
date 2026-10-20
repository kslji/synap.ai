---
kind: external_dependency
name: SearXNG private web search proxy
slug: searxng
category: external_dependency
category_hints:
    - vendor_identity
scope:
    - '**'
source_files:
    - deploy/docker-compose.yml
    - deploy/searxng/settings.yml
    - services/api/app/main.py
---

### SearXNG
- Role: self-hosted metasearch engine behind the Surf API; the desktop app sends queries to `/v1/search` which proxies them to SearXNG in JSON mode.
- Integration: deployed via `deploy/docker-compose.yml`; settings live in `deploy/searxng/settings.yml`; the API reads `SEARXNG_URL` and forwards `q`, `language`, `safesearch`, `time_range`, plus niche/domain filters.
- Stable shape: query text is not stored; results are cached in Valkey for `SEARCH_CACHE_TTL`; public SearXNG instances may log queries, so production uses the containerized instance.