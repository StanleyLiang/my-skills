# `next-intl` surface area (input catalog)

Used by `build-i18n-mapping.mjs` to enumerate the symbols the user's spec for the new intl package must cover. Anything used in source that the spec does not cover becomes a "gap" the user has to address before approval.

## Client hooks (need a 1:1 mapping in the new package)

| Symbol | Shape | Common usage |
|---|---|---|
| `useTranslations(namespace?)` | `(key: string, values?: Record<string, unknown>) => string` | `const t = useTranslations('home'); t('title')` |
| `useFormatter()` | object with `dateTime`, `number`, `relativeTime`, `list` methods | `f.dateTime(d, { dateStyle: 'short' })` |
| `useLocale()` | `() => string` | `const locale = useLocale()` |
| `useTimeZone()` | `() => string` | `const tz = useTimeZone()` |
| `useNow({ updateInterval })` | `() => Date` | live-updating "now" |
| `useMessages()` | `() => Messages` | raw access (rare) |

## Server helpers — STOP in SPA target

These have no client equivalent in an SPA (no server runtime). The script flags every occurrence as STOP for user decision (drop, hand-port to a client equivalent, or move to a backend):

- `getTranslations(namespace?)` from `next-intl/server`
- `getFormatter()`
- `getLocale()`
- `getNow()`
- `getMessages()`
- `getTimeZone()`
- `getRequestConfig` (used in `i18n/request.ts`)
- `setRequestLocale`

## Provider

```tsx
import { NextIntlClientProvider } from 'next-intl';

<NextIntlClientProvider messages={messages} locale={locale} timeZone={tz} now={now}>
  {children}
</NextIntlClientProvider>
```

Mapping: the spec must declare a provider component for the new package, with its prop shape (`messages`, `locale`, possibly `timeZone`, `now`, `formats`).

## Routing

next-intl supports three routing strategies:

1. **`as-needed` / `always` prefix** — pathname-based, e.g. `/en/about`, `/zh/about`. Implemented via the `[locale]` dynamic segment in the App Router.
2. **Domain** — `en.example.com`, `zh.example.com`. Implemented via middleware.
3. **Cookie / Accept-Language** — no URL change. Implemented via middleware reading the cookie.

In an SPA the equivalent client-side strategies are:

- `pathname` — keep `/:locale/...` in the React Router tree; switching locale uses `navigate(`/${newLocale}${rest}`)`.
- `subdomain` — derive locale from `window.location.hostname`. Provider reads it.
- `queryparam` — `?locale=en`. Provider reads `useSearchParams`.
- `context-only` — locale lives in React state / localStorage; URL is locale-free.

The user's spec must pick exactly one. The mapping JSON's `localeRouting` field stores the choice.

## `[locale]` segment translation

When `audit.hasLocaleSegment === true`, the source has routes shaped like `app/[locale]/foo/page.tsx`. `port-routes.mjs` translates these:

- `pathname` strategy → keep `:locale` as the first param of every route. Wrap RR `<RouterProvider>` with the new package's provider, reading `useParams().locale`.
- Other strategies → drop the `[locale]` segment from the route path entirely; provider reads locale from its source.

## Middleware

`middleware.ts` typically calls `createMiddleware` from `next-intl/middleware`. **Always STOP** — the skill never auto-converts it. The user must decide:

- For `pathname` strategy: a client-side default-locale redirect at the `/` route is sufficient (`if (!params.locale) navigate('/en')`).
- For domain / cookie strategies: the new intl package's spec needs to describe how its provider derives locale, and any auth/header behavior previously in middleware must be migrated separately.

## Messages file format

next-intl supports flat or nested JSON namespaces:

```json
{ "home": { "title": "Hello", "subtitle": "..." } }
```

with ICU placeholders `{name}`, plurals `{count, plural, ...}`, select, etc.

The new package's spec must declare:

- File location (e.g. `messages/<locale>.json`).
- Namespace shape (flat vs nested).
- Placeholder syntax (ICU? Mustache `{{name}}`? Different?).
- How messages are loaded at runtime (statically imported, dynamic import per locale, fetched).

The mapping JSON's `messageFormat` and the `messages-loader-snippet` (if the spec provides one) are used by `wire-entrypoint.mjs` to wire the provider.

## Translation function call shape

`useTranslations` returns `t(key, values?)`. If the new package returns a different shape (e.g. `t({ key, ...values })` or `t.path(values)`), the i18n mapping must encode that as a `callShape`:

```json
{
  "symbol": "useTranslations",
  "replacement": {
    "importPath": "@new-intl/react",
    "exportName": "useT",
    "isHook": true,
    "callShape": "function-positional",  // or "function-object" or "path-accessor"
    "namespaceMode": "argument" | "prefix-key" | "none"
  }
}
```

The script applies the shape during JSX rewrites in Phase 4.

## Gaps the script reports

After parsing the spec, the script greps the source for every `next-intl` symbol used and lists any that the spec does not cover. The user must amend the spec OR explicitly mark them as `DROP` / `STOP` before approving.
