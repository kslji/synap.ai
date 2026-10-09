# Surf AI — Implementation guide (copy-paste)

*Electron 44 + TypeScript + Qwen3.5 + EmbeddingGemma 2 · v0.3 · 9 October 2026*

This is the "how", step by step. The "why" is in `ARCHITECTURE-SHORT.pdf`; interview material is in `HLD-LLD.pdf`.
Everything marked **✅ verified** was built and run on the Linux build box on 9 Oct 2026 (Debian 13, x64, 8 cores, 15.6 GB RAM, CPU only).
Everything marked **⬜ Mac/Windows** has not been run yet — see the checklist in §9.

Working code to start from:

| Folder | What it is |
|---|---|
| `implementation/surf-desktop/` | Electron app skeleton (electron-vite, React, all core modules wired, self-test mode, electron-builder config). |
| `implementation/backend/` | Docker Compose backend (Caddy, FastAPI, Postgres 17 + pgvector, Valkey, SearXNG) + API code. |
| `code-samples/ts/` | The same core modules with a stand-alone test runner (`tests/run-tests.ts`, 8/8 passing). |
| `code-samples/*.py` | Pipeline: crawl, clean, embed (EmbeddingGemma 2), build + sign packs. |

---

## 0. What is verified

| # | Check | Result | Status |
|---|---|---|---|
| 1 | `npm ci` from the lockfile (Node 22.23.3) | 12 s, prebuilt `better-sqlite3-multiple-ciphers` used, no compiler needed for the binary (but `make` must exist, see §1) | ✅ |
| 2 | `npm run typecheck` (main + preload + renderer, strict) | 0 errors | ✅ |
| 3 | `electron-vite build` | main 21 kB + calculator worker, preload 1.8 kB, renderer 642 kB | ✅ |
| 4 | Self-test **inside Electron 44.7.0** (dev) | 7/7 pass (below) | ✅ |
| 5 | `electron-builder --linux AppImage` with `npmRebuild: false` | `Surf AI-0.1.0.AppImage`, 160 MB (incl. 44 MB llama.cpp) | ✅ |
| 6 | Self-test from the **packaged AppImage** | 7/7 pass — native addon + sqlite-vec load from `app.asar.unpacked`, sidecar from `resources/bin` | ✅ |
| 7 | `docker compose up -d --build` backend | 5 containers up in 22 s; `/v1/health` all ok | ✅ |
| 8 | `/v1/search` via SearXNG | real results in 2.7 s; 401 without JWT; 429 after 10/min; `search_requests.query_text` always NULL | ✅ |
| 9 | Production schema `production_postgres.sql` on Postgres 17.11 + pgvector 0.8.7 | 31 tables created by `initdb` | ✅ |
| 10 | EmbeddingGemma 2 Q8_0 in llama.cpp b11514 vs SentenceTransformers fp32 | cosine 0.9991–0.9998 (768-d) | ✅ |
| 11 | Mac `.dmg`, Windows NSIS, safeStorage with a real keychain, Metal/Vulkan, updater, notarisation | — | ⬜ |

Self-test output (packaged AppImage, `implementation/verification/selftest-appimage.json`):

```
sqlite: SQLCipher user.db + sqlite-vec float[256] + FTS5   cipher=sqlcipher, sqlite 3.53.4, sqlite-vec v0.1.9, knn ok, fts ok
safeStorage (OS keychain)                                  backend=basic_text -> app must refuse on Linux without libsecret
calculator worker (mathjs, worker_threads)                 23.7*17.5=414.75; 14 knots=25.928 km/h
llama-server sidecar: EmbeddingGemma 2 (256-d)             dim=256, cos(relevant)=0.902, cos(unrelated)=0.560   2.0 s incl. start
llama-server sidecar: Qwen3.5 chat (thinking off)          answer="surf"                                      2.5 s incl. start
renderer: sandboxed window, preload API, no Node           {"surf":"object","require":"undefined","process":"undefined"}
```

---

## 1. Prerequisites (once per machine)

| Tool | Version | Install |
|---|---|---|
| Node.js | **22 LTS** (22.23.3 verified) | <https://nodejs.org/en/download> or `nvm install 22` |
| Python | **3.12** (pipeline + doc-worker) | <https://www.python.org/downloads/> |
| Git | any | — |
| Docker | 26+ with Compose v2 (backend only) | Docker Desktop (Mac/Win) or `apt install docker.io docker-compose` |
| macOS | Xcode Command Line Tools: `xcode-select --install` | needed by `node-gyp` fallback and `codesign` |
| Windows | nothing extra for prebuilt modules; "Desktop development with C++" only if a prebuild is missing | — |
| Linux | `sudo apt install make g++ xvfb` | `better-sqlite3-multiple-ciphers` runs `node-gyp` when `make` is missing even though a prebuild exists |

