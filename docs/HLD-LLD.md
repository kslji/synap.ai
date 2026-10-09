<style>h2 { page-break-before: auto !important; margin-top: 14pt; } h1 { margin-top: 6pt; }
@page wide { size: A4 landscape; } .wide { page: wide; text-align: center; } .wide img { max-width: 100%; max-height: 148mm; } .cheat { font-size: 8.3pt; line-height: 1.32; } .cheat table { font-size: 7.6pt; } .cheat h1 { font-size: 17pt; } .cheat ul { margin: 2pt 0; } .wide p.cap { font-size: 9pt; color: #555; margin: 2pt 0 0; }</style>

# Surf AI: High-Level and Low-Level Design
## Interview edition · Electron + Qwen3.5 + EmbeddingGemma 2 · v0.3, 9 October 2026

*Companion to `ARCHITECTURE-SHORT.pdf` (decisions in plain language) and `IMPLEMENTATION.md` (commands). Diagrams are Excalidraw files you can open and edit at <https://excalidraw.com>: `hld.excalidraw`, `lld-modules.excalidraw`, `lld-sequence-chat.excalidraw`.*

---

# Part A — High-level design (HLD)

## A1. Problem statement

Professionals in low-connectivity jobs (first niche: **marine engineers** at sea) need a ChatGPT-like assistant that

1. **works with no internet**, on the laptop they already have (8–16 GB RAM, often no GPU);
2. **keeps their documents private** (manuals, reports, photos never leave the machine);
3. **answers from trusted, current sources** and says "I don't know" instead of guessing;
4. **gets fresher when a connection appears** (new knowledge packs, optional web search).

Cloud chatbots fail (1) and (2). A plain local model fails (3) and (4). Surf AI = local model + local retrieval over signed, versioned **knowledge packs** + an optional thin cloud.

## A2. Requirements

**Functional**

| # | Requirement | MVP? |
|---|---|---|
| F1 | Chat with streaming answers and source citations, fully offline | ✅ |
| F2 | Attach files (PDF, DOCX, HTML, MD, images) and ask about them | ✅ |
| F3 | Refuse when the sources do not support an answer (relevance gate) | ✅ |
| F4 | Tools: calculator and unit conversion (no mental maths by the model) | ✅ |
| F5 | Niche agents (General, Marine Engineer) = prompt + packs + tools + gates | ✅ (General), week 2–3 (Marine) |
| F6 | Knowledge packs: download online or import from USB; verify; atomic update | ✅ |
| F7 | Optional web search when online (privacy-preserving) | ✅ |
| F8 | Login once online; keep working offline for 30 days (signed device licence) | ✅ |
| F9 | App auto-update online; offline update from a signed file | ✅ |
| F10 | Voice input, video, image search | later |

**Non-functional**

| Area | Target |
|---|---|
| Offline-first | Every F1–F6 path works in airplane mode; network calls are optional and time-boxed (8 s) |
| Privacy | Chats, files and embeddings stay on the device in an encrypted DB; web search queries are not stored server-side (`query_text` NULL) |
| Latency (8 GB laptop, CPU, Qwen3.5-4B) | Retrieval < 150 ms; first token < 3 s; ≥ 8–10 tokens/s; refusal < 300 ms (no LLM call) |
| Latency (16 GB, Qwen3.5-9B / Apple Silicon) | first token < 2 s; ≥ 15 tokens/s **[measure on Day 1]** |
| Memory | 8 GB tier: app + chat + embeddings ≤ ~5 GB (4B Q4_K_M ≈ 3.5 GB, EmbeddingGemma 2 ≈ 0.6 GB RSS, Electron ≈ 0.3–0.6 GB) |
| Disk | ~4–8 GB per install (model 1.3–5.7 GB + packs 0.25–1.2 GB) |
| Scale assumption | **10,000 registered users**, 30 % daily active, 15 questions/user/day |
| Availability | Desktop: 100 % (local). Cloud: 99 % is enough (single VM) — outages only delay updates / web search |
| Security | Signed packs/agents/models registry (Ed25519), sandboxed renderer, sidecars on 127.0.0.1 with random key, DB key in OS keychain |
| Cost | Fits a $300 GCP trial + free tiers for the first months |

## A3. Capacity estimates (10k users)

| Quantity | Estimate | How |
|---|---|---|
| Daily questions | 3,000 DAU × 15 = **45,000/day** | answered **on laptops** → zero server cost |
| Web-search requests | ~10 % of questions → 4,500/day → **0.05 QPS avg, ~1 QPS peak** (evening IST ×10, bursty) | API + SearXNG on e2-medium handle this easily; limit 10/min, 100/day per user |
| Pack manifest checks | 10k devices × 4/day = 40k/day ≈ **0.5 QPS** | `ETag`/`304`, cacheable at Caddy/CDN |
| Pack downloads | first install 0.25–1.2 GB; weekly delta ~20–80 MB × 4 × 10k ≈ **1–3 TB/month** | from **R2: egress free**; Class B ops ≈ 1 M/month (free tier 10 M) |
| Model downloads | 10k × 2.7–5.7 GB ≈ **30–50 TB once** | from Hugging Face (free CDN), R2 mirror as fallback |
| Installer downloads | 10k × ~250–450 MB (+ updates) | GitHub Releases (free for public repos) |
| Server storage | corpus 1 M chunks ≈ 3 GB in Postgres (256-d vectors = 1 KB each + text + HNSW); users/devices < 50 MB | 50–80 GB VM disk |
| Object storage | 5 packs × ~1 GB × 4 kept versions ≈ 20 GB + deltas | R2 ≈ $0.15–0.30/month |
| Laptop storage per user | user.db grows ~10 MB per 10k chunks of own docs (1 KB vector + text) | no server impact |

**Insight to say out loud:** inference is the expensive part of an AI product, and we pushed it to the edge. The server only serves metadata, search and static files, so 10k users cost about the same as 100.

<div class="wide"><h2 style="text-align:left;margin-top:0">A4. Components and data flows</h2><img src="hld.png" alt="High-level design"/><p class="cap">Figure: High-level design — editable source <code>hld.excalidraw</code></p></div>

| Component | Responsibility | Tech |
|---|---|---|
| Renderer | UI only; no Node, no network except our own IPC | React 19 + Vite, sandbox, CSP |
| Preload | Typed `window.surf` API; validates nothing, exposes little | `contextBridge` |
| Main process | Orchestration, retrieval, gate, budget, tools, packs, models, auth, jobs, DB | TypeScript on Electron 44 (Node 24) |
| Sidecars | Chat LLM, embeddings, document conversion | llama.cpp `llama-server` ×2, Python doc-worker |
| Local storage | `user.db` (encrypted), `packs/*.sqlite` (read-only, signed), `models/` | better-sqlite3-multiple-ciphers (SQLCipher v4) + sqlite-vec + FTS5 |
| API | Auth exchange, device licences, pack/model manifests, web-search proxy | FastAPI on one GCP e2-medium VM |
| Search | Meta-search, private instance | SearXNG behind the API |
| Data | Users, devices, corpus, pack versions, evals | Postgres 17 + pgvector |
| Pipeline | Crawl → clean → dedup → chunk + embed → build pack → eval → sign → publish | Python 3.12, datatrove, trafilatura |
| Distribution | Packs (R2), models (Hugging Face), installers/updates (GitHub Releases), USB bundle | static, cacheable |

**Main flows:** (1) *Ask* — entirely local (see LLD B3). (2) *Refresh* — every 6 h when online: `GET /v1/packs/manifest` → download delta from R2 → verify → atomic swap. (3) *Web fallback* — only when the gate says "insufficient", the user/agent allows web, and we are online. (4) *Publish* — pipeline writes Postgres, builds a pack, runs the golden-set eval, signs, uploads to R2, flips `status = published`.

## A5. Key design decisions and trade-offs

| Decision | Chosen | Alternative | Why / trade-off |
|---|---|---|---|
| Desktop shell | **Electron** (all TypeScript) | Tauri v2 (Rust) | Founder knows TS, 7-day deadline, one language across UI/main/tests, mature updater/builder. Cost: +~100 MB installer and ~150–300 MB RAM — small next to a 3 GB model. Tauri remains a later option (the core is plain TS modules + sidecars). |
| Inference | **Local** (llama.cpp sidecar, Qwen3.5 2B/4B/9B Q4_K_M by RAM tier) | Cloud LLM API | Offline + privacy + zero marginal cost. Cost: weaker model → we compensate with retrieval, a refusal gate, tools and citations. Sidecar process (not in-process binding) = crash isolation, easy upgrade, GPU backends for free. |
| Knowledge | **RAG over signed packs** | Fine-tuning per niche | Facts change monthly; packs update in minutes and cite sources; fine-tunes hallucinate confidently and need re-training. LoRA later only for *style/format*, never for facts. |
| Embeddings | **EmbeddingGemma 2 text 270M, Q8_0, 256-d (Matryoshka)** | bge-small (English), Qwen3-Embedding-0.6B | Multilingual (Hindi queries work), near-full quality at 256-d (MTEB-multi 60.4 vs 61.4 at 768-d), 3× smaller vectors. Cost: 310 MB file, ~0.6 GB RSS, needs llama.cpp ≥ b11452. |
| Local DB | **SQLite** (SQLCipher + sqlite-vec + FTS5) | LanceDB, Chroma, Postgres embedded | One file, ACID, encrypted, hybrid search in one engine, packs are just SQLite files we can attach read-only. sqlite-vec is brute-force KNN: fine to ~1 M vectors at 256-d; beyond that, shard packs or add IVF. |
| Server DB | **Postgres + pgvector** | Managed vector DB | One system for relational + vectors; HNSW for eval/dedup; cheap. |
| Web search | **Self-hosted SearXNG** | Brave/Bing/Tavily APIs | Free and private; we control logging. Cost: upstream engines may rate-limit or block → add a paid API as fallback behind the same `/v1/search` contract when volume grows. |
| Pack sync | **Pull, versioned full + byte-exact zstd delta, Ed25519-signed manifest, atomic swap** | Row-level sync / CRDT | Packs are read-only publisher data → no conflicts → simple. Same verifier for USB. Keep previous version for instant rollback. |
| Auth | **Supabase Auth (PKCE via system browser) + our signed device licence** | Own auth | Free tier, email OTP + Google; the licence makes offline use independent of the auth provider. |
| Hosting | **One GCP VM + Docker Compose** | Kubernetes / serverless | Fits the trial credit, one place to debug; containers make moving to Cloud Run/Hetzner trivial. |

## A6. Scalability, availability, security

**Scalability.** The heavy work (LLM, embeddings, search over packs, files) scales with *users' laptops*. The server path is: stateless FastAPI (scale horizontally behind Caddy/LB) → Postgres (small, read-mostly) → SearXNG (stateless, scale out). Static files are on R2/HF/GitHub CDNs.

**Availability.** Desktop features never depend on the server. Server single points of failure (VM, Postgres) only delay updates/web search: nightly encrypted `pg_dump` to R2, uptime check on `/v1/health`, rebuild from Compose in < 30 min. Packs and models stay downloadable even if the VM is down (they are on R2/HF).

**Security (defence in depth).**

| Threat | Control |
|---|---|
| Malicious page/content in the renderer | `sandbox`, `contextIsolation`, no `nodeIntegration`, strict CSP, navigation/new windows blocked, IPC sender check + zod |
| Tampered pack/agent/model list | Ed25519 signature over manifest; per-file SHA-256 + size; pinned public keys with key ids for rotation |
| Other local processes calling the LLM | sidecars bind 127.0.0.1, random port, random API key per launch |
| Stolen laptop | `user.db` encrypted (SQLCipher v4, 256-bit key) with the key in Keychain/DPAPI via `safeStorage` |
| Prompt injection from documents/web | sources are quoted as data, tools are whitelisted per agent, calculator has no `import/evaluate`, web results labelled `[web]` |
| Abuse of the search API | JWT, per-user minute/day limits in Valkey, per-IP limits at Caddy, no query text stored |
| Supply chain | lockfile + pinned image digests + pinned llama.cpp tag + SHA-256 for every model |

## A7. Bottlenecks and future scaling

| Bottleneck (in order of arrival) | Symptom | Next step |
|---|---|---|
| SearXNG upstream blocking | 429/empty results at ~1–5 QPS | rotate engines; add a paid search API behind the same endpoint; cache popular queries for 1 h |
| Single VM | CPU > 70 % or deploy downtime | 2+ API instances behind a GCP load balancer (or Cloud Run); SearXNG as its own service |
| Postgres | pipeline + API contention | move to Cloud SQL; **read replica** for manifests/admin; pipeline writes to primary |
| Pack downloads | many users on the same day | already CDN-like (R2); add Cloudflare cache rules + more delta versions |
| Ingestion throughput | monthly rebuild > 1 day | **ingestion queue** (Pub/Sub or Postgres `SKIP LOCKED`) + spot/preemptible workers with GPUs for embedding |
| Local vector search | packs > ~1 M chunks | split packs by topic; int8 vectors for first pass + float rescoring; IVF when sqlite-vec ships it |
| Laptop RAM | 8 GB machines swapping | stop the embedding sidecar when idle; tier-down suggestion based on measured tokens/s |

<div class="wide"><h1 style="text-align:left;margin-top:0">Part B — Low-level design (LLD)</h1><h2 style="text-align:left;margin-top:4pt;border:none">B1. Desktop main process: modules</h2><img src="lld-modules.png" alt="Main-process modules"/><p class="cap">Figure: Main-process modules — editable source <code>lld-modules.excalidraw</code></p></div>

| Module | Owns | Key collaborators |
|---|---|---|
| `Orchestrator` | The chat use case: load agent, retrieve, gate, budget, call model, run tools, stream, persist | all services below |
| `RetrievalService` | Hybrid search across `user.db` + attached packs (FTS5 bm25 + vec0 KNN → RRF) | `Embedder`, `ChunkRepo`, `PackManager.attached()` |
| `RelevanceGate` | Pure function `(query, hits) → answer | borderline | insufficient` | — |
| `TokenBudgeter` | Fits system + tools + chunks + history + question into the tier's budget | `LlamaServerTokenizer` / `HfTokenizer` |
| `ToolRunner` | Tool schemas per agent; executes calls with limits; logs `tool_runs` | `Calculator` (worker), pack-SQL views |
| `SidecarManager` / `LlamaServer` | Process lifecycle, health, restart with backoff | `ModelManager` (paths), `HardwareProbe` (threads, tier) |
| `ModelManager` | Registry, tier pick, resumable download + SHA-256 | downloader |
| `PackManager` | Check, download, verify, install, swap, rollback, attach read-only | verifier, downloader, `PackRepo` |
| `AttachmentQueue` | Durable job queue for file ingestion in a `utilityProcess` | doc-worker, `Embedder`, `JobRepo`, `ChunkRepo` |
| `AuthClient` + `SyncService` | PKCE login, refresh, offline licence, 6-hourly sync | API |
| Repositories | All SQL; one class per aggregate | `user.db` connection |

## B2. Key TypeScript interfaces (from the code samples)

```ts
// ipc-contract.ts — renderer <-> main (validated with zod in main)
export interface ChatSendReq { conversationId: string | null; text: string; agentId?: string;
  images?: { mime: 'image/png' | 'image/jpeg'; base64: string }[]; allowWeb?: boolean }
export type ChatEvent =
  | { type: 'token'; messageId: string; text: string }
  | { type: 'sources'; messageId: string; sources: { title: string; url: string; pack: string }[] }
  | { type: 'tool'; messageId: string; name: string; input: string; output: string }
  | { type: 'done'; messageId: string; gate: 'answer' | 'borderline' | 'insufficient' | 'web' }
  | { type: 'error'; messageId: string; message: string };

// retrieval.ts
export interface Hit { pack: string; chunkId: number; text: string; title: string; url: string;
  cosine: number; bm25Rank: number | null; vecRank: number | null; rrf: number }
export type GateDecision = 'answer' | 'borderline' | 'insufficient';
export function gate(query: string, hits: Hit[], tauCos = 0.7, tauCov = 0.5): GateDecision;

// embedding.ts — one spec shared by desktop, pipeline and pack manifests
export interface EmbeddingSpec { id: 'embeddinggemma-2-text@256'; model: string; gguf: string; nativeDim: 768; dim: 256;
  pooling: 'mean'; normalize: true; queryPrefix: 'task: search result | query: '; docTemplate: 'title: {title} | text: {text}'; maxTokens: number }

// token-budget.ts
export interface TokenCounter { count(text: string): Promise<number>; name: string }
export interface BudgetProfile { total: number; systemAndTools: number; retrieved: number; history: number;
  question: number; answerMin: number; maxChunks: number; keepTurns: number; serverCtx: number }

// sidecar-manager.ts
export type SidecarState = 'stopped' | 'starting' | 'ready' | 'crashed';

// services (DI via constructor; easy to fake in tests)
interface PackManager { checkUpdates(): Promise<PackUpdate[]>; install(src: { url: string } | { file: string }): Promise<InstalledPack>;
  rollback(packId: string): Promise<void>; attached(): Record<string, Database> }
interface AttachmentQueue { enqueue(file: string, conversationId?: string): Promise<string /*jobId*/>;
  cancel(jobId: string): void; on(ev: 'progress', cb: (p: { jobId: string; stage: string; progress: number }) => void): void }
```

<div class="wide"><h2 style="text-align:left;margin-top:0">B3. Sequence: chat query (offline/online, relevance gate, tool call)</h2><img src="lld-sequence-chat.png" alt="Chat query sequence"/><p class="cap">Figure: Chat query sequence — editable source <code>lld-sequence-chat.excalidraw</code></p></div>

## B4. Other sequences (compact)

**Attachment ingestion (offline)**

| # | Step | Failure handling |
|---|---|---|
| 1 | UI → `AttachmentQueue.enqueue(file)`; SHA-256 → dedupe; copy into `attachments/ab/cd/<sha>` | duplicate → reuse existing doc |
| 2 | Insert `attachment_jobs(status=queued, priority)` | — |
| 3 | `utilityProcess` picks job (`idx_jobs_pick`), `status=running` | app quit → job back to `queued` on start |
| 4 | doc-worker converts to Markdown (PDF/DOCX/HTML; OCR for images/scans), writes `resume_cursor` per page | crash → retry ×3 with backoff, resume from cursor |
| 5 | Chunk 350/50 tokens; `Embedder.embedDocs` in batches of 32 | embedding sidecar down → restart, retry batch |
| 6 | One transaction: `chunks`, `chunks_fts`, `chunk_vectors` | rollback, job `failed` with error text |
| 7 | `status=done`, progress events → UI | — |

**Pack sync (online, every 6 h or on demand; same verifier for USB)**

| # | Step |
|---|---|
| 1 | `GET /v1/packs/manifest?installed=general-core@2026.10.01` with `If-None-Match` → `304` or new versions |
| 2 | Download `pack.sqlite.zst` or delta from R2 with HTTP `Range` resume → `packs(status=downloading, bytes_downloaded)` |
| 3 | Verify Ed25519 signature of manifest (pinned key id) → SHA-256 + size of file → embedding spec equals installed `EmbeddingSpec` → `min_app_version` |
| 4 | Decompress (`zstd --patch-from` for deltas) to a temp path; `PRAGMA integrity_check`; open read-only |
| 5 | Atomic swap: new → `active`, old → `previous` (unique partial index guarantees one active per pack) |
| 6 | Next successful launch deletes versions older than `previous` |

**Auth / device activation**

| # | Step |
|---|---|
| 1 | App creates PKCE verifier + S256 challenge; opens system browser to the login page (Supabase: email OTP or Google) |
| 2 | Login page `POST /v1/auth/desktop/authorize` (Supabase JWT + challenge) → one-time code → redirect `surf://auth?code=…` |
| 3 | App `POST /v1/auth/desktop/token {code, verifier, device: {uid, os, arch, tier, public_key}}` |
| 4 | API returns access JWT (15 min), refresh token (rotating), **device licence** (Ed25519-signed, 30 days, plan + entitlements) |
| 5 | Offline: app checks the licence signature + expiry locally; online: refresh rotates tokens and renews the licence when < 7 days left |
| 6 | No internet ever (ship crew): admin portal issues an offline activation file for the device code (week 2+) |

**Production ingestion (server)**

| # | Step | Store |
|---|---|---|
| 1 | Curate sources (trust, licence, redistribution) | `sources` |
| 2 | Fetch: Common Crawl CDX/WARC, RSS, sitemaps, permitted PDFs | `crawl_runs`, `raw_documents` |
| 3 | Clean: trafilatura extract, language, quality filters, MinHash dedup (datatrove) | — |
| 4 | Upsert versioned docs (`doc_uid`, `version`, `is_current`) | `documents` |
| 5 | Chunk 350/50, embed EmbeddingGemma 2 → 256-d | `chunks`, `chunk_embeddings` |
| 6 | Build `pack.sqlite` (FTS5 + vec0 + tool tables), zstd + delta | file |
| 7 | Eval golden set on tier-1 model; block on regression | `eval_runs`, `eval_results` |
| 8 | Sign manifest, upload to R2, `pack_versions.status = published` | `pack_versions`, `pack_files`, `pack_deltas` |

## B5. API contracts (v1, JSON)

```http
POST /v1/search                      Authorization: Bearer <JWT>
{"q": "SOLAS entry into force", "lang": "en", "time_range": null, "agent_id": "general"}
200 {"results": [{"title": "International Convention for the Safety of Life at Sea (SOLAS), 1974 - IMO",
                  "url": "https://www.imo.org/...", "snippet": "Adoption: 1 November 1974; Entry into force: 25 May 1980 ...",
                  "engine": "duckduckgo", "published": null}], "latency_ms": 2665}
401 {"error": {"code": "unauthenticated", "message": "missing bearer token"}}
429 {"error": {"code": "rate_limited", "message": "too many searches this minute"}}      Retry-After: 37
502 {"error": {"code": "search_unavailable", "message": "web search upstream failed"}}  Retry-After: 10
```

```http
GET /v1/packs/manifest?installed=general-core@2026.10.01&app=0.1.0&platform=darwin-arm64     If-None-Match: "<etag>"
200 {"packs": [{"pack_id": "general-core", "version": "2026.10.08", "size_bytes": 1073741824,
                "manifest": {"files": [{"name": "pack.sqlite", "sha256": "9581…", "url": "https://packs.…/pack.sqlite.zst"}],
                             "embedding": {"id": "embeddinggemma-2-text@256", "dim": 256, "...": "..."}, "min_app_version": "0.1.0"},
                "signature": "<base64 Ed25519>", "key_id": "packs-2026-1", "update_available": true,
                "delta": {"from": "2026.10.01", "url": "https://packs.…/general-core/2026.10.08/from-2026.10.01.zst", "sha256": "…"}}],
     "generated_at": "2026-10-09T06:36:28Z"}
304 (no body)
```

```http
POST /v1/auth/desktop/token
{"code": "c_8f2…", "code_verifier": "…", "device": {"uid": "…", "name": "Kabir-MBP", "os": "darwin", "arch": "arm64",
 "app_version": "0.1.0", "hw_tier": 2, "public_key": "<ed25519 hex>"}}
200 {"access_token": "<JWT, 15 min>", "refresh_token": "<opaque, rotating>", "device_id": "uuid",
     "license": {"payload": {"device_id": "uuid", "plan": "free", "entitlements": ["general"], "expires_at": "2026-11-08T00:00:00Z"},
                 "signature": "<base64>", "key_id": "lic-2026-1"}}
```

```http
GET /v1/health     200 {"status": "ok", "postgres": "ok (pgvector 0.8.7)", "valkey": "ok", "searxng": "ok"}   (503 + "degraded" otherwise)
```

*Verified live:* `/v1/health`, `/v1/search` (200/401/429) and `/v1/packs/manifest` (empty list; the `delta` object and `ETag`/`304` are specified but not yet implemented) run in the Compose stack (`implementation/backend`). The auth endpoints are specified, not yet implemented.

## B6. Database schema summary (with indexes)

| DB | Table | Key columns | Indexes / notes |
|---|---|---|---|
| user.db | `conversations` | id, agent_id, title, archived, updated_at | `(archived, updated_at DESC)`, `(agent_id, updated_at DESC)` |
| user.db | `messages` | id, conversation_id, role, content, citations JSON, token_usage | `(conversation_id, created_at)` |
| user.db | `tool_runs` | message_id, tool, input, output, ms | `(message_id)` |
| user.db | `attachments`, `attachment_jobs` | sha256, path / status, priority, stage, progress, resume_cursor, attempts | `idx_jobs_pick (status, priority, created_at)` |
| user.db | `documents`, `chunks` | doc status, source_type / text, ord | `(status, source_type)` |
| user.db | `chunks_fts` | FTS5 external-content on `chunks` | bm25 ranking |
| user.db | `chunk_vectors` | vec0 `embedding float[256]` cosine | brute-force KNN (sqlite-vec) |
| user.db | `packs` | (pack_id, version), status, sha256, signature, embedding_model, bytes_downloaded | **partial unique** `(pack_id) WHERE status='active'` |
| pack.sqlite | `docs`, `chunks`, `chunks_fts`, `chunk_vec`, `pack_meta`, tool tables | read-only | `(doc_id, ord)`; FTS5; vec0 float[256] |
| Postgres | `users`, `devices`, `device_licenses`, `auth_refresh_tokens` | | `devices(user_id) WHERE status='active'`, licences `(device_id, issued_at DESC)` |
| Postgres | `documents` (versioned), `chunks`, `chunk_embeddings vector(256)` | doc_uid, version, is_current | `(niche_id, status, fetched_at DESC)`, `(domain)`, GIN `(tags)`, **HNSW** `vector_cosine_ops` |
| Postgres | `packs`, `pack_versions`, `pack_files`, `pack_deltas`, `device_pack_installs` | | `(pack_id, published_at DESC) WHERE status='published'` |
| Postgres | `search_requests`, `search_quota_daily` | privacy_mode, query_text NULL, status | `(device_id, created_at DESC)`; CHECK privacy ⇒ no text |
| Postgres | `agents`, `agent_versions`, `tools`, `agent_tools`, `eval_*`, `training_examples` | | |

Full DDL: `code-samples/local_user_db.sql`, `pack_db.sql`, `production_postgres.sql` (validated on SQLite 3.53 / Postgres 17.11).

## B7. Error handling and retries

| Failure | Detection | Handling |
|---|---|---|
| llama-server crash / OOM | process `exit`, `/health` fails | state `crashed` → restart with backoff (0.5 s, 2 s, 8 s); after 3 failures suggest a smaller tier; current request retried once |
| Model slow on this laptop | measured tokens/s < 4 | suggest tier down; never silently switch |
| Context overflow | budgeter counts with the real tokenizer | drop lowest-ranked chunks, summarise old turns, truncate question last; never send > `serverCtx` |
| Tool error / timeout | worker reply `ok:false` or 2 s timeout | worker reset; tool message with the error to the model; max 3 tool rounds |
| Download interrupted | network error, size mismatch | HTTP `Range` resume from `bytes_downloaded`; SHA-256 mismatch → delete + retry ×3 → `failed` |
| Bad pack | signature/hash/spec mismatch, `integrity_check` fails | reject, keep active version, show reason; report via telemetry if opted in |
| Attachment job fails | worker exception | `attempts++`, exponential backoff, resume from cursor; after 3 → `failed` with message, user can retry |
| API errors | 401 / 429 / 5xx | 401 → refresh once then re-login prompt (offline features unaffected); 429 → honour `Retry-After`, answer locally; 5xx → circuit breaker 5 min |
| DB corruption / wrong key | open throws | refuse to start chat, offer restore from the user's encrypted export (`.surfbackup`) |

## B8. State machines

**Pack install** (`packs.status`)

| From | Event | To |
|---|---|---|
| — | update found / USB file chosen | `downloading` (USB: skip to `verifying`) |
| `downloading` | bytes complete | `verifying` |
| `downloading` | network error | `downloading` (resume later) |
| `verifying` | signature + SHA-256 + spec + integrity ok | `active` (old `active` → `previous`, same transaction) |
| `verifying` | any check fails | `failed` |
| `active` | user/auto rollback | `previous` (and `previous` → `active`) |
| `previous` | next good launch / newer install | `removed` |

**Attachment job** (`attachment_jobs.status`)

| From | Event | To |
|---|---|---|
| — | enqueue | `queued` |
| `queued` | worker picks (highest priority, oldest) | `running` |
| `running` | all stages done | `done` |
| `running` | error, attempts < 3 | `queued` (backoff, keep `resume_cursor`) |
| `running` | error, attempts = 3 | `failed` |
| `running` | battery saver / user pause / app quit | `paused` → `queued` on resume/launch |
| any non-final | user cancels | `cancelled` |

**Sidecar** (`SidecarState`): `stopped → starting → ready`, `ready → crashed → starting` (backoff), any → `stopped` on quit/idle.

## B9. Design patterns used

| Pattern | Where | Why |
|---|---|---|
| Facade | `Orchestrator` | One entry point for the chat use case; IPC stays thin |
| Strategy | `BudgetProfile` per tier, `TokenCounter` (server / HF / heuristic), tool schema selection per agent | Swap behaviour without `if` chains |
| Adapter | `LlamaClient` (OpenAI-style HTTP over llama-server), `Embedder` (adds prefixes + Matryoshka) | Replaceable inference backend |
| Repository | `ConversationRepo`, `ChunkRepo`, `PackRepo`, `JobRepo` | SQL in one place; easy tests with an in-memory DB |
| State machine | sidecars, pack install, attachment jobs | Explicit, persisted states survive crashes |
| Observer / pub-sub | `ChatEvent` stream, job progress, sidecar state events | Streaming UI updates over IPC |
| Process isolation (bulkhead) | sidecars, `utilityProcess` jobs, calculator `worker_threads` | A crash or runaway expression cannot take down the app |
| Specification / shared contract | `EmbeddingSpec` (TS + Python), zod schemas, signed manifests | Desktop and pipeline can never drift silently |
| Retry with exponential backoff + circuit breaker | downloads, sidecars, API | Flaky ship/satellite links |

<div style="page-break-before: always"></div>

<div class="cheat">

# Part C — How to present this in an interview (one page)

**2-minute pitch.** "Surf AI is a ChatGPT-style assistant for people who work offline — the first niche is marine engineers at sea. Everything that matters runs on the laptop: an Electron app with a TypeScript main process that drives two llama.cpp sidecars — Qwen3.5 for chat, sized by RAM (2B, 4B or 9B), and EmbeddingGemma 2 for multilingual embeddings at 256 dimensions. Knowledge comes from signed, versioned SQLite *knowledge packs* with FTS5 plus vector search, so answers cite sources, and a relevance gate refuses when the sources don't support an answer — without even calling the model. Users' own files are indexed locally into an encrypted SQLCipher database. When a connection appears, the app pulls pack deltas from R2, can use a private SearXNG web search through our FastAPI, and updates itself from GitHub Releases. The cloud is one small VM; inference cost is zero because it runs at the edge, so 10,000 users cost roughly what 100 do. The main trade-offs: Electron over Tauri for speed of delivery, RAG over fine-tuning for freshness and citations, SQLite everywhere for simplicity and encryption."

**Trade-offs to volunteer**
- Electron (+100 MB, more RAM) vs Tauri (Rust) → team velocity wins; core is portable.
- Small local model → weaker reasoning; mitigated by retrieval, gate, tools, citations, tiering.
- sqlite-vec brute force → simple and fast to ~1 M vectors; shard packs beyond.
- SearXNG → free/private but fragile upstream; contract allows a paid provider later.
- Single VM → cheap; the desktop doesn't depend on it.

**Likely questions (short answers)**

| Q | A |
|---|---|
| How do you stop hallucinations? | Gate before generation (cosine ≥ 0.70 + keyword coverage), grounded prompt with numbered sources, citations required, calculator for numbers, refusal text is not model-generated. Calibrated on a golden set (≤ 5 % wrong answers to unanswerable questions). |
| Why not fine-tune? | Facts change; RAG updates in minutes and cites. Fine-tuning later only for tone/format (LoRA). |
| How do updates work offline? | Same signed pack file via USB; Ed25519 + SHA-256 verify; atomic swap with rollback. |
| What if the embedding model changes? | `EmbeddingSpec` id is in every pack manifest; mismatched packs are refused; a model change means re-embedding packs and user docs (background job). |
| How do you fit 8 GB laptops? | 4B Q4_K_M (~3.5 GB), 4K-token request budget on an 8K server context, one slot, embeddings sidecar stopped when idle, tier-down when slow. |
| How is user data protected? | Encrypted DB, key in OS keychain, nothing uploaded; telemetry opt-in and content-free; search queries not logged server-side. |
| How does it scale to 100k users? | Server is metadata + search + static files: horizontal API, Postgres read replica, CDN for packs, search provider with SLA, ingestion queue with GPU workers. |
| Biggest risk? | Packaging native modules + unsigned builds on Mac/Windows → Day 1 spikes; verified on Linux already (packaged AppImage self-test passes). |
| How do you test it? | Unit + integration runner (8/8: DB, packs, retrieval, tools, tokens, downloads), Electron self-test mode in packaged builds, golden-set eval gate in the pipeline, clean-machine matrix. |

</div>
