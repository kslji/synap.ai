---
kind: external_dependency
name: Caddy reverse proxy / TLS terminator
slug: caddy
category: external_dependency
category_hints:
    - vendor_identity
scope:
    - '**'
source_files:
    - deploy/docker-compose.yml
    - deploy/Caddyfile
---

### Caddy
- Role: front-facing HTTPS reverse proxy exposing ports 80/443 and routing traffic to the Surf API.
- Integration: pinned digest `caddy:2@sha256:...`; config mounted from `deploy/Caddyfile`.
- Stable shape: single VM deployment; the API itself listens only on localhost (port 8000) and is never directly exposed.