Pinned versions (all verified together):

```
electron 44.7.0 · electron-vite 5.0.0 · electron-builder 26.15.3 · electron-updater 6.8.9
vite 7.3.7 · @vitejs/plugin-react 5.2.0 · react / react-dom 19.3.0 · typescript 5.9.3
better-sqlite3-multiple-ciphers 13.0.3 · sqlite-vec 0.1.9 · mathjs 15.2.0 · zod 4.6.5
systeminformation 5.33.15 · @huggingface/tokenizers 0.2.0 · llama.cpp b11514 (>= b11452 for EmbeddingGemma 2)
FastAPI 0.143.0 · uvicorn 0.54.0 · psycopg 3.3.6 · redis 8.1.0 · pyjwt 2.15.1 · pydantic 2.14.0 · httpx 0.28.1
Postgres 17.11 + pgvector 0.8.7 · SearXNG 2026.10.7 · Valkey 8.1.10 · Caddy 2.11.7 (images pinned by digest)
```

---

## 2. Day 1 — Electron skeleton, sidecars, first answer

**2.1 Create the repo from the skeleton** (faster and safer than re-scaffolding):

```bash
mkdir surf && cd surf && git init
cp -r <this-folder>/implementation/surf-desktop apps/desktop      # or scaffold: npm create @quick-start/electron@latest desktop -- --template react-ts
cd apps/desktop
npm ci                                                              # uses package-lock.json (exact versions)
node scripts/fetch-sidecars.mjs                                     # llama.cpp b11514 for this OS -> resources/bin/<os>-<arch>/
npm run typecheck
```

✅ *Check:* `resources/bin/<os>-<arch>/llama-server --version` prints `version: 0.6.0-dev (build 11514, …)`; typecheck prints nothing.
Windows/Linux with a GPU: `node scripts/fetch-sidecars.mjs --gpu=vulkan`. macOS builds include Metal.

**2.2 Download models with resume + checksum** (the app does this itself via `model-download.ts`; for development):

```bash
mkdir -p ~/surf-models && cd ~/surf-models
curl -L -C - -O https://huggingface.co/unsloth/embeddinggemma-2-GGUF/resolve/main/embeddinggemma-2-Q8_0.gguf
curl -L -C - -O https://huggingface.co/unsloth/Qwen3.5-2B-GGUF/resolve/main/Qwen3.5-2B-Q4_K_M.gguf
curl -L -C - -O https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/main/Qwen3.5-4B-Q4_K_M.gguf     # 8 GB tier
# 16 GB tier: https://huggingface.co/unsloth/Qwen3.5-9B-GGUF/resolve/main/Qwen3.5-9B-Q4_K_M.gguf
cat > SHA256SUMS <<'S'
6f1bd4ac6c5df7444f9cca7ca36cafe6cfa34cd6f49fefb1e0b4be8143aed8bc  embeddinggemma-2-Q8_0.gguf
aaf42c8b7c3cab2bf3d69c355048d4a0ee9973d48f16c731c0520ee914699223  Qwen3.5-2B-Q4_K_M.gguf
00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4  Qwen3.5-4B-Q4_K_M.gguf
S
sha256sum -c SHA256SUMS --ignore-missing          # macOS: shasum -a 256 -c SHA256SUMS
```

Sizes: 309,855,520 · 1,280,835,840 · 2,740,937,888 bytes (9B: 5,680,522,464). Windows PowerShell: `Get-FileHash .\file -Algorithm SHA256`.

**2.3 Run the self-test inside Electron**

```bash
cd apps/desktop
SURF_MODELS_DIR=~/surf-models npm run selftest          # Linux server without a display: prefix with xvfb-run -a
# Windows PowerShell: $env:SURF_SELFTEST=1; $env:SURF_MODELS_DIR="$HOME\surf-models"; npx electron-vite build; npx electron .
```

