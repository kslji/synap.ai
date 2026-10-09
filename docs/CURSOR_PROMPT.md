# CURSOR_PROMPT.md - how to start building Surf AI with Cursor

Two parts:

- **(a)** The first message to paste into **Cursor Agent mode** in the new `surf/` repo.
- **(b)** The project rule file `.cursor/rules/project.mdc`. It is also saved next to this file at `.cursor/rules/project.mdc`; copy it into the repo before you send the prompt.

Setup before pasting:
1. Create the repo with `docs/` containing `ARCHITECTURE-FULL.md`, `ARCHITECTURE-SHORT.md`, the four diagram PNGs and `code-samples/` (with `ts/`).
2. Add `.cursor/rules/project.mdc`.
3. Open the folder in Cursor and choose Agent mode.

Cursor docs on rules: <https://cursor.com/docs/rules>. Project rules are `.mdc` files in `.cursor/rules/` with `description`, `globs` and `alwaysApply` frontmatter. With `alwaysApply: true` the rule is included in every Agent chat, and `globs` is then ignored (it is kept only as documentation of scope).

---

## (a) First prompt for Cursor Agent mode

````markdown
You are the lead engineer building **Surf AI**, a local-first offline AI desktop assistant ("Works offline. Stays up to date when you're online."). I am kabir, the founder. I know TypeScript/JavaScript, not Rust. We have 7 days for an MVP that testers can install.

## 1. Read first (do not write code yet)
1. `docs/ARCHITECTURE-SHORT.md` - the whole design in ~20 pages.
2. `docs/ARCHITECTURE-FULL.md` - sections 2, 3, 4, 8 (incl. §8.4 Token budget), 11, 13, 14 and 15 in full; skim the rest.
3. `docs/code-samples/ts/` - tested TypeScript: `sidecar-manager.ts`, `db.ts`, `key-store.ts`, `token-budget.ts`, `retrieval.ts`, `calculator.ts` + `calculator.worker.ts`, `pack-verify.ts`, `model-registry.ts`, `model-download.ts`, `hardware.ts`, `llama-client.ts`, `main-window.ts`, `preload.ts`, `ipc-contract.ts`, `ipc-schemas.ts`, `updater.ts`, `electron-builder.yml`, `models.registry.json`, `tests/run-tests.ts` (and `tests/LAST_RUN.txt`).
4. `docs/code-samples/` - `local_user_db.sql`, `pack_db.sql`, `production_postgres.sql`, Python pipeline (`cc_fetch.py`, `dt_clean.py`, `build_pack.py`, `hybrid_search.py`, `publish_r2.py`), `marine-engineer.agent.yaml`.
5. `docs/IMPLEMENTATION.md` - exact commands, pinned versions and the Mac/Windows checklist; `docs/implementation/surf-desktop/` is a **working Electron skeleton** (verified on Linux: typecheck, build, self-test inside Electron and in a packaged AppImage) and `docs/implementation/backend/` a working Docker Compose backend. Start from them instead of re-scaffolding.
6. `docs/HLD-LLD.md` - module boundaries, interfaces, state machines and API contracts to implement.
7. `.cursor/rules/project.mdc` - the rules you must follow.

Then reply with: (a) a 10-line summary of the architecture in your own words, (b) anything in the docs that looks contradictory or risky, (c) your Day 1 task list. Wait for my "go".

## 2. Stack (fixed - propose changes, don't make them)
- **Desktop:** Electron 44 + electron-vite (scaffold: `npm create @quick-start/electron@latest`, template react-ts) + electron-builder (dmg arm64+x64 + zip, NSIS) + electron-updater (GitHub Releases). React + TypeScript strict. zod on every IPC message.
- **Main process (TypeScript):** orchestrator (retrieve → relevance gate → token budget → llama-server → tools → citations), DB, sidecars, packs, models, auth, updates.
- **Local AI:** llama.cpp `llama-server` pinned build (e.g. b11514) as a sidecar; Qwen3.5-4B Q4_K_M (8 GB), Qwen3.5-9B Q4_K_M (16 GB+), Qwen3.5-2B fallback, from `unsloth/Qwen3.5-*-GGUF`, + `mmproj-F16.gguf` for images; EmbeddingGemma 2 (text-only 270M, `embeddinggemma-2-Q8_0.gguf`, 256-d Matryoshka, mean pooling, task prefixes) for embeddings. Downloaded on first launch with resume + SHA-256 (sizes/hashes in `models.registry.json`).
- **Local DB:** better-sqlite3-multiple-ciphers (SQLCipher mode) + sqlite-vec + FTS5; key via Electron safeStorage.
- **Python:** doc-worker sidecar (pypdfium2, MarkItDown, RapidOCR; PyInstaller) and the pack pipeline (Python 3.12).
- **Backend:** FastAPI + Postgres 17/pgvector + SearXNG + Caddy (Docker Compose) on one GCP e2-medium VM (asia-south1, $300 trial); Supabase Auth; packs on Cloudflare R2 (or GCS); installers on GitHub Releases.

