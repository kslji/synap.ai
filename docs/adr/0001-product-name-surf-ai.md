# ADR 0001 — Product name Surf AI

The verified skeleton and the architecture drafts used the placeholder name Harbor. The product name is Surf AI.

- App id: `ai.surf.desktop` (do not change; updates and keychain items depend on it).
- npm package: `@surf/desktop`. Process name: `SurfAI`. User data folder: `surf-ai`.
- Environment variables: `SURF_*`. `HARBOR_*` is still read so older commands keep working.
- Preload API: `window.surf`.
- Model registry format: `surf-models/1`.
- Pack format: `surf-pack/1`. Manifests that still say `harbor-pack/1` are accepted until the pipeline is renamed on Day 6.
- The code samples under `docs/code-samples/` are the verified reference and still use the old identifiers. The running app is the renamed copy.