✅ *Check:* exit code 0, every entry `"ok": true` in `<userData>/selftest.json`
(macOS `~/Library/Application Support/surf-desktop/`, Windows `%APPDATA%\surf-desktop\`, Linux `~/.config/surf-desktop/`).
Choose another chat model with `SURF_CHAT_GGUF=Qwen3.5-4B-Q4_K_M.gguf`.

**2.4 Sidecar flags (exact)**

```bash
# chat (tier 1 = 8 GB)
llama-server -m Qwen3.5-4B-Q4_K_M.gguf -c 8192 -np 1 --jinja --host 127.0.0.1 --port <random> --api-key <random> --no-webui -t <physical cores - 1>
#   add: --mmproj mmproj-F16.gguf only when an image is attached; tier 2: -m Qwen3.5-9B-Q4_K_M.gguf -c 16384
# embeddings (all tiers)
llama-server -m embeddinggemma-2-Q8_0.gguf --embeddings --pooling mean -c 2048 -b 2048 -ub 2048 -np 1 --host 127.0.0.1 --port <random> --api-key <random> --no-webui
```

Thinking is off per request: `"chat_template_kwargs": {"enable_thinking": false}`. Embeddings: queries are sent as
`task: search result | query: <q>`, passages as `title: <title or none> | text: <text>`; keep the first 256 of 768 values and
L2-normalise again (`embedding.ts → truncateNormalize`).

**2.5 Security settings (already in `main-window.ts`)** — `contextIsolation: true`, `sandbox: true` (+ `app.enableSandbox()`),
`nodeIntegration: false`, `webSecurity: true`, CSP `default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'`,
navigation and `window.open` blocked, every IPC handler calls `assertTrusted()` and validates with zod.
✅ *Check:* the self-test's renderer probe shows `require` and `process` are `undefined`.

---

## 3. Day 2 — encrypted database, token budget, embeddings

```ts
// src/main/core/db.ts (in the skeleton) — open user.db
const key = await getOrCreateDbKey();                 // key-store.ts: 32 random bytes, stored with safeStorage (async API)
const db = openUserDb(join(app.getPath('userData'), 'user.db'), key, MIGRATIONS);
// inside: PRAGMA cipher='sqlcipher'; PRAGMA legacy=4; PRAGMA key="x'<hex>'"; sqliteVec.load(db) from app.asar.unpacked
```

Schema: `code-samples/local_user_db.sql` (vectors are `float[256]`). ✅ *Check:* `SELECT vec_version()` → `v0.1.9`;
opening with a wrong key throws (`openUserDb` reports "wrong key"); the `sqlcipher` CLI 4.x opens the file with
`PRAGMA key="x'<hex>'"` (proves standard SQLCipher v4 format).

Token budget: `token-budget.ts` — tier 1: 4,096 tokens per request (server `-c 8192`), tier 2: 8,192 (server `-c 16384`).
Count with `POST /tokenize` on the chat server; `@huggingface/tokenizers` with Qwen3.5's `tokenizer.json` gives identical counts offline.
✅ *Check:* `cd code-samples/ts && npm ci && npm test` → token-budget test prints `total=4096` and the dropped chunk/turn counts.

---

## 4. Day 3 — attachments and local RAG

```bash
python3.12 -m venv .venv-worker && . .venv-worker/bin/activate
pip install "markitdown[pdf,docx]==0.1.*" rapidocr-onnxruntime     # doc-worker deps [VERIFY exact pins on Day 3]
```

Pipeline per file (AttachmentQueue → utilityProcess): hash → copy into `attachments/` → doc-worker returns Markdown →
chunk 350/50 tokens → `Embedder.embedDocs()` in batches of 32 → one transaction into `chunks`, `chunks_fts`, `chunk_vectors`.
Retrieval: FTS5 top-30 + vec0 top-30 per DB → RRF (k = 60) → top 6 → gate (`tauCos 0.70`, keyword coverage 0.5).
✅ *Check (already passing in `run-tests.ts`):* SOLAS question → `answer` (cos 0.87); "best pizza recipe" → `insufficient` (0.50).

---

## 5. Day 4 — tools and the backend

**Calculator:** `calculator.ts` + `calculator.worker.ts` (mathjs 15.2.0 in `worker_threads`; `import`, `createUnit`, `reviver`, `evaluate`, `parse`, `simplify`, `derivative`, `resolve` disabled after the marine units are defined; 2 s timeout, 64 MB heap). In electron-vite import the worker with `import calcWorker from './calculator.worker?modulePath'`. ✅ verified inside Electron.

**Backend on the GCP VM** (e2-medium, Debian 12, asia-south1):

```bash
sudo apt-get update && sudo apt-get install -y docker.io docker-compose git
git clone <your repo> surf && cd surf/implementation/backend/deploy
cp .env.example .env && nano .env            # set POSTGRES_PASSWORD, DATABASE_URL, SEARXNG_SECRET, JWT_SECRET (Supabase JWT secret)
sudo docker compose up -d --build            # Debian's package: `sudo docker-compose up -d --build`
curl -s localhost/v1/health                  # {"status":"ok","postgres":"ok (pgvector 0.8.7)","valkey":"ok","searxng":"ok"}
```

Then point DNS `api.<domain>` at the VM, replace `:80` in `Caddyfile` with `api.<domain>`, `docker compose restart caddy` (automatic HTTPS).
Firewall: allow tcp 80/443 only; SSH via `gcloud compute ssh` (IAP).

✅ *Checks (all run on the box):*

```bash
curl -s -XPOST localhost/v1/search -H 'content-type: application/json' -d '{"q":"x"}'          # 401 unauthenticated
TOKEN=$(python3 -c "import jwt,time;print(jwt.encode({'sub':'00000000-0000-0000-0000-000000000001','aud':'authenticated','exp':int(time.time())+600},'<JWT_SECRET>',algorithm='HS256'))")
curl -s -XPOST localhost/v1/search -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"q":"SOLAS entry into force"}'   # 200, 8 results
for i in $(seq 11); do curl -s -o /dev/null -w "%{http_code} " -XPOST localhost/v1/search -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"q":"test"}'; done   # ... 429 429
sudo docker compose exec -T postgres psql -U surf -d surf -c "select status, count(*), bool_and(query_text is null) from search_requests group by 1"
```

Memory on the box: API 123 MB, SearXNG 96 MB, Postgres 43 MB, Caddy 11 MB, Valkey 4 MB → fits an e2-medium (4 GB) with room for the pipeline.
*Box-only quirk:* this sandbox had stale `iptables-legacy` rules that dropped container-to-container traffic; a normal GCP VM does not.

---

## 6. Day 5 — login, device licence, packs

* Supabase: Authentication → Providers → enable Email (OTP) and Google; add redirect URL `https://<domain>/auth/desktop/callback`.
* Desktop: `shell.openExternal(<login page>?challenge=<PKCE S256>)` → page calls `POST /v1/auth/desktop/authorize` → redirects to `surf://auth?code=…` → app calls `POST /v1/auth/desktop/token` with the verifier. Register the protocol with `app.setAsDefaultProtocolClient('surf')` and `protocols:` in `electron-builder.yml`.
* Packs: `pack-verify.ts` checks the Ed25519 signature over the manifest bytes, then SHA-256 + size of every file, then the embedding spec (`embeddinggemma-2-text@256`, prefixes, dim). ✅ tamper test passes in `run-tests.ts`.
* "Install from file…" uses the same verifier (USB path).

---

## 7. Day 6 — pipeline and first pack

```bash
python3.12 -m venv .venv-pipe && . .venv-pipe/bin/activate
pip install datatrove trafilatura warcio httpx pynacl orjson sqlite-vec zstandard boto3
# embeddings: run the same GGUF the app uses
llama-server -m embeddinggemma-2-Q8_0.gguf --embeddings --pooling mean -c 2048 -b 2048 -ub 2048 --port 8081 &
python code-samples/cc_fetch.py imo.org 20                     # domain, max pages -> data/warc/
NICHE=marine CRAWL=CC-MAIN-2026-39 python code-samples/dt_clean.py   # -> data/marine/<crawl>/deduped/*.jsonl.gz
PACK_SIGNING_KEY_HEX=<ed25519 seed hex> python code-samples/build_pack.py 'data/marine/*/deduped/*.jsonl.gz'   # embeds via :8081
R2_ACCOUNT_ID=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… python code-samples/publish_r2.py   # pack.sqlite.zst + manifest.json + .sig
```

Optional GPU/fp32 path: `sentence-transformers>=6.1.0` with `SentenceTransformer("google/embeddinggemma-2", config_kwargs={"vision_config": None, "audio_config": None}, model_kwargs={"torch_dtype": torch.float32})` — never float16. `embedding_spec.py → STEmbedder` does the truncation the same way. ✅ cosine vs llama.cpp Q8_0 ≥ 0.999.

---

## 8. Day 7 — package and hand out

```bash
npm run dist:mac      # on a Mac: dmg + zip, arm64 + x64 (unsigned until certificates are bought)
npm run dist:win      # on Windows: NSIS .exe x64
npm run dist:linux    # ✅ verified: dist/Surf AI-0.1.0.AppImage + latest-linux.yml
```

Key `electron-builder.yml` lines (full file in the skeleton):

```yaml
asarUnpack: ["**/*.node", "node_modules/sqlite-vec-*/**"]
extraResources:
  - { from: "resources/bin/${platform}-${arch}", to: bin }      # llama-server + libs
  - { from: resources/models.registry.json, to: models.registry.json }
npmRebuild: false     # Node-API prebuilds work in Electron as-is (verified in the packaged AppImage)
```

Note: on macOS, `${platform}` is `darwin` and `${arch}` is `arm64`/`x64`, so fetch sidecars on (or for) each arch before building both;
for a universal workflow run `dist:mac` once per arch.
Publish: `GH_TOKEN=<token> npx electron-builder --mac --win --publish always` → draft GitHub Release → review → publish.

---

## 9. Mac / Windows verification checklist (not yet run)

Run each on a **clean** machine (new user account, no dev tools) unless noted. Record pass/fail + screenshots in the repo.

**macOS (Apple Silicon 8 GB and 16 GB, plus one Intel Mac if testers have them)**
1. `npm ci` on a dev Mac: `better-sqlite3-multiple-ciphers` downloads a darwin-arm64 prebuild (no `node-gyp` compile in the log).
2. `node scripts/fetch-sidecars.mjs` → `llama-server --version` = 11514; `llama-server --list-devices` shows `Metal`.
3. `npm run selftest` → all 7 ok; **safeStorage line must show a real backend and "round-trip ok"** (Keychain prompt may appear once).
4. Embedding cosine on Metal ≈ the Linux values (relevant ≈ 0.90, unrelated ≈ 0.56 ± 0.02); if far off, run embeddings with `-ngl 0` (CPU).
5. Qwen3.5-4B on 8 GB: first token < 3 s, ≥ 10 tokens/s, Activity Monitor memory pressure stays green with both sidecars.
6. `npm run dist:mac` → `.dmg` opens; first launch shows "unidentified developer" → right-click → Open works; app starts offline (Wi-Fi off).
7. Packaged app: selftest via `SURF_SELFTEST=1 /Applications/Surf AI.app/Contents/MacOS/Surf AI` → all ok (proves asar-unpacked addon + `vec0.dylib` + sidecar signing-free launch).
8. Quarantine: download the `.dmg` through a browser (sets `com.apple.quarantine`), install, confirm the bundled `llama-server` is allowed to run (Gatekeeper may block unsigned nested binaries — if so, document `xattr -dr com.apple.quarantine /Applications/Surf AI.app` for testers until notarisation).
9. Auto-update: install 0.1.0, publish 0.1.1 to a draft→published release, confirm the update downloads; on unsigned macOS builds expect Squirrel.Mac to **refuse** — record it (known: macOS auto-update needs signing).
10. Microphone permission prompt appears only when voice is used (week 2).

**Windows 10 and 11 (x64, 8 GB and 16 GB; one machine with an NVIDIA or AMD GPU)**
1. `npm ci` uses the win32-x64 prebuild; no Visual Studio needed.
2. `node scripts/fetch-sidecars.mjs` (CPU) and `--gpu=vulkan` on the GPU machine; `llama-server.exe --list-devices`.
3. `npm run selftest` (PowerShell variables as in §2.3) → all ok; safeStorage shows DPAPI round-trip ok.
4. `npm run dist:win` → NSIS installer; SmartScreen "Windows protected your PC" → More info → Run anyway works; per-user install, no admin prompt.
5. Windows Defender: full scan of the install folder → no detection of `llama-server.exe` / `*.dll`; if flagged, submit to Microsoft as false positive.
6. Packaged selftest: `$env:SURF_SELFTEST=1; & "$env:LOCALAPPDATA\Programs\Surf AI\Surf AI.exe"` → all ok.
7. Sidecar cleanup: kill Surf AI from Task Manager → no orphan `llama-server.exe` after 5 s (Job-object/ppid watchdog behaviour) — fix before testers if it fails.
8. Paths with spaces and non-ASCII user names (e.g. `C:\Users\Kabir Shah\`) → models, DB and sidecars still work.
9. Auto-update from 0.1.0 → 0.1.1 via GitHub Releases works unsigned (NSIS), and offline update from file + `.sig` works.
10. 8 GB laptop: Qwen3.5-4B + EmbeddingGemma 2 together stay under ~5 GB commit; no swapping during a 30-turn chat.

**Both**
- Airplane-mode run: chat, attachment ingest, pack install from USB, calculator — all work with no network.
- Wrong DB key / copied `user.db` to another machine → cannot be opened.
- Tampered pack (flip one byte) → rejected with a clear message; previous pack stays active.
