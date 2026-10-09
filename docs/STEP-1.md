# Step 1 — done, and what is next

Shipped in this pass: the monorepo, the Surf AI desktop shell, the original dot characters, the marketing site, and CI.

## Done

- `apps/desktop` is the Electron skeleton, renamed from the Harbor placeholder. App id `ai.surf.desktop`. User data directory `surf-ai`. Environment prefix `SURF_` (`HARBOR_` still accepted).
- The window has onboarding, chat, a model manager, and settings. Chat streams from `llama-server`. The calculator worker answers plain arithmetic and unit conversions. Downloads use the real registry, HTTP resume, and SHA-256.
- `packages/ui` holds the shared theme (white, orange `#F97316`, black) and the original sea creatures: a jellyfish, a seahorse, and an octopus. They animate for idle, thinking, answering, tool use, offline, and error, and they respect `prefers-reduced-motion`. A Light / Dark / System control lives in the app sidebar and Settings, and in the website header and mobile menu. The choice defaults to the system theme and is applied before first paint. Button labels on orange are black so the contrast stays above WCAG AA.
- `apps/web` is a static Vite site (hero, features, how it works, download, requirements, FAQ). Download buttons are macOS .dmg and Windows .exe. The app picks the RAM tier on first launch.
- `services/api` and `deploy/` are the verified FastAPI + Postgres/pgvector + SearXNG compose, renamed in comments and defaults.
- `pipelines/ingest` points at the Day 6 scripts in `docs/code-samples/`.
- GitHub Actions typechecks and builds the desktop app and the site on pull requests, and a `v*` tag builds an unsigned `.dmg` and `.exe` into a draft release.
- The portable zip pack is removed: the old `/download` RAM-tier builder, `LOCAL-SETUP` / `SURF-OPEN`, zip generation, the in-zip `check-pack` harness, and the green theme that lived with that site. `build.txt` now builds `apps/web` and `rsync --delete`s `dist/` onto the live host, so the zip pages are not served.
- `apps/host` stays. It is the existing OTP, account, and feedback API. The new desktop app and the marketing site do not call it. Day 5 replaces login; this PR does not delete the live auth service.

## Removed with the zip pack

| Removed | Why |
|---|---|
| `apps/pack-site` (previously `apps/web`) | The whole browser pack: `/download` tier picker, client-side zip build, chat shell, green palette |
| `LOCAL-SETUP`, `SURF-OPEN`, `PULL-MODEL`, Colibri installers | They only existed to unpack and start that zip |
| `public/harness/check-pack.*` and the pack eval runner | Shipped inside the zip to verify Ollama packs |
| Moss vault seal step in `build.txt` and `.env.example` | It encrypted credentials into the zip. The host still reads `MOSS_PROJECT_*` itself |
| Harness tests that opened those files | `test_pack_identity`, `test_moss_pack`, `test_pack_guardrails`, `test_standalone`, `test_chat_markdown`, `test_zip_and_summary`, `test_file_focus`, `test_diagram_overview`, `test_resume_facts`, `test_general_chat`, `test_over_refusal`, `test_fuzzy_intent` |

Kept on purpose: `apps/host` (auth / OTP / feedback / admin), its systemd unit, and host checks (`test_guardrails`, `test_moss`, `test_convert`, `test_reply_repair`, `gate.py`, `smoke.py`). The reply-repair check is a standalone copy of the loop-dedupe rules and does not need the deleted site.

## Wired vs later

| Piece | State | Lands |
|---|---|---|
| llama-server chat, thinking off, one model at a time | Wired | Day 1 |
| Model registry, RAM tier, resumable download | Wired | Day 1 |
| Calculator worker for obvious maths and for model tool calls | Wired | Day 1 |
| Hybrid retrieval + relevance gate | Code path is live; packs are not opened until they are signed | Day 5 open, Day 3 attachments, Day 6 first pack |
| Empty library | General chat goes to the local model. A failed gate (once packs exist) says "I don't have enough information…" | Decision recorded in `docs/adr/0002-general-chat-without-packs.md` |
| Web search | Not called. The refusal mentions that search is not connected | Day 4 |
| Encrypted chat history | `chat.db` via safeStorage when the OS keychain works. Otherwise this session only, never a plaintext file | Day 2 moves this into the full `user.db` schema |
| Attachments, local retrieval | Done in `docs/STEP-2.md` | Day 2–3 |
| mmproj / images | Registry entries only. Not downloaded yet | Day 3 |
| Login, device licence, pack import | Dialog says Day 5 | Day 5 |
| Pipeline | Placeholder | Day 6 |
| Signed auto-update | Updater is initialised; macOS signing secrets are a TODO in the release workflow | Day 7 |
| Whisper | Listed as later in the model manager | Week 2 |

## Next

Document chat shipped in `docs/STEP-2.md`. After that: web search (Day 4), then login and signed packs.
