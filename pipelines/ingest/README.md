# Ingest pipeline

Placeholder for Day 6.

The verified scripts already live in `docs/code-samples/`:

- `cc_fetch.py` — crawl
- `dt_clean.py` — clean and dedupe
- `embedding_spec.py` — EmbeddingGemma 2 prefixes and 256-d truncation
- `build_pack.py` — pack SQLite, manifest, Ed25519 signature
- `publish_r2.py` — upload

Do not run a crawl from this folder yet. When Day 6 starts, these scripts move here and the desktop pack id `surf-pack/1` becomes the one they write (`harbor-pack/1` is still accepted).
