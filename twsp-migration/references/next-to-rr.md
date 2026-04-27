# Next.js → React Router v7 SPA substitutions

## Import substitutions

| Source (Next) | Target (RR v7 SPA) |
|---|---|
| `import Link from 'next/link'` | `import { Link } from 'react-router-dom'` |
| `import Image from 'next/image'` | native `<img>` + TODO |
| `import { Inter } from 'next/font/google'` | `@font-face` in CSS + TODO |
| `import localFont from 'next/font/local'` | `@font-face` in CSS + TODO |
| `import Script from 'next/script'` | inline `<script>` or move to `index.html` |
| `import Head from 'next/head'` | move to `<title>` in route component or use `react-helmet-async` |
| `import { useRouter } from 'next/navigation'` | `import { useNavigate, useLocation } from 'react-router-dom'` |
| `import { usePathname } from 'next/navigation'` | `useLocation().pathname` |
| `import { useSearchParams } from 'next/navigation'` | `import { useSearchParams } from 'react-router-dom'` |
| `import { useParams } from 'next/navigation'` | `import { useParams } from 'react-router-dom'` |
| `import { redirect } from 'next/navigation'` | `import { redirect } from 'react-router-dom'` (loader-only) or `useNavigate()(...)` |
| `import { notFound } from 'next/navigation'` | `throw new Response(null, { status: 404 })` in a loader, or render the not-found route |
| `import { cookies } from 'next/headers'` | **STOP** (server-only) |
| `import { headers } from 'next/headers'` | **STOP** (server-only) |
| `import { draftMode } from 'next/headers'` | **STOP** (server-only) |

## `<Link>` prop deltas

| Next prop | RR equivalent |
|---|---|
| `href` (string) | `to` |
| `href` (object: `{pathname, query}`) | `to={{ pathname, search: '?' + new URLSearchParams(query) }}` |
| `prefetch` | drop (RR has its own prefetch) |
| `replace` | `replace` (same name) |
| `scroll` | drop (RR scrolls via `<ScrollRestoration/>`) |
| `legacyBehavior` | drop |
| `passHref`, `as` | drop |

## `useRouter` method translation

| Next call | RR equivalent |
|---|---|
| `router.push(path)` | `navigate(path)` |
| `router.replace(path)` | `navigate(path, { replace: true })` |
| `router.back()` | `navigate(-1)` |
| `router.forward()` | `navigate(1)` |
| `router.refresh()` | `revalidator.revalidate()` (with data router) or `window.location.reload()` |
| `router.prefetch(path)` | drop (use `<Link prefetch>` features in RR v7) |

## App Router file conventions → RR v7

| App Router file | RR v7 equivalent |
|---|---|
| `app/page.tsx` | route at `/` |
| `app/foo/page.tsx` | route at `/foo` |
| `app/foo/[id]/page.tsx` | route at `/foo/:id` |
| `app/foo/[[...slug]]/page.tsx` | route at `/foo/*` |
| `app/foo/[...slug]/page.tsx` | route at `/foo/*` |
| `app/(group)/page.tsx` | route at `/` (group is layout-only, omitted from path) |
| `app/foo/layout.tsx` | parent route element with `<Outlet/>` |
| `app/foo/loading.tsx` | route's `HydrateFallback` or wrap children in `<Suspense fallback>` |
| `app/foo/error.tsx` | route's `errorElement` |
| `app/foo/not-found.tsx` | sibling route at `*` rendered when nothing matches |
| `app/foo/template.tsx` | wrap `<Outlet/>` in a re-mounting key |
| `app/foo/default.tsx` | (parallel routes — STOP) |
| `app/foo/@slot/page.tsx` | (parallel routes — STOP) |
| `app/foo/(.)bar/page.tsx` | (intercepted routes — STOP) |
| `app/api/**/route.ts` | NOT PORTED |
| `middleware.ts` | STOP and ask user |

## Route metadata (`generateMetadata`, `metadata` export)

Next App Router's static `export const metadata` and dynamic `generateMetadata` do not exist in RR. Convert to one of:

- A `react-helmet-async` `<Helmet>` block inside the route component.
- A `loader` returning `{ title }` plus a small `<Title>` helper that calls `document.title = ...` in `useEffect`.

The `port-routes.mjs` script translates static `metadata` exports into a `<Helmet>` block when `react-helmet-async` is present in target deps; otherwise it emits a TODO.

## `searchParams` and `params` props

```tsx
// Next 14 — sync
export default function Page({ params, searchParams }: { params: { id: string }, searchParams: { q?: string } }) { ... }

// Next 15+ — async (Promise)
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
}
```

Both forms become hooks in RR:

```tsx
// RR
const { id } = useParams<{ id: string }>();
const [searchParams] = useSearchParams();
```

The script rewrites the function signature and inserts the hook calls at the top of the component. `await params`/`await searchParams` are stripped.

## Server-only translations

`getTranslations`, `getFormatter`, `getLocale` from `next-intl/server` STOP. Server actions (`'use server'` files) STOP unless the file is a type-only re-export.
