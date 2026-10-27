# ADR 0004 — One generic chat model

**Superseded by [ADR 0007](0007-qwen35-2b-default.md): the default file is now Qwen3.5-2B Q4_K_M, and 4B is the optional download. The rest of this decision (one shared chat model, no per-agent size picker) still stands.**

The app offered several chat model sizes: Qwen3.5 2B, 4B, and 9B on the first-open screen, a Qwen size picker in Settings, and a separate Code model list (Qwen3.5 Q6_K 2B/4B/9B plus Gemma 4 E2B/E4B/12B). Users had to pick a size by RAM (4 GB, 8 GB, 16 GB, 32 GB), and each agent could end up on a different file.

Decision: ship **one** chat model for every laptop and every agent: **Qwen3.5-4B Q4_K_M** (`qwen3.5-4b-q4_k_m`, 2.74 GB file, 0.67 GB `mmproj` for screenshots, Apache-2.0). The minimum supported laptop has 8 GB of RAM. Bigger machines run the same file, and their tier only raises the context window (8K up to 15 GB of RAM, 16K at 16 GB and above) and the speech model.

- `models.registry.json` (desktop and API copies) lists one chat row with `tiers: [0, 1, 2, 3]` and `default_for: ["code"]`. The 2B/9B Q4_K_M rows, the Code-only Q6_K rows, and the Gemma 4 rows are removed. The speech models, Silero VAD, EmbeddingGemma, and the optional speculative-decoding draft (`agents: ["draft"]`) stay.
- A chat row without `agents` now serves every agent, Code included (`servesAgent`).
- First open shows one Download card (with the search model). Below 8 GB it shows a warning but still lets the person download.
- Settings drops the Qwen size picker, the Code model list, "Which model should I pick?", and "Get another model".
- Old `synap://setup?model=2b|4b|9b` links all open the generic model.
- Offline installers: one zip per OS/arch (`-4b-offline.zip`). At 3.05 GB it goes to the Hugging Face dataset, not GitHub Releases.

Trade-off: 4 GB laptops are no longer a target, and 16 GB+ laptops lose the 9B quality option. In return, there is one file to test, cache, and support, and every agent behaves the same way.
