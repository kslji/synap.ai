---
kind: external_dependency
name: Valkey cache & rate limiter
slug: valkey
category: external_dependency
category_hints:
    - vendor_identity
scope:
    - '**'
source_files:
    - deploy/docker-compose.yml
    - deploy/.env.example
    - services/api/app/main.py
---

### Valkey (Redis-compatible KV store)
- Role: shared search-result cache (TTL keyed by normalised query params) and per-device rate limiter for `/v1/search`.
- Integration: `valkey/valkey:8` container; connection URL via `VALKEY_URL`; falls back to in-process memory dict when unconfigured.
- Stable shape: LRU eviction (`allkeys-lru`) with 64 MB cap; used only for ephemeral search cache, not user data.