---
name: twsp-migration
description: Use when porting an internal frontend project from a Next.js source repo into an rsbuild target repo, applying these five upgrades during the port — React 17/18 → React 19, Tailwind 3 → Tailwind 4 CSS-first, Next.js App Router → rsbuild + React Router, in-house UI package → shadcn/ui, next-intl → a new (spec-supplied) intl package. Auto-invoke when the user mentions porting a Next.js app to rsbuild, scaffolding a new SPA from a Next codebase, or migrating off Next.js. Asks for sourceRoot and targetRoot up front; auto-detects npm/pnpm/yarn workspaces in source and picks the package containing the Next app (or accepts `--app-package <relpath>` if multiple match); accepts an already-initialized npm project as targetRoot and merges into it instead of demanding emptiness. Asks for the in-house UI spec markdown if the source uses the in-house package; asks for the new intl package's spec markdown if the source uses next-intl. Walks an ordered phased playbook with verification gates, STOPs on middleware and server-only APIs, and skips port-tasks that are not present in the source.
---

# twsp-migration

Port a Next.js source repo into a new rsbuild + React Router target repo, applying React 19, Tailwind 4, shadcn, and a new intl package along the way. Designed for ~12k token sessions: one tiny step per session, resumable from `./.twsp/state.json`.

## Session protocol (do this every session)

1. **Confirm inputs.** If `./.twsp/migration.json` exists, read `sourceRoot`, `targetRoot`, and `appPackageRoot` from it. Otherwise ask the user for `sourceRoot` and `targetRoot`, then run:
   ```sh
   node $SKILL/scripts/audit.mjs --source <sourceRoot> --target <targetRoot>
   ```
   The audit auto-detects workspaces (npm `workspaces`, pnpm-workspace.yaml, yarn) and locates the package containing the Next app. If multiple workspace packages contain a Next app, it STOPs and asks for `--app-package <relpath>`. If `targetRoot` already has a `package.json`, the audit treats it as initialized (merge mode) — it only STOPs if target has `next`/`vite`/`webpack` in deps (conflicting bundlers).
   (`$SKILL` = `skills/twsp-migration` — substitute the absolute path.)

2. **Run the dispatcher.** This is the single source of truth for what to do this session:
   ```sh
   node $SKILL/scripts/next.mjs
   ```
   It reads `./.twsp/state.json` and prints exactly one directive, ≤200 tokens.

3. **Execute the directive.** One of:
   - `RUN <cmd...>` — run that exact command. Quote stdout back to the user (≤200 tokens). On non-zero exit, STOP.
   - `ASK <prompt-file> <answer-file>` — read the prompt file (≤1k tokens), pose it to the user verbatim, write their answer (path or pasted markdown) to the answer file.
   - `COMMIT <message>` — `git -C <targetRoot> add -A && git -C <targetRoot> commit -m "<message>"`.
   - `DONE` — migration finished. Tell the user, exit.

4. **Advance the state machine:**
   ```sh
   node $SKILL/scripts/next.mjs --advance
   ```

5. **Loop or exit.** If `--advance` prints another directive AND your cumulative session tokens are still under ~8k, loop back to step 3. Otherwise stop and let the next session resume.

## Hard rules

- Never read or write project source/target files directly. Every read or transform happens inside a script. Your job is dispatch + commit + ask.
- Never invent commands. Only run what `next.mjs` told you to.
- Never skip a STOP. If a script exits non-zero, surface the `STOP <reason>` line and stop.
- Never modify the source repo. The skill writes to `targetRoot` and to `./.twsp/` only.
- Never use `WebFetch` / `WebSearch`. All references are local under `references/`.

## Scope

**In scope (ported):** React components, pages, layouts, loading/error/not-found, route groups, dynamic segments, lib/hooks/store/types/utils, locale message files, Tailwind config, tsconfig, eslint config.

