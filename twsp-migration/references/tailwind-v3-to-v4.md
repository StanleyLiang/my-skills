# Tailwind v3 → v4 translation

## Top-level shape

| v3 | v4 |
|---|---|
| `tailwind.config.{ts,js}` (JS object) | `@theme` block in CSS |
| `@tailwind base; @tailwind components; @tailwind utilities;` | `@import "tailwindcss";` |
| `prefix: "abc-"` | `@import "tailwindcss" prefix(abc);` |
| `important: "#root"` | `@import "tailwindcss" important(#root);` |
| `corePlugins: { ... }` | `@theme { --default-...: initial; }` (disable individual sets via `initial`) |
| `darkMode: "class"` | `@custom-variant dark (&:where(.dark, .dark *));` |
| `theme.extend.colors.brand: "#fff"` | `@theme { --color-brand: #fff; }` |
| `theme.extend.spacing[...]` | `@theme { --spacing-...: ...; }` |
| `theme.extend.fontFamily.sans` | `@theme { --font-sans: ...; }` |
| `content: [...]` | not needed (v4 auto-detects via Vite/PostCSS) |
| `autoprefixer` (PostCSS) | drop (TW4 includes it) |

## Required runtime change

```js
// postcss.config.js (target)
export default { plugins: { '@tailwindcss/postcss': {} } };
```

Drop `tailwindcss` and `autoprefixer` from PostCSS plugins; the new `@tailwindcss/postcss` replaces both for Tailwind processing.

## `@apply` rule

In v4, `@apply` may only be used inside `@layer base`, `@layer components`, or `@layer utilities` blocks. Bare `@apply` at the top of a CSS file is rejected. Translate:

```css
/* v3 */
.btn { @apply px-4 py-2; }

/* v4 */
@layer components {
  .btn { @apply px-4 py-2; }
}
```

## Removed / renamed utilities (high-impact)

| v3 | v4 |
|---|---|
| `bg-opacity-50` | `bg-black/50` (slash syntax) |
| `text-opacity-*`, `border-opacity-*`, `ring-opacity-*` | slash syntax |
| `flex-shrink-*` | `shrink-*` |
| `flex-grow-*` | `grow-*` |
| `overflow-ellipsis` | `text-ellipsis` |
| `decoration-slice` | `box-decoration-slice` |
| `outline-black` (default outline color implicit) | explicit `outline outline-black` |
| arbitrary `[length]` for sizes | now uses `--spacing` scale, but arbitrary values still work |

The `@tailwindcss/upgrade` codemod handles most of these on an existing v3 codebase, but in this skill we are NOT using the in-place upgrade — we are translating the v3 config into a fresh v4 target. The `port-styles.mjs` script reads the v3 source's `tailwind.config.{ts,js}` and emits a v4 `src/index.css` directly.

## CSS variables / `@theme` block translation

```ts
// v3 source
extend: {
  colors: {
    primary: 'hsl(var(--primary))',
    border: 'hsl(var(--border))',
  },
  borderRadius: { lg: 'var(--radius)' },
}
```

```css
/* v4 target — src/index.css */
@theme {
  --color-primary: hsl(var(--primary));
  --color-border: hsl(var(--border));
  --radius-lg: var(--radius);
}
```

The token namespaces v4 recognizes: `--color-*`, `--spacing-*`, `--font-*`, `--text-*`, `--font-weight-*`, `--leading-*`, `--tracking-*`, `--breakpoint-*`, `--container-*`, `--shadow-*`, `--radius-*`, `--ease-*`, `--animate-*`, `--blur-*`, `--default-*`.

## Custom JS plugins

JS plugins (functions that call `addUtilities`/`addComponents`/`matchUtilities`) do not run in v4. Options:

1. Express the plugin's output as plain CSS in an `@layer utilities` block.
2. Use `@plugin '<package>'` directive (v4 supports a small subset of plugin functions).
3. Manual port — log to `MIGRATION_NOTES.md`.

The script never auto-converts JS plugins; it dumps them and STOPs.

## CSS variables Tailwind v4 emits by default

`--default-transition-duration`, `--default-transition-timing-function`, `--default-font-family`, `--default-mono-font-family`. Override via `@theme`.

## `dark:` variant

Default in v4 is `prefers-color-scheme`. To get class-based dark mode (the v3 `darkMode: "class"`), add to CSS:

```css
@custom-variant dark (&:where(.dark, .dark *));
```

The `port-styles.mjs` script auto-emits this if the source's `darkMode` is `"class"` or `"selector"`.
