# ADR 0007 — Qwen3.5-2B is the default chat model

Supersedes [ADR 0004](0004-single-chat-model.md). Numbered 0007 because 0005 (OpenRouter gateway) and 0006 (Surf IDE) were written before this decision; the request called it ADR-0005, but that file already exists.

ADR 0004 chose one chat file for every laptop: Qwen3.5-4B Q4_K_M (2.74 GB, plus a 0.67 GB `mmproj`). It removed the size picker so there was one file to test, cache, and support. The measurement that followed changes the file, not the shape of the decision.

Measured on an Apple Silicon laptop with llama-server b11514 (`scripts/bench-offline`, cold start, `cache_prompt`, a 97-token system prefix):

| | Qwen3.5-2B Q4_K_M | Qwen3.5-4B Q4_K_M |
| --- | --- | --- |
| File | 1.28 GB | 2.74 GB (+0.67 GB `mmproj`) |
| Load | 2054 ms | ~3.2 s |
| First token, cold | 134 ms | 2.5 s+ |
| First token, warm | 59 ms | 1.9 s |
| Decode | 31.5 tok/s | ~22 tok/s |
| Tab p50 / p95 | 65 ms / 74 ms | 340 ms p95 |
| RSS | 216 MB | ~700 MB |

The 2B answers first on the machine people actually use. The 4B is more accurate, and on the tasks in our 20-task agent eval that difference is real but small (see [code-pack-eval](https://github.com/kslji/synap.ai/blob/main/docs/code-pack-eval.md)). Accuracy still comes before latency, so the 4B stays one click away; it is not the default.

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
- Offline installers are one zip per OS/arch (`-2b-offline.zip`, `-4b-offline.zip`). The 2B zip is 1.59 GB including the 310 MB search model, so it fits one GitHub release asset (< 2 GiB) and one NSIS data block. The 4B zip is 3.05 GB and still goes to the Hugging Face dataset.

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