## 3. Repo layout
Create exactly the monorepo in `docs/ARCHITECTURE-FULL.md` §14:
```
surf/
  apps/desktop/        # Electron: src/main (core), src/preload, src/shared (ipc-contract, ipc-schemas), src/renderer (React)
                       # resources/bin/<platform>-<arch>/ (sidecars, gitignored, fetched by script), resources/models.registry.json
  services/api/        # FastAPI backend
  workers/doc-worker/  # Python sidecar
  pipelines/           # ingest/, packs/, eval/, agents/
  packages/            # shared-py/surf_text, schemas/
  deploy/              # docker-compose.yml, Caddyfile, searxng/, gcp/
  scripts/             # fetch-sidecars.mjs, gen-keys.ts, sign-release.ts
  docs/                # ARCHITECTURE-*.md, code-samples/, adr/
  .cursor/rules/project.mdc
```
Copy `docs/code-samples/ts/*` into the matching `src/main/...` folders as the starting point (paths are listed in §14), keep their tests and port them to vitest.

## 4. How we work
- **One day at a time.** Follow the 7-day plan (§15.2 / short doc §9). Finish the day's [M] items, run typecheck + lint + tests, then STOP and report: done / not done / test results / decisions needed / what Day N+1 will do. Wait for my approval before continuing. Do [S] items only if all [M] items are green.
- **Small commits**, one concern each, conventional messages. Never commit secrets; keep `.env.example` complete (API base URL, Supabase URL + anon key, R2 bucket/endpoint, update feed repo, feature flags) and `.env` gitignored.
- **Tests for core logic** (vitest; pytest for Python): token budget, gate, retrieval, calculator, pack/licence verification, download resume, migrations.
- **Privacy:** prompts, answers and documents never leave the device and are never logged (counts only). Telemetry opt-in and off by default. Honour Offline-only mode.
- **Security:** sandboxed renderer, contextIsolation, no nodeIntegration, strict CSP, typed preload API only, sidecars on 127.0.0.1 with random key, verify every signed artefact.
- **Deviations:** if a doc instruction is wrong or a library behaves differently, stop, explain, propose a fix (and an ADR), and wait.
- **[VERIFY] spikes first:** before building on a [VERIFY] item, write a tiny spike, record the result in `docs/adr/`, then continue. Day 1 spikes: (1) better-sqlite3-multiple-ciphers + sqlite-vec inside a *packaged* Electron app on macOS arm64 and Windows x64 (asar unpack); (2) Qwen3.5-4B tool calling with `enable_thinking:false` on the pinned llama.cpp build; (3) an unsigned packaged build opening on a clean Mac and Windows PC; (4) safeStorage async round-trip.
- **Model/token rules:** always pass `-c` (8192 / 16384) and `-np 1` to llama-server; thinking off; one stable system message; SOURCES + question in the last user message; tool schemas only when needed; count tokens with `/tokenize`; never send the 262K context.

## 5. Start
After I say "go": begin **Day 1 - Skeleton + the riskiest spikes** exactly as listed in §15.2 (copy `docs/implementation/surf-desktop` to `apps/desktop`, `npm ci`, `node scripts/fetch-sidecars.mjs`, `npm run selftest` on this machine, then: secure window + preload + typed IPC, `scripts/fetch-sidecars.mjs` with pinned llama.cpp + SHA-256, sidecar manager, hardware tier + model registry + resumable download, streaming chat, the four spikes). Day 1 is done when a clean 8 GB and 16 GB machine download the right model and stream an answer offline. Then stop and report.
````

---

## (b) `.cursor/rules/project.mdc`

