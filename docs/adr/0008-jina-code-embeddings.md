# ADR 0008 — Jina code embeddings and a cross-encoder reranker

Supersedes the embedding half of the search design (see [ARCHITECTURE-FULL](../ARCHITECTURE-FULL.md); [ADR 0004](0004-single-chat-model.md) left the search models in place). The chat side is unchanged: [ADR 0007](0007-qwen35-2b-default.md).

## Context

Code search is a second `llama-server` beside the chat model: it turns chunks into vectors, the app
stores 256 numbers per chunk, and a query is answered by fusing FTS5 keywords with sqlite-vec
distances (RRF). Two problems came out of using the previous search model, a general text embedder:

- It was trained on prose, in many languages. Code is not prose: `fetchUser`, `parseQuery`, `MAX_BYTES`
  and `src/code-agent/split.ts` are the tokens people search for, and a prose model splits them into
  dictionary words. The FTS half of the hybrid covered some of that, the vector half did not.
- It shipped 270M parameters of text encoder (310 MB at Q8_0) to answer questions about code, and the
  language coverage it was chosen for is not what an offline code project needs.

The ordering was also left to RRF plus hand-written boosts. RRF is good at merging two lists and bad
at deciding which of two plausible files actually answers the question.

## Decision

Two small Apache-2.0 GGUFs from Jina, both quantised Q5_K_M, both bundled with every offline chat
download:

| | Embedding | Reranker |
| --- | --- | --- |
| id | `jina-embeddings-v2-base-code-q5_k_m` | `jina-reranker-v1-turbo-en-q5_k_m` |
| model | `jinaai/jina-embeddings-v2-base-code` | `jinaai/jina-reranker-v1-turbo-en` |
| role | `embedding` | `reranker` |
| file | `jina-embeddings-v2-base-code-Q5_K_M.gguf` | `jina-reranker-v1-turbo-en-Q5_K_M.gguf` |
| size | 121,387,072 B (115.8 MiB) | 37,323,936 B (35.6 MiB) |
| sha256 | `4fb1c5f15462f12a083e19721c7a43e9eddfe6377dc845fa73bedf2461089919` | `c633a5398bd191dec8097262ca1713a70eae62c085295d5422fc0445c3cf1c5a` |

- `role: 'reranker'` is a new value in the role enum (`model-registry.ts`, `ipc-contract.ts`). The
  registry is the only place a search file is named; both copies list the same two rows.
- Embedding spec (`JINA_CODE_256` in `core/embedding.ts`), recorded with every pack:
  - `id: jina-embeddings-v2-base-code@256`, `model: jinaai/jina-embeddings-v2-base-code`
  - `nativeDim: 768`, `dim: 256`, Matryoshka truncation followed by L2 re-normalisation
  - `pooling: 'mean'`, `normalize: true`, `maxTokens: 2048`, one batch of 32
  - `queryPrefix: ''` — the model is symmetric, so a query is not prefixed
  - `docTemplate: '{title}\n{text}'`, with the title line dropped when there is no title
  - `specKey()` covers `id`, `dim`, `pooling`, `queryPrefix` and `docTemplate`: a pack built with any
    other embedding is refused rather than read as if the vectors were comparable.
- The reranker runs on its own `llama-server`:
  `--reranking --pooling rank -c 2048 -ub 2048 -b 2048`, one `/v1/rerank` call per query, and its
  `relevance_score` is added to the fused score of each hit. `rerankWithModel` (`core/code/search.ts`)
  falls back to the RRF + symbol/filename/export order when the sidecar is not running, when the
  request fails, or when the score list is short: search never fails because the reranker did.

## Bundling and deletion

- Downloading Offline mode, or any Offline chat model in Settings → Models, adds the embedding and the
  reranker to the same job whenever either file is missing on disk (`missingBundleFiles`). A person
  who downloads one model gets working code search, not a second trip to the download screen.
- Free space is checked once for the whole bundle — chat + embedding + reranker + 10 % — not per file
  (`bundling`), so the check cannot pass three times and then fail on the fourth file.
- Nothing here is deleted while an Offline chat model is installed: the delete guard in
  `app-services.ts` covers the embedding and the reranker, because a chat model without them has no
  search. Remove the chat models first, then the search files follow.
- The retired search GGUF (the previous 310 MB file) is deleted on startup or migration if it is
  still in the models directory (`legacySearchFiles`). Its name is assembled from parts in
  `model-bundle.ts` so it survives in exactly one place, and `grep -rn embeddinggemma apps/ services/
  scripts/` returns nothing.

## Cost and alternatives

- +151 MiB per offline install (158.7 MB decimal), on top of the 1.19 GiB chat file. The 2B offline
  zip carries the chat file plus both search files and still fits one release asset (< 2 GiB).
- RSS: the two search models together are far smaller than the text model they replace, and the
  reranker is a separate `llama-server` that starts on the first query and is stopped when the
  sidecars are stopped or the model changes.
- Kept as alternatives: a multilingual text embedder (better for prose packs, worse for code), a
  0.6B embedding model (3x the disk and the RAM for a few points of recall), and no reranker at all
  (cheaper, but the 256-d order puts exact identifier matches below plausible neighbours).
- Not chosen: generating embeddings with the chat model. The 2B is the only model that must always be
  loaded, and a second model that answers questions is worth more than one that does both badly.

## What this measures

- `rag.test.ts` and `pack.test.ts` lock the spec (`JINA_CODE_256`), the 768 → 256 truncation and the
  pack compatibility key (`specKey`).
- `model-bundle.test.ts` covers the bundle (chat + missing search files), the combined free-space
  check, and the startup delete of the retired file.
- `code-search.test.ts` covers the rerank fallback: no reranker, an HTTP error, and a short score
  list all keep the RRF order.
- The retrieval numbers themselves (recall at 256-d, rerank lift) are measured by the code-pack eval,
  not here; this ADR records the choice and the sizes, and the registry records the hashes.
