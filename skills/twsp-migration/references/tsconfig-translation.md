# tsconfig translation (Next → rsbuild SPA)

Used by `port-tsconfig.mjs`. Reads `<sourceRoot>/tsconfig.json` (resolving the `extends` chain), produces `<targetRoot>/tsconfig.json`.

## Strip (always)

| Field | Reason |
|---|---|
| `extends: "next/core-web-vitals"` | Next preset; not applicable |
| `extends: "next/typescript"` | Next preset; not applicable |
| `compilerOptions.plugins[*].name === "next"` | Next TS plugin; not applicable |
| `compilerOptions.jsx: "preserve"` | Next-specific; target uses `"react-jsx"` |
| `compilerOptions.incremental` | rsbuild manages; remove |
| `compilerOptions.tsBuildInfoFile` | tied to `incremental` |
| `compilerOptions.noEmit: false` (if set) | force `true` |
| `include` entries: `".next/types/**/*.ts"`, `"next-env.d.ts"`, `"app/**"` | Next-specific paths |
| `compilerOptions.types` entries: `"next"`, `"@next/*"` | drop |

## Set (always)

| Field | Value |
|---|---|
| `compilerOptions.jsx` | `"react-jsx"` |
| `compilerOptions.module` | `"ESNext"` |
| `compilerOptions.moduleResolution` | `"Bundler"` |
| `compilerOptions.target` | `"ES2022"` if absent |
| `compilerOptions.lib` | `["DOM", "DOM.Iterable", "ES2022"]` if absent |
| `compilerOptions.noEmit` | `true` |
| `compilerOptions.allowImportingTsExtensions` | `false` (rsbuild bundles) |
| `compilerOptions.isolatedModules` | `true` |
| `compilerOptions.esModuleInterop` | `true` |
| `compilerOptions.skipLibCheck` | `true` |
| `compilerOptions.resolveJsonModule` | `true` |
| `compilerOptions.useDefineForClassFields` | `true` |
| `include` | `["src", "index.html"]` |
| `exclude` | `["node_modules", "dist"]` |

## Carry over verbatim (preserve from source)

| Field | Notes |
|---|---|
| `compilerOptions.paths` | aliases — keep verbatim |
| `compilerOptions.baseUrl` | typically `"."` — keep |
| `compilerOptions.strict` | usually `true` — keep |
| `compilerOptions.noUncheckedIndexedAccess` | keep if set |
| `compilerOptions.noImplicitOverride` | keep |
| `compilerOptions.noFallthroughCasesInSwitch` | keep |
| `compilerOptions.exactOptionalPropertyTypes` | keep |
| `compilerOptions.verbatimModuleSyntax` | keep |
| `compilerOptions.forceConsistentCasingInFileNames` | keep |
| `compilerOptions.types` | keep entries that are NOT next-related (e.g. `"vite/client"` becomes `"@rsbuild/core/types/client"` — but only if the source already had a Vite-style entry) |

## Resolving the `extends` chain offline

Next.js ships these well-known bases (all bundled with the corresponding Next major in node_modules):

- `next/core-web-vitals` (extends `next/babel` + ESLint config — but tsconfig version mostly empty for ts; mainly used by ESLint). **Drop.**
- `next/typescript` — sets `jsx: "preserve"`, `plugins: [{ name: "next" }]`, `strict`, `module: "ESNext"`, `moduleResolution: "Bundler"`, `allowJs: true`, `noEmit: true`, `incremental: true`, `target: "ES2022"`, `isolatedModules: true`, `esModuleInterop: true`, `forceConsistentCasingInFileNames: true`, `resolveJsonModule: true`, `skipLibCheck: true`. **Strip Next-specific bits, keep the rest.**

If the source extends a non-Next base (e.g. `@tsconfig/node20`, internal company shared config), preserve the `extends` field verbatim unless the user instructs otherwise.

## Path alias mirror to rsbuild

For each entry in `compilerOptions.paths`, mirror to `rsbuild.config.ts` `source.alias`:

```ts
// tsconfig
{ "paths": { "@/*": ["./src/*"], "@/lib/*": ["./src/lib/*"] } }

// rsbuild
{ source: { alias: { "@": "./src", "@/lib": "./src/lib" } } }
```

The `port-tsconfig.mjs` script writes both files in sync.

## Project references

If source uses `references: [...]` (TypeScript project references), the script logs a STOP — those need manual migration based on the team's monorepo layout.

## Output

After translation, the script writes:

- `<targetRoot>/tsconfig.json` (merged final)
- A note in `<targetRoot>/MIGRATION_NOTES.md` listing every option that was stripped, kept, or set, so the user can audit.