````markdown
---
description: Surf AI project rule - local-first offline AI desktop app (Electron + TypeScript main process, llama.cpp sidecars, encrypted SQLite, Python doc-worker and pipeline, FastAPI backend). Architecture, privacy, security and workflow rules for every change.
globs: apps/**, services/**, workers/**, pipelines/**, packages/**, scripts/**, deploy/**, docs/**
alwaysApply: true
---

# Surf AI - project rule

Source of truth: `docs/ARCHITECTURE-SHORT.md` (read first) and `docs/ARCHITECTURE-FULL.md` (details, DDL, edge cases). Tested reference code: `docs/code-samples/ts/` (TypeScript) and `docs/code-samples/` (Python, SQL). Reuse those samples instead of inventing new designs; if you think the doc is wrong, propose the fix first.

## Stack (do not change without an ADR in docs/adr/)
- Desktop: Electron 44 + electron-vite + electron-builder; React + TypeScript (strict) + Vite in the renderer; zod at every IPC boundary.
- Main process (TypeScript) owns: orchestrator, retrieval, relevance gate, token budget, tools, DB, sidecars, packs, models, auth, updates.
- Sidecars via `child_process.spawn`: llama.cpp `llama-server` (pinned build) for chat (Qwen3.5 2B/4B/9B Q4_K_M + mmproj) and embeddings (EmbeddingGemma 2, llama.cpp ≥ b11452, `--pooling mean`, `-ub` = `-c`); Python doc-worker; whisper.cpp later. Job runner in `utilityProcess`. Calculator in a `worker_threads` worker.
- Local DB: `better-sqlite3-multiple-ciphers` in SQLCipher mode (`cipher='sqlcipher'`, `legacy=4`, raw hex key) + `sqlite-vec` + FTS5; key wrapped with Electron `safeStorage` (async API). Packs are separate read-only SQLite files.
- Backend: FastAPI + Postgres 17/pgvector + SearXNG + Caddy in Docker Compose on one GCP e2-medium VM; Supabase Auth; packs on R2 (or GCS); installers on GitHub Releases; models from Hugging Face.

## Workflow
- Work ONE plan day at a time (docs §15 / short doc §9). At the end of each day: stop, summarise what is done, what is not, test results, and open questions. Do not start the next day without approval.
- Small, focused commits with clear messages (`feat(desktop): …`, `fix(api): …`). One concern per commit.
- Before deviating from the architecture or a code sample: explain the problem and the proposed change, then wait.
- Items marked [VERIFY] in the docs are spikes: test them in isolation first, record the result in `docs/adr/NNNN-*.md`, then build on them.
- Write tests (vitest / pytest) for core logic: token budget, relevance gate, retrieval ranking, calculator, pack/agent/licence verification, model download/resume, migrations. `npm run typecheck`, lint and tests must pass before a commit.
- Never commit secrets. Keep `.env.example` complete and up to date; real values only in local `.env` (gitignored) or CI secrets. Only PUBLIC keys go in `resources/keys/`.

## Privacy (non-negotiable)
- Chats, attachments, prompts and answers never leave the device. No prompt/answer text in logs, telemetry or crash reports - counts and timings only.
- Telemetry is opt-in, off by default. Web search sends only the query to our own SearXNG proxy; pages are fetched and cleaned on the device. Server never logs query text.
- Respect "Offline-only" mode: no network calls at all (enforced in `net/offline-guard.ts`).

## Security
- BrowserWindow: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`; `app.enableSandbox()`; strict CSP; block navigation and `window.open`; permission handler allows only what is needed.
- Preload exposes only the typed `window.surf` API from `shared/ipc-contract.ts`; every `ipcMain.handle` validates input with zod and checks the sender frame.
- Sidecars bind to 127.0.0.1 with a random port and random API key. No `eval`, no `new Function`, no shell string interpolation (use `spawn` with arg arrays).
- Packs, agent manifests, model registry, licences and offline installers are verified (Ed25519 signature + SHA-256) before use. Refuse downgrades.

## Model and token rules
- Always start llama-server with explicit `-c` (8192 on tiers 0-1, 16384 on tier 2) and `-np 1`; never rely on the model's 262K default.
- Thinking OFF by default: send `chat_template_kwargs: {"enable_thinking": false}`; non-thinking sampling temp 0.7, top_p 0.8, top_k 20, presence_penalty 1.5.
- Every chat request goes through the token-budget allocator (`orchestrator/budget.ts`): count with llama-server `/tokenize` (or `@huggingface/tokenizers` with Qwen3.5 `tokenizer.json`), never tiktoken for budgeting. 8 GB tier: 4096 total (~400 system+tools, ~1500 chunks, ~1000 history, ~300 question, >=800 answer); 16 GB tier: 8192.
- Keep the system prompt stable (cacheable): exactly ONE system message; put SOURCES and the question in the last user message; send tool schemas only when needed; never paste whole attachments; summarise old turns, keep the last 3-4.
- Numbers come from tools (`calculator`, `unit_convert` via mathjs), never from the model's head. Max 4 tool steps.
- Grounded answers cite sources as [S1], [S2]; if the gate says insufficient, show the refusal template (no LLM call) or use web search when online and allowed.
- Model choice comes from `models.registry.json` (licence allow-list: Apache-2.0, MIT) - no hard-coded model paths.

## Code style
- TypeScript strict, ESM, no `any` without a comment. Shared types in `src/shared/`. Small modules; pure functions for logic so they are testable without Electron.
- Python 3.12, type hints, ruff. SQL migrations are forward-only and numbered.
````

---

### Tips
- When Cursor finishes a day, review the diff, run the app yourself, then reply "go Day N+1" (or ask for fixes).
- If Cursor repeats a mistake, add one line to `project.mdc` instead of repeating yourself in chat.
- Keep the rule short (Cursor recommends under 500 lines). Put details in `docs/` and point to them.
