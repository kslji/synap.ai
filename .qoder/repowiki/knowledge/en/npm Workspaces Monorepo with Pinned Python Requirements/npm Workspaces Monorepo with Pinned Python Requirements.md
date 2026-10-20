---
kind: dependency_management
name: npm Workspaces Monorepo with Pinned Python Requirements
category: dependency_management
scope:
    - '**'
source_files:
    - package.json
    - package-lock.json
    - apps/desktop/package.json
    - apps/web/package.json
    - packages/shared/package.json
    - packages/ui/package.json
    - apps/host/requirements.txt
    - services/api/requirements.txt
    - services/packs/requirements.txt
    - harness/requirements.txt
---

## Approach

The Synap.surf monorepo uses two distinct dependency-management systems:

- **Node.js / TypeScript**: npm workspaces (v1) at the repository root, with a single `package-lock.json` lockfile and per-package `package.json` manifests. No Yarn/PNPM/Bun is used.
- **Python**: Per-directory `requirements.txt` files using exact pinning (`==`) for production dependencies; the harness composes them via `-r` includes.

There is no vendoring of third-party JS/TS code — all packages are resolved from the public npm registry through the workspace hoisting mechanism. Native binaries (llama sidecars, tree-sitter WASM, tessdata, Whisper models) are downloaded at build time by scripts under `apps/desktop/scripts/fetch-*` rather than checked in as source dependencies.

## Key Files

- `package.json` — Root workspace manifest declaring the four workspace members (`apps/desktop`, `apps/web`, `packages/ui`, `packages/shared`), `installConfig.hoistingLimits: "workspaces"`, and the Node engine constraint `>=22`.
- `package-lock.json` — Single deterministic lockfile for the entire JS/TS graph.
- `apps/desktop/package.json` — Electron app manifest; pins every runtime dependency to an exact version (e.g. `electron: 44.7.0`, `better-sqlite3-multiple-ciphers: 13.0.3`, `zod: 4.6.5`).
- `apps/web/package.json` — Vite SPA manifest; depends on `@surf/shared` and `@surf/ui` at `0.1.0`.
- `packages/shared/package.json` — Private package `@surf/shared` exposing `src/index.ts` via `exports`.
- `packages/ui/package.json` — Private package `@surf/ui` with `peerDependencies.react ^19.0.0` and CSS subpath exports (`./tokens.css`, `./components.css`).
- `apps/host/requirements.txt` — Host FastAPI service deps pinned with `==`.
- `services/api/requirements.txt` — API service deps pinned with `==`.
- `services/packs/requirements.txt` — Pack builder deps.
- `harness/requirements.txt` — Test harness that reuses upstream requirements via `-r ../services/packs/requirements.txt` and `-r ../services/api/requirements.txt`.

## Architecture and Conventions

### Workspace layout

```text
package.json (root)
├── apps/desktop   (@surf/desktop) — Electron main + renderer
├── apps/web       (@surf/web)      — Marketing Vite SPA
├── packages/shared (@surf/shared)  — Product metadata, agent catalog types
└── packages/ui    (@surf/ui)       — React components, theme tokens
```

The root `package.json` declares `workspaces` and sets `installConfig.hoistingLimits: "workspaces"`, which tells npm to respect each package's own `node_modules` rather than hoist everything to the root. This keeps native modules (e.g. `better-sqlite3-multiple-ciphers`, `keytar`, `@napi-rs/canvas`) isolated per workspace.

### Internal package resolution

Internal packages are referenced by their published name (`@surf/shared`, `@surf/ui`) at a fixed version (`0.1.0`) in consumers' `dependencies`. The actual linking is done by npm workspaces. For bundler compatibility, both `apps/desktop/electron.vite.config.ts` and `apps/web/vite.config.ts` use `resolve.alias` to map `@surf/ui` and `@surf/shared` directly to their `src/` directories so development builds resolve TypeScript sources instead of compiled output. The same aliases appear in `apps/desktop/tsconfig.web.json` path mappings.

### Versioning strategy

- External JS/TS dependencies are pinned to exact versions in `apps/*/package.json` (no semver ranges in `dependencies`; only `devDependencies` like `eslint`, `typescript-eslint`, `playwright` use caret ranges).
- Python dependencies are pinned with `==` across all `requirements.txt` files.
- Internal packages (`@surf/shared`, `@surf/ui`) are versioned independently but currently stay at `0.1.0` across the repo.
- The root `engines.node` field enforces Node >= 22.

### Lockfiles and registries

- A single `package-lock.json` at the repo root governs the entire JS/TS dependency graph.
- No `.npmrc` file was found, so the default public npm registry is used; there is no private registry or `npm_config_registry` override.
- No `yarn.lock`, `pnpm-lock.yaml`, or `bun.lock` exists.
- No `vendor/` directory or vendored third-party JS/TS code is present.

### CI integration

GitHub Actions workflows under `.github/workflows/` invoke workspace commands via `npm run ... -w @surf/desktop` and `npm run ... -w @surf/web`, confirming the workspace-based build model. There is no explicit `npm ci` step visible in the scanned workflows, so installs rely on the lockfile being committed alongside changes.

### Python composition

The harness `requirements.txt` demonstrates a deliberate reuse pattern: it does not duplicate shared Python deps but includes upstream requirement files via `-r` directives, ensuring the test harness stays in sync with the services it exercises.

## Conventions and Constraints

- All workspace members are declared explicitly in the root `package.json` `workspaces` array; adding a new package requires updating this list.
- Runtime JS/TS dependencies are pinned to exact versions in `apps/*/package.json` `dependencies` (observed across `@codemirror/*`, `electron`, `better-sqlite3-multiple-ciphers`, `zod`, etc.). Dev-only tooling may use caret ranges.
- Internal packages are consumed by name (`@surf/shared`, `@surf/ui`) rather than relative paths, enforcing the workspace contract.
- Bundlers must mirror the workspace aliasing in their config (`@surf/ui`, `@surf/shared` → `../../packages/*/src/...`) because the packages expose `src/` directly via `exports`.
- Python dependencies are pinned with `==` in every `requirements.txt`; the harness composes them via `-r` includes rather than duplicating entries.
- The Node engine is constrained to `>=22` at the repository root.