---
kind: frontend_style
name: CSS-in-JS via Tailwind + Shared Design Tokens in @surf/ui
category: frontend_style
scope:
    - '**'
source_files:
    - packages/ui/src/tokens.css
    - packages/ui/src/components.css
    - packages/ui/src/theme.ts
    - apps/desktop/src/renderer/src/styles.css
    - apps/web/src/styles.css
    - apps/web/src/marketing.css
    - apps/desktop/electron.vite.config.ts
    - apps/web/vite.config.ts
---

## Approach

The Synap.surf monorepo styles its two frontends — the Electron desktop renderer (`apps/desktop/src/renderer`) and the marketing Vite SPA (`apps/web/src`) — with a shared, token-driven CSS system built on top of **Tailwind CSS v4** (`@import "tailwindcss"`), plain `.css` files, and a private `@surf/ui` package that centralizes design tokens, component primitives, and theme/runtime helpers.

There is no SCSS, Sass, PostCSS custom pipeline, or CSS-in-JS library (styled-components, Emotion, etc.). Styles are authored as conventional CSS modules scoped to each app, while cross-app visual identity lives in `packages/ui/`.

## Key Files

- `packages/ui/src/tokens.css` — single source of truth for all color, spacing, radius, font, shadow, and semantic variables (`--bg`, `--ink`, `--accent`, `--accent-text`, `--bubble-user`, …). Defines light/dark palettes, four accent variants (`orange|blue|indigo|navy`) via `[data-accent=...]`, and density variants (`compact|relaxed`) via `[data-density=...]`. Includes WCAG contrast commentary.
- `packages/ui/src/components.css` — shared primitive classes: `.btn`, `.btn-primary`, `.btn-ghost`, `.card`, `.pill`, `.field`, `.toggle`, `.progress`, `.theme-switch`, `.reply-markdown`, `.code-block`, `.parallax-layer`.
- `packages/ui/src/theme.ts` — runtime theme switcher: reads/persists `surf-theme` in `localStorage`, writes `document.documentElement.dataset.theme = 'light'|'dark'`, exposes `readThemeChoice`, `applyThemeChoice`, `persistThemeChoice`, `themeSwitchChoice`.
- `packages/ui/src/theme-boot.js` — early boot script (copied into both apps) that applies the persisted theme before paint.
- `apps/desktop/src/renderer/src/styles.css` — desktop entry stylesheet; imports Tailwind + `@surf/ui/tokens.css` + `@surf/ui/components.css` + `./file-search.css`; defines ~800 lines of app-specific layout (shell, compose, chat bubbles, settings, usage charts, hardware tiles).
- `apps/web/src/styles.css` — marketing entry stylesheet; same import chain plus `./marketing.css` (~100 lines of site header, hero wash, parallax, reveal animations).
- `apps/desktop/electron.vite.config.ts` & `apps/web/vite.config.ts` — both configure `@tailwindcss/vite` plugin and alias `@surf/ui/*` → `../../packages/ui/src/*` so both apps resolve the same token/component CSS from the shared package.

## Architecture & Conventions

1. **Token-first CSS.** All colors, radii, shadows, fonts, and semantic roles flow through CSS custom properties in `tokens.css`. Component and page CSS never hard-codes hex values except where explicitly documented (e.g. dark-mode overrides for `.icon-tile.is-violet`).
2. **Theme switching via `data-*` attributes.** The active theme is expressed as `:root[data-theme="light"]` / `:root[data-theme="dark"]`; accent palette as `:root[data-accent="..."]`; density as `:root[data-density="..."]`. Theme state is persisted under the key `surf-theme` in `localStorage`.
3. **Shared UI package.** Both apps consume `@surf/ui` through Vite aliases pointing at `packages/ui/src/`. The package exports React components (`BlobMascot`, `ThemeSwitch`, Markdown renderer) alongside the CSS and theme utilities.
4. **Tailwind v4 composition.** Apps use `@import "tailwindcss"` (the new v4 syntax) rather than a `tailwind.config.*` file; utility classes are composed directly in JSX/CSS. App-specific styles live in per-app `.css` files imported from the root stylesheet.
5. **Component class naming.** Shared primitives use BEM-like single-class names (`.btn`, `.card`, `.pill`, `.field`, `.toggle`, `.progress`, `.theme-switch`). App-specific classes use kebab-case (`.shell-compose`, `.chat-row`, `.account-menu`, `.site-header`, `.hero-wash`).
6. **Accessibility patterns.** Focus rings consistently use `outline: 2px solid var(--accent-text); outline-offset: 2px` on interactive elements. A `.skip-link` class exists in the marketing site. `prefers-reduced-motion` media queries disable transitions/animations across both apps.
7. **Color semantics.** The token comment documents WCAG AA targets: orange `#F97316` is the sole brand accent, used sparingly; white-on-orange text is avoided (contrast 2.8:1). Muted text, focus rings, success/warn states all derive from the token set.
8. **Parallax/mascot effects.** The `@surf/ui` package ships a `parallax` CSS system (`.parallax`, `.parallax-layer` with `--depth`/`--tilt` CSS vars) and a JS hook (`useParallax`) consumed by the marketing hero.

## Conventions Observed

- Every app's root stylesheet begins with the same three imports: `tailwindcss`, `@surf/ui/tokens.css`, `@surf/ui/components.css`, then an app-local CSS file.
- Theme/accent/density are controlled exclusively through `data-*` attributes on `:root`; no JS-based style injection beyond setting those attributes.
- Accent variants are limited to the four declared in `tokens.css`: default orange, blue, indigo, navy.
- Density variants are limited to `compact` (radius 12px) and `relaxed` (radius 20px), overriding the default `--radius: 16px`.
- Animations are guarded by `@media (prefers-reduced-motion: reduce)` blocks in both `styles.css` files and in `components.css`.
- The desktop app uses Playwright visual regression snapshots under `apps/desktop/e2e/snapshots/` (paired `-dark.png` / `-light.png` files) to lock the rendered appearance of themes and UI rows.
- The marketing site's `marketing.css` and desktop's `styles.css` keep all layout/animation rules in plain CSS rather than inline styles or styled-components.

## Rules Enforced by Source

- **Theme persistence key:** `THEME_STORAGE_KEY = 'surf-theme'` is the only key written to `localStorage` for theme state (`packages/ui/src/theme.ts`).
- **Theme attribute:** `applyThemeChoice` sets `document.documentElement.dataset.theme` to exactly `'light'` or `'dark'` — no other values are valid (`packages/ui/src/theme.ts`).
- **Accent selector scope:** Only `data-accent="blue|indigo|navy"` selectors exist in `tokens.css`; adding a new accent requires editing that file (`packages/ui/src/tokens.css`).
- **Density selector scope:** Only `data-density="compact|relaxed"` selectors exist in `tokens.css`; the default radius is `16px` (`packages/ui/src/tokens.css`).
- **Vite alias contract:** Both `electron.vite.config.ts` and `vite.config.ts` alias `@surf/ui/tokens.css`, `@surf/ui/components.css`, and `@surf/ui` to the same `packages/ui/src/*` paths — importing these identifiers from any app resolves the shared package, not a local copy.