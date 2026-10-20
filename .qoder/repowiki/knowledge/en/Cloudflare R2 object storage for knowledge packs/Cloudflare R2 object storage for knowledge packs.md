---
kind: external_dependency
name: Cloudflare R2 object storage for knowledge packs
slug: cloudflare-r2
category: external_dependency
category_hints:
    - vendor_identity
    - client_constraint
scope:
    - '**'
source_files:
    - deploy/.env.example
    - docs/code-samples/publish_r2.py
---

### Cloudflare R2
- Role: S3-compatible bucket hosting signed knowledge-pack bundles; the API serves presigned download URLs.
- Integration: enabled when `PACK_BACKEND=s3` and `R2_BUCKET`/`R2_ENDPOINT`/`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY` are set; fallback is local filesystem (`PACK_ROOT`).
- Stable shape: uses the S3 API surface documented by Cloudflare; chosen for zero egress fees. Verify exact SDK calls against the official docs.