# Codemod inventory (offline)

All codemods used by the skill, with exact npm names, invocation, expected output shape, and known caveats. The skill never invents a codemod — only what's listed here.

## React 19 migration recipe

- **Package:** `codemod` (the codemod.com runtime)
- **Invoke:** `npx codemod@latest react/19/migration-recipe`
- **Args:** runs against `process.cwd()`; pass `--target src` to scope.
- **Covers:**
  - `forwardRef` → ref-as-prop rewrite (where safe; HOCs are skipped)
  - `propTypes` and `defaultProps` removal on function components
  - `Context.Provider` → `<Context value=...>`
  - `useFormState` → `useActionState`
  - `<Context.Provider>` JSX rewrite
- **Idempotent:** yes
- **Expected output:** lines like `Modified <path>` and a final summary `Files modified: N`. Stdout is silenced (`2>/dev/null`); the script reports a count.
- **Caveats:** does NOT touch class components; does NOT rewrite test snapshots. Files using `forwardRef` inside a HOC are flagged but not changed.

## React types codemod

- **Package:** `types-react-codemod`
- **Invoke:** `npx types-react-codemod@latest preset-19 <paths...>`
- **Args:** explicit path list (e.g. `./src`).
- **Covers:**
  - `JSX.IntrinsicElements`, `JSX.Element`, `JSX.IntrinsicAttributes` → `React.JSX.*`
  - `useRef<T>()` → `useRef<T>(null)` requirement
  - `ReactElement` default generic narrowing
  - `Component<P>` to remove `propTypes` / `defaultProps` declarations
- **Idempotent:** yes
- **Expected output:** per-file diff summary. Silenced; script reports count.
- **Caveats:** type-only changes; runtime semantics unchanged.

## shadcn CLI

- **Package:** `shadcn`
- **Invoke:**
  - `npx shadcn@latest init` (one-shot, generates `components.json`)
  - `npx shadcn@latest add <primitive...>`
- **Idempotent:** yes (re-running `add` on an existing primitive prompts; pass `--overwrite` or `--yes` to skip)
- **Expected output:** primitive file paths under `src/components/ui/`. Silenced.
- **Caveats:**
  - Use the unprefixed `shadcn` package name; `shadcn-ui` is deprecated.
  - `npx shadcn init` is interactive by default — pass `--yes --defaults --base-color neutral --css-variables` for non-interactive.

## NPM scripts the skill assumes available

In the target repo (after Phase 1 scaffold):

- `npm run build` — `rsbuild build`
- `npm run dev` — `rsbuild dev`
- `npx tsc --noEmit` — type check
- `npx eslint . --max-warnings=N`

In the source repo: never run any source script (read-only).

## Internal codemods (not npm; built into the scripts)

These transformations live inside the `port-*.mjs` scripts and don't shell out:

- **Import rewrites** — driven by `ui-mapping.json` and `i18n-mapping.json`. Implemented via TypeScript Compiler API (`ts.transform`).
- **JSX prop rewrites** — same TS transform pass.
- **`next/*` substitutions** — straight `imports/JSX` rewrite to RR equivalents.
- **App Router file-convention translation** — copies `page.tsx`/`layout.tsx`/etc. into `routes/` while emitting `route.meta.json` for the entrypoint script.
- **Tailwind v3 → v4 config translation** — string-level translation of `tailwind.config.{ts,js}` AST.
- **tsconfig translation** — JSON-level merge with strip/keep rules from `tsconfig-translation.md`.
- **eslint translation** — flat-config emission from legacy or flat input.

## Failure modes

When a codemod fails, the script:

1. Captures stderr to `./.twsp/logs/<script>-<timestamp>.log`.
2. Prints `STOP <one-line-reason>; details: <log-path>`.
3. Exits non-zero.

The agent surfaces the STOP line to the user verbatim.

## Version pinning policy

All codemods are invoked with `@latest` because:

- The corp npm registry mirror serves whatever is current.
- These codemods are well-maintained and forward-compatible (re-running on already-migrated code is a no-op).
- Pinning them would require periodic skill updates to track upstream releases.

If the user reports drift, they can edit the script to pin a specific version (e.g. `codemod@2.x`).
