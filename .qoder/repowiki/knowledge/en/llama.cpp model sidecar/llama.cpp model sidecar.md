---
kind: external_dependency
name: llama.cpp model sidecar
slug: llama-cpp
category: external_dependency
category_hints:
    - framework_behavior
scope:
    - '**'
source_files:
    - apps/desktop/scripts/fetch-sidecars.mjs
    - apps/desktop/resources/models.registry.json
    - apps/desktop/src/main/core/token-budget.ts
---

### llama.cpp (Qwen3.5 chat + EmbeddingGemma 2)
- Role: on-device inference engine; model weights are downloaded from the website at first launch (SHA-256 verified) and run as a local sidecar — no network calls during chat.
- Integration: `scripts/fetch-sidecars.mjs` downloads platform-specific binaries; `models.registry.json` maps model IDs to GGUF files; hardware tiering selects between Qwen3.5-2B/4B/9B profiles.
- Stable shape: the app launches the binary, streams prompts/responses over a local IPC channel, and enforces a token budget so small models do not overflow context.