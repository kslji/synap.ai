# ADR 0007 — Qwen3.5-2B is the default chat model

Supersedes [ADR 0004](0004-single-chat-model.md). Numbered 0007 because 0005 (OpenRouter gateway) and 0006 (Surf IDE) were written before this decision; the request called it ADR-0005, but that file already exists.

ADR 0004 chose one chat file for every laptop: Qwen3.5-4B Q4_K_M (2.74 GB, plus a 0.67 GB `mmproj`). It removed the size picker so there was one file to test, cache, and support. The measurement that followed changes the file, not the shape of the decision.

Measured on an Apple Silicon laptop (8 GB M1) with llama-server b11514 (`npm run bench:offline`, cold start, `cache_prompt`, a 97-token system prefix, `enable_thinking: false`):

| | Qwen3.5-2B Q4_K_M | Qwen3.5-4B Q4_K_M |
| --- | --- | --- |
| File | 1.19 GiB | 2.74 GB (+0.67 GB `mmproj`) |
| Load | 2.0–3.6 s | ~3.2 s |
| First token, cold | 145 ms | 2.5 s+ |
| First token, warm | 56 ms | 1.9 s |
| First answer token, warm (thinking off) | 56 ms | 1.9 s |
| Decode | 31.3 tok/s | ~22 tok/s |
| Tab p50 / p95 | 59 ms / 70 ms | 340 ms p95 |
| RSS | 236 MB | ~700 MB |

The 2B answers first on the machine people actually use, and it is accurate enough to be the default: on the [20-task agent eval](../code-agent-eval.md) it finishes 13 of 20 real edit tasks through the direct loop at a median of 4 steps. Its failures are the asks that need two coordinated edits or a new file, which is what the failure ladder's suggestion of a larger model is for. The 4B is not measured on that eval yet (only the 2B's weights are in the test image). Accuracy still comes before latency, so the 4B stays one click away; it is not the default.

## Decision

**Qwen3.5-2B Q4_K_M is the default chat model for every laptop tier and every agent.**

- Registry (`apps/desktop/resources/models.registry.json` and `services/api/app/models.registry.json`) lists `qwen3.5-2b-q4_k_m` first:
  - url `https://huggingface.co/unsloth/Qwen3.5-2B-GGUF/resolve/main/Qwen3.5-2B-Q4_K_M.gguf`
  - `size_bytes: 1280835840`
  - `sha256: aaf42c8b7c3cab2bf3d69c355048d4a0ee9973d48f16c731c0520ee914699223`
  - `tiers: [0, 1, 2, 3]`, `min_ram_gb: 8`, `default_for: ["*"]`
- `default_for: ["*"]` means "default for every agent". `pick()` prefers a row marked for the agent over the largest file, so a 16 GB or 32 GB laptop still gets the 2B unless the person picks the 4B.
- Qwen3.5-4B Q4_K_M stays in the registry as `qwen3.5-4b-q4_k_m`, with `tiers: [0, 1, 2, 3]` and no `default_for`. It is the optional "More accurate" download, 1.5 GB larger, and it is still the only file with a `mmproj` (screenshots).
- `synap://setup?model=4b` and `?model=qwen3.5-4b-q4_k_m` open the 4B; 2B links and 9B links open the 2B.
- Decomposition costs the 2B more than it gains, so `runSplitTask` now routes before it plans. A task naming one or two files behind at most two symbols goes straight to the loop; a new file, three or more files, or more than two symbols gets one plan attempt (not three) and a step per file with a check and a 3x3 failure ladder. The same 20 tasks now score 12/20 through `runSplitTask` against the loop's 13/20, in 909 s against 279 s - and 616 s of that is one `llama-server` request that stalled, so the other 19 runs total 293 s. One task still takes the checklist: `shared-limit`, which needs a file created. The earlier run of the un-routed ladder scored 8/20 in 1548 s with seven runs cut off by the 120 s cap. The eval doc records the per-task detail.
- Offline installers are one zip per OS/arch (`-2b-offline.zip`, `-4b-offline.zip`). The 2B zip carries the chat file plus both bundled search files ([ADR 0008](0008-jina-code-embeddings.md)), 151 MiB together, so it fits one GitHub release asset (< 2 GiB) and one NSIS data block. The 4B zip is over 3 GB and still goes to the Hugging Face dataset.

## Downloads are always the person's choice

- Nothing downloads automatically at install or at launch. First open shows the model card and a Download button; the file appears only after that click.
- Before any download the app checks free disk space against the file size plus a margin, and refuses with the size it needs instead of filling the disk.
- Every download is verified against the registry `sha256` (and size) before it is moved into place. A mismatch deletes the `.part` file and reports a checksum error. A copy already in Downloads is offered, never moved without consent, and is hashed first.
- Any installed model can be deleted from Settings, including the default. The app then offers the download again. The 4B is a separate row, so deleting it never touches the 2B.

## Thinking is off by default, on only where it pays

Qwen3.5 is a thinking model: with thinking on, every token arrives as `reasoning_content` and `content` stays empty until the reasoning ends. With thinking off it answers immediately. So:

- Thinking **off** (`chat_template_kwargs: {enable_thinking: false}`) for Tab completion, inline edit, quick chat, and individual edit steps. These are short, well-specified jobs where reasoning only adds latency, and Tab's budget is 24 tokens.
- Thinking **on** only for agent planning and the fix-after-failure step, capped at 512 reasoning tokens. The cap is enforced in two phases — the first request may think up to 512 tokens, then the answer is forced with `enable_thinking: false` and the reasoning passed back as context — because this build's template ignores a per-request `reasoning_budget` (checked: reasoning ran to the request cap anyway).
- The chat UI streams `reasoning_content` into a collapsible "Thinking…" block, so a reply never looks empty while the model reasons.

Trade-off: the default is 1.5 GB smaller and roughly twice as fast to first token, at some accuracy cost on long plan steps. The 4B is one download away for people who want it, and the registry can promote it again without an app update.
