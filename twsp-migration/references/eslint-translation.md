# ESLint translation (Next → flat config without next/*)

Used by `port-eslint.mjs`. Detects source format (legacy `.eslintrc.*` or flat `eslint.config.*`), produces target `eslint.config.js` (flat).

## Source format detection

Order of preference (first match wins):

1. `eslint.config.js` / `.mjs` / `.cjs` / `.ts` (flat config)
2. `.eslintrc.json` / `.eslintrc.js` / `.eslintrc.cjs` / `.eslintrc.yml`
3. `eslintConfig` field in `package.json`

If none, the script writes a baseline flat config from the template.

## Strip (always)

| Source entry | Reason |
|---|---|
| `extends: "next/core-web-vitals"` | Next preset |
| `extends: "next/typescript"` | Next preset |
| `extends: "next"` | Next preset |
| `plugin:@next/next/recommended` | Next plugin |
| `plugin:@next/next/core-web-vitals` | Next plugin |
| `plugins: ["@next/next"]` (or `"next"`) | Next plugin |
| `eslint-config-next` (devDep) | dropped from package.json |
| `@next/eslint-plugin-next` | dropped from package.json |
| any rule `@next/next/*` | dropped from rules block |

## Replace / set

| Provide | Source for it |
|---|---|
| flat-config preamble (`import js from '@eslint/js'; import tseslint from 'typescript-eslint'; ...`) | template |
| `js.configs.recommended` | from `@eslint/js` |
| `...tseslint.configs.recommended` | from `typescript-eslint` |
| `eslint-plugin-react` recommended | added if source had React rules |
| `eslint-plugin-react-hooks` recommended | always |
| `eslint-plugin-jsx-a11y` recommended | added if source had it OR if `next/core-web-vitals` was extended (which includes a11y) |
| `globals.browser` | always |

## Carry over verbatim

| Source entry | Notes |
|---|---|
| `rules` block (excluding `@next/next/*`) | keep as project-overrides; copy into final `rules` |
| `parserOptions.ecmaVersion`, `sourceType` | keep |
| `settings` (e.g. `react.version`) | keep; default `react.version: 'detect'` |
| custom plugins NOT in the strip list | the script lists them and ASKs the user to confirm they make sense without Next |
| `ignorePatterns` (legacy) → `ignores` (flat) | translate |

## `parser` and `parserOptions.project`

Flat-config equivalent:

```js
languageOptions: {
  parser: tseslint.parser,
  parserOptions: {
    project: ['./tsconfig.json'],
    tsconfigRootDir: import.meta.dirname,
  },
},
```

Source `parserOptions.project` paths are normalized to point at the target `tsconfig.json` (the path may differ between source and target).

## Output shape

```js
// eslint.config.js (flat, target)
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import react from 'eslint-plugin-react';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import globals from 'globals';

export default [
  { ignores: ['dist', 'node_modules', '.twsp', 'src/components/ui/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
      parser: tseslint.parser,
      parserOptions: {
        project: ['./tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { react, 'react-hooks': reactHooks, 'jsx-a11y': jsxA11y },
    settings: { react: { version: 'detect' } },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      // <CARRIED OVER FROM SOURCE>
    },
  },
];
```

## Translation of legacy `extends` strings

| Legacy | Flat replacement |
|---|---|
| `eslint:recommended` | `js.configs.recommended` |
| `plugin:@typescript-eslint/recommended` | `...tseslint.configs.recommended` |
| `plugin:@typescript-eslint/strict` | `...tseslint.configs.strict` |
| `plugin:react/recommended` | `react.configs.recommended` rules block |
| `plugin:react-hooks/recommended` | `reactHooks.configs.recommended` rules |
| `plugin:jsx-a11y/recommended` | `jsxA11y.configs.recommended` rules |
| `plugin:import/recommended` | drop (rsbuild does its own resolution) OR add `eslint-plugin-import` flat plugin |
| `plugin:import/typescript` | same |
| `prettier` | drop (use prettier separately) |

Anything not in this table → STOP and list to the user.

## devDeps update (target package.json)

Drop:
- `eslint-config-next`
- `@next/eslint-plugin-next`

Add (only those that aren't already present):
- `eslint`
- `@eslint/js`
- `typescript-eslint`
- `eslint-plugin-react`
- `eslint-plugin-react-hooks`
- `eslint-plugin-jsx-a11y`
- `globals`

## Lint script

Add to target `package.json`:

```json
{ "scripts": { "lint": "eslint . --max-warnings=0" } }
```

## STOP triggers

- Unknown `extends` entry not in the translation table.
- Custom local config file (referenced via `extends: "./some-config.js"`) — script logs the path and STOPs.
- Any rule using `@next/next/*` namespace that the user has overridden — script lists each, STOPs.
