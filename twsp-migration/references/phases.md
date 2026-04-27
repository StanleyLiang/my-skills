# Phases — narrative reference

`next.mjs` quotes the relevant section into stdout when context is needed. Not auto-loaded by the agent.

## Phase 0 — Audit source

Reads `<sourceRoot>` and emits:

- `<sourceRoot>/.twsp/audit.json` — facts about the source
- `<sourceRoot>/.twsp/migration.json` — `{ sourceRoot, targetRoot, createdAt }`
- `<sourceRoot>/.twsp/state.json` — `{ phase: "1", step: "scaffold", ... }`

Detects: React/Next/Tailwind versions, in-house pkg presence, shadcn presence, next-intl presence, middleware, `app/api/**` count, `next/image`/`next/font` hits, `'use server'` hits, sync vs async `cookies()`/`headers()`, `[locale]` segment presence, legacy `pages/` directory.

STOP triggers:
- `targetRoot` non-empty (script will not overwrite an existing target).
- `pages/` directory present (legacy router not in scope).
- No `app/` directory (nothing to port).

## Phase 1 — Scaffold target

Runs only after `audit.json` exists. Materializes `<targetRoot>` from templates:

- `package.json` with React 19, Tailwind 4, RR 7, rsbuild, shadcn, eslint
- `rsbuild.config.ts`, `tsconfig.json`, `index.html`, `eslint.config.js`, `postcss.config.js`, `.gitignore`
- `src/main.tsx` (placeholder router with no routes)
- `src/index.css` (`@import "tailwindcss";` only — `@theme` filled in 2a)
- `src/App.tsx` placeholder
- `git init`

Then `npm install` and `npx shadcn@latest init --yes --defaults --base-color neutral --css-variables`.

Auto-verify: `npx tsc --noEmit && npm run build` — empty SPA must build green.

## Phase 2a — Port styles

Reads `<sourceRoot>/tailwind.config.{ts,js,cjs}` and any `globals.css` / `index.css` in source. Translates the v3 config and writes `<targetRoot>/src/index.css`:

- `@import "tailwindcss"` with `prefix(...)` and `important(...)` from source.
- `@theme` block with `--color-*`, `--spacing-*`, etc. translated from `theme.extend`.
- `@custom-variant dark` if source `darkMode` is class/selector.
- `@layer base/components/utilities` blocks copied from source globals.

Also updates `<targetRoot>/components.json` `prefix` to match source.

## Phase 2b — Port tsconfig

Reads source tsconfig (resolving extends chain). Writes target tsconfig per the strip/keep/set tables in `tsconfig-translation.md`. Mirrors `paths` into `rsbuild.config.ts` `source.alias`.

## Phase 2c — Port eslint

Reads source eslint config (legacy or flat). Writes target flat config. Drops `next/*`, adds typescript-eslint + react-hooks + react + jsx-a11y. Carries over custom rules. Updates target devDeps.

## Phase 3a — UI mapping

Only if `audit.requiresUiSpec`. ASK directive to user → user pastes/links spec MD. Script parses, builds `ui-mapping.json`. Prints mapping table for review. Agent waits for explicit approval (a second ASK).

## Phase 3b — i18n mapping

Only if `audit.requiresI18nSpec`. Same pattern. Script also greps source for next-intl symbols and lists gaps the spec doesn't cover.

## Phase 4a — Port components

Builds a queue of source component files. Per session, processes one file:

1. Parses with TS Compiler API.
2. Rewrites imports per UI mapping + i18n mapping.
3. Rewrites JSX tags + props per UI mapping.
4. Rewrites i18n hook calls per i18n mapping.
5. Rewrites `next/*` imports per `next-to-rr.md` table.
6. Writes the file to `<targetRoot>/src/components/...`.

After every N files OR at end of queue, runs `npx codemod react/19/migration-recipe` and `npx types-react-codemod preset-19` on the target tree.

Before the queue starts, runs `npx shadcn@latest add <list>` for primitives named in the UI mapping.

## Phase 4b — Port routes

Walks `<sourceRoot>/app/**`. Per session, processes one route file:

- `page.tsx` → `<targetRoot>/src/routes/.../page.tsx` + `route.meta.json`
- `layout.tsx` → `_layout.tsx` + meta
- `loading.tsx` → wired into parent layout's `<Suspense>` via meta
- `error.tsx` → meta `errorElement`
- `not-found.tsx` → meta `*` route
- `route.ts` (api) → skipped, logged
- `template.tsx` → wrapped via meta `key`
- `default.tsx` / `@slot/` / `(.)folder/` → STOP

Hook/component substitutions per `next-to-rr.md`. Async `params` / `searchParams` rewrite to RR hooks. STOP on middleware, server-only APIs, PPR.

## Phase 4c — Port rest

Queues `<sourceRoot>/{lib,hooks,store,types,utils,constants}/**`. Same per-file pipeline. Locale message files copied or transformed per i18n mapping's `messageFormat`.

## Phase 5 — Wire entrypoint

Reads `<targetRoot>/src/routes/**/route.meta.json`, builds a `RouteObject[]` tree, writes `<targetRoot>/src/routes.gen.ts` and the final `<targetRoot>/src/main.tsx` (with intl provider wrapping if applicable).

Final auto-verify: `npx tsc --noEmit && npm run build && npm run dev` (smoke).

## What each phase commits

- Phase 0: nothing (target doesn't exist yet).
- Phase 1: `chore(twsp): scaffold rsbuild + React 19 + Tailwind 4 + shadcn baseline`.
- Phase 2a: `feat(twsp): port styles to Tailwind v4 CSS-first config`.
- Phase 2b: `feat(twsp): port tsconfig (strip Next plugin, preserve paths and strict flags)`.
- Phase 2c: `feat(twsp): port eslint (flat config, drop next/*, preserve custom rules)`.
- Phase 3: `chore(twsp): record approved UI and i18n mappings`.
- Phase 4a: `feat(twsp): port components batch <N>` (per batch).
- Phase 4b: `feat(twsp): port routes batch <N>`.
- Phase 4c: `feat(twsp): port lib/hooks/store/types and locale messages`.
- Phase 5: `feat(twsp): wire entrypoint and finalize SPA build`.
