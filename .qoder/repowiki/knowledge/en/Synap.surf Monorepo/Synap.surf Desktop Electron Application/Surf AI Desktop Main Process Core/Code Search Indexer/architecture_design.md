The module is organized as a pipeline of focused files around a single SQLite-backed index:

- `schema.ts` declares the per-project schema (`files`, `symbols`, `edges`, `chunks`, `meta`) plus FTS5 virtual table `chunks_fts` and sqlite-vec table `chunk_vec` (256-d Float32 vectors).
- `store.ts` opens the encrypted or plain DB via `better-sqlite3-multiple-ciphers`, loads the vec extension, runs migrations, and exposes all persistence operations: `writeFileIndex`, `definitions`, `referencesTo`, `relatedFiles`, `linkEdges`, `pendingChunks`, `markEmbedded`, etc.
- `scan.ts` walks the project tree respecting `.gitignore` (via the `ignore` crate), binary/secret/size filters from `limits.ts`, and language classification from `languages.ts`.
- `parse.ts` uses `web-tree-sitter` to extract symbols, call/reference/import edges per grammar spec; unknown languages fall back to `parsePlain` which splits on blank lines.
- `chunks.ts` slices parsed symbols into search-sized chunks with configurable word limits and overlap.
- `embed.ts` provides the `CodeEmbedder` interface with two implementations: `hashEmbedder` (deterministic bag-of-tokens for tests) and `gemmaEmbedder` (adapter over the app's EmbeddingGemma client producing 256-d L2-normalized vectors).
- `search.ts` fuses BM25 keyword results and vector cosine similarity via reciprocal rank fusion (`rrfScore` from `../retrieval.js`), then applies name-based boosting and sorts final hits.
- `context.ts` is the consumer-facing API that builds a token-budgeted context pack by combining symbol definitions, search hits, and related-file snippets.
- `watch.ts` wraps `node:fs.watch` with debounce/coalescing to batch change notifications.
- Dependency direction is one-way: scan → parse → chunks → store → search → context; embed is injected into search at query time. The module depends outward on `../db.js`, `../embedding.js`, and `../retrieval.js` but has no callers inside this scope.