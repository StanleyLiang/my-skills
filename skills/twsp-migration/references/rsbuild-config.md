# Rsbuild config (target)

## Minimal `rsbuild.config.ts`

```ts
import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';

export default defineConfig({
  plugins: [pluginReact()],
  html: {
    template: './index.html',
  },
  source: {
    alias: {
      '@': './src',
    },
  },
  server: {
    port: 3000,
    strictPort: false,
  },
  output: {
    target: 'web',
    distPath: { root: 'dist' },
  },
});
```

## PostCSS / Tailwind v4 wiring

Rsbuild auto-discovers `postcss.config.{js,mjs,cjs}` at the project root. With Tailwind v4:

```js
// postcss.config.js
export default { plugins: { '@tailwindcss/postcss': {} } };
```

Then `import './index.css'` from `src/main.tsx`. No extra rsbuild config needed.

## Path aliases (mirror tsconfig `paths`)

If source's tsconfig has:

```json
{ "compilerOptions": { "paths": { "@/*": ["./src/*"], "@/lib/*": ["./src/lib/*"] } } }
```

Then `rsbuild.config.ts` should declare:

```ts
source: {
  alias: {
    '@': './src',
    '@/lib': './src/lib',
  },
},
```

The `port-tsconfig.mjs` script writes the matching aliases into `rsbuild.config.ts` automatically.

## SVG / asset handling

Rsbuild defaults work for images, fonts, JSON. For SVG-as-React-component:

```ts
import { pluginSvgr } from '@rsbuild/plugin-svgr';

plugins: [pluginReact(), pluginSvgr({ svgrOptions: { exportType: 'default' } })],
```

Add `@rsbuild/plugin-svgr` to devDeps if source uses `import { ReactComponent as ... } from './foo.svg'` or default-imports SVG as a component.

## Dev proxy (replacing Next route handlers)

If the source had `app/api/**/route.ts` proxying to a real backend, the SPA target should proxy in dev:

```ts
server: {
  proxy: {
    '/api': { target: 'http://localhost:8080', changeOrigin: true },
  },
},
```

The `scaffold-target.mjs` script does NOT add this automatically (it doesn't know the backend URL). Logged in `MIGRATION_NOTES.md`.

## TypeScript config integration

Rsbuild does not type-check by default. Add a separate `tsc` step in `package.json`:

```json
{
  "scripts": {
    "dev": "rsbuild dev",
    "build": "rsbuild build",
    "preview": "rsbuild preview",
    "typecheck": "tsc --noEmit",
    "lint": "eslint . --max-warnings=0"
  }
}
```

Or enable `@rsbuild/plugin-type-check`.

## Environment variables

Rsbuild exposes `process.env.PUBLIC_*` and any var matching `source.define`. Migration of Next's `NEXT_PUBLIC_*`:

```ts
// rsbuild.config.ts
source: {
  define: Object.fromEntries(
    Object.entries(process.env)
      .filter(([k]) => k.startsWith('NEXT_PUBLIC_'))
      .map(([k, v]) => [`process.env.${k}`, JSON.stringify(v)])
  ),
},
```

Or rename to `PUBLIC_*`. The skill's `port-rest.mjs` rewrites `process.env.NEXT_PUBLIC_X` references and emits a TODO for the user to choose.

## Output base path / public path

```ts
output: { assetPrefix: '/static/', distPath: { root: 'dist' } },
```

Mirror the source's `next.config.ts` `basePath` / `assetPrefix` if set.

## Source maps

Default in dev. For prod:

```ts
output: { sourceMap: { js: 'source-map' } },
```
