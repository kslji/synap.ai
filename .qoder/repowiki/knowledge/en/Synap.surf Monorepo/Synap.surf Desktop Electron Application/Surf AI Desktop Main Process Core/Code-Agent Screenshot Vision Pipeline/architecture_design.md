Single flat module under `apps/desktop/src/main/core/vision/` with one public entry point (`service.ts`) that orchestrates a fixed pipeline:
- `intent.ts` classifies screenshot use into `ShotUse` (`error` | `mockup` | `compare` | `describe`) via regexes over user text and image count, and produces prompt templates in `VISION_PROMPTS`.
- `preprocess.ts` sniffs PNG/JPEG/WebP headers, strips JPEG APP1 Exif segments, resizes aspect-preserving to a family-dependent `maxEdge`, and re-encodes to PNG or JPEG until under `maxBytes` (via `@napi-rs/canvas`).
- `ocr-fallback.ts` extracts error lines and decides when OCR alone suffices (`ocrInsteadOfModel`), used as the non-model path.
- `limits.ts` provides per-family byte/edge caps consumed by preprocess.
- `compare.ts` computes pixel diffs between two shots for the `compare` use case.
- `runtime.ts` detects llama.cpp `--mmproj` / libmtmd support from help text and drives the load decision (`MmprojReason: on|runtime|missing|ram|blocked`) plus retry ordering after failures.
- `offer.ts` gates whether Settings may offer the Qwen3.5 Code mmproj add-on based on family, agent, RAM fit (`codeFileCapBytes` + `modelFitsLaptop`), and installed state.

Dependency direction is strictly inward: `service.ts` depends on all peers; peers depend only on `limits.ts` and shared desktop modules (`../../../shared/code-ram.js`, `../model-registry.js`, `../live/policy.js`). The multimodal `describe` function is injected via the `input.describe` callback so this module never calls an LLM itself — it only prepares images and prompts.