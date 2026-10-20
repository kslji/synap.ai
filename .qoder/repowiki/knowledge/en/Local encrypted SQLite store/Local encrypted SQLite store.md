---
kind: external_dependency
name: Local encrypted SQLite store
slug: sqlite-sqlcipher-sqlite-vec
category: external_dependency
category_hints:
    - framework_behavior
scope:
    - '**'
source_files:
    - apps/desktop/package.json
---

### SQLite (SQLCipher + sqlite-vec + FTS5)
- Role: offline-first persistence for chats, documents, packs, and settings; full-text search via FTS5, vector similarity via sqlite-vec.
- Integration: `better-sqlite3-multiple-ciphers` provides the encrypted database; `sqlite-vec` adds vector ops; schema is initialized by the app at first run.
- Stable shape: data stays on disk, encrypted at rest; the server never sees prompt text.