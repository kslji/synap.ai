---
kind: external_dependency
name: PostgreSQL + pgvector
slug: postgresql-pgvector
category: external_dependency
category_hints:
    - vendor_identity
scope:
    - '**'
source_files:
    - deploy/docker-compose.yml
    - deploy/initdb/01_schema.sql
    - services/api/app/main.py
---

### PostgreSQL 17 with pgvector extension
- Role: persistent store for auth users/devices, licence records, and search audit logs in the non-lite deployment.
- Integration: `pgvector/pgvector:pg17` image in Docker Compose; schema seeded from `deploy/initdb/01_schema.sql`; async connections via `psycopg_pool`.
- Stable shape: healthcheck verifies the `vector` extension is loaded; lite mode bypasses Postgres entirely.