**Out of scope (NOT ported):** RSC directives (`'use server'`, server actions), `app/api/**` route handlers, `next/image`, `next/font`, server-only APIs (`cookies()`, `headers()`, `draftMode()`), `getTranslations`/`getFormatter` (server intl), legacy `pages/` router, parallel routes (`@slot`), intercepted routes (`(.)folder`).

**Deferred (STOP and ask):** `middleware.ts*`. The skill never auto-converts middleware.

## Phase index

| Phase | Name | Key script | What it does |
|---|---|---|---|
| 0 | Audit source | `audit.mjs` | Detect versions, in-house pkg, next-intl, STOP risks |
| 1 | Scaffold target | `scaffold-target.mjs` | New rsbuild SPA at targetRoot with React 19 + TW4 + shadcn |
| 2a | Port styles | `port-styles.mjs` | Translate TW3 config + globals → TW4 CSS-first |
| 2b | Port tsconfig | `port-tsconfig.mjs` | Strip Next plugin, preserve paths/strict |
| 2c | Port eslint | `port-eslint.mjs` | Legacy/flat → flat without next/* |
| 3a | UI mapping | `build-shadcn-mapping.mjs` | Spec-driven in-house → shadcn map (ASK first) |
| 3b | i18n mapping | `build-i18n-mapping.mjs` | Spec-driven next-intl → new pkg map (ASK first) |
| 4a | Port components | `port-components.mjs` | Copy components with mappings + React 19 codemods (queued) |
| 4b | Port routes | `port-routes.mjs` | Copy `app/**` → `src/routes/**`, RR-ify (queued) |
| 4c | Port rest | `port-rest.mjs` | Copy lib/hooks/store/types + locale messages (queued) |
| 5 | Wire entrypoint | `wire-entrypoint.mjs` | Generate `src/main.tsx`, final verify |

Per-phase narrative lives in `references/phases.md`. `next.mjs` quotes the relevant section into stdout when context is needed; do not auto-load.

## Reference index

- `references/tailwind-v3-to-v4.md` — TW v4 CSS-first, prefix/important, `@apply` rules, removed utilities.
- `references/react-19-breaking.md` — `forwardRef`, `propTypes`, `JSX.*`, `useRef`, Context API.
- `references/next-to-rr.md` — `next/image`, `next/font`, `next/link`, `next/navigation`, App-Router-file-conventions → RR v7.
- `references/rsbuild-config.md` — minimal `rsbuild.config.ts`, PostCSS wiring, alias mapping.
- `references/react-router-v7-spa.md` — `createBrowserRouter`, hooks, v6→v7 deltas.
- `references/shadcn-catalog.md` — primitive list + prop signatures (offline).
- `references/next-intl-patterns.md` — next-intl symbols + routing strategies.
- `references/codemod-inventory.md` — npm names, versions, expected output, caveats.
- `references/tsconfig-translation.md` — strip/keep tables for tsconfig.
- `references/eslint-translation.md` — legacy → flat config rewrite, next/* → generic equivalents.
- `references/phases.md` — per-phase narrative; `next.mjs` quotes from this on demand.

## STOP triggers (the script will print exactly one)

- Working tree dirty or `targetRoot` non-empty (Phase 0).
- Source has no `app/` directory or has legacy `pages/` (Phase 0).
- `middleware.ts*` present (Phase 4b).
- Server-only API usage: `cookies()`, `headers()`, `draftMode()`, `'use server'` action files, `getTranslations`, `getFormatter` (Phase 4).
- `experimental.ppr` enabled in `next.config.ts` (Phase 4b, Next 16).
- Parallel/intercepted routes (Phase 4b).
- In-house UI component without a spec entry; next-intl symbol without a mapping entry (Phase 3, Phase 4a).
- Custom Tailwind JS plugin with no v4 equivalent (Phase 2a).
- Codemod recipe failed or peer-deps incompatible third party (Phase 4a).

## When you finish

When `next.mjs` prints `DONE`, tell the user the migration is complete and point them to `<targetRoot>/MIGRATION_NOTES.md` for any TODOs the scripts emitted (image strategy, font strategy, manual Tailwind plugins, etc.).
