# React 19 breaking changes (porting impact)

## Removed APIs

| Removed | Replacement |
|---|---|
| `propTypes` on function components | TypeScript types |
| `defaultProps` on function components | JS default args |
| `Context.Provider` (still works but deprecated) | `<Context value={...}>` |
| String refs (`ref="myRef"`) | Callback refs / `useRef` |
| Module pattern factories | Standard function components |
| `react-dom/test-utils` `act` | `react` `act` |
| `react-test-renderer/shallow` | `react-shallow-renderer` |
| Legacy context (`contextTypes`) | `useContext` |

## `forwardRef` deprecation

Refs are now plain props on function components.

```tsx
// React 18
const Button = forwardRef<HTMLButtonElement, Props>((props, ref) => (
  <button ref={ref} {...props} />
));

// React 19
const Button = ({ ref, ...props }: Props & { ref?: Ref<HTMLButtonElement> }) => (
  <button ref={ref} {...props} />
);
```

`forwardRef` still works in React 19 for backward compat, but the codemod (`react/19/migration-recipe`) rewrites most call sites.

## `useRef` requires explicit initial argument

```tsx
// React 18 — implicit undefined
const ref = useRef<HTMLDivElement>();

// React 19 — must pass null
const ref = useRef<HTMLDivElement>(null);
```

The `types-react-codemod preset-19` covers this.

## `JSX` namespace moved to `React.JSX`

```tsx
// React 18
function fn(): JSX.Element { ... }

// React 19
function fn(): React.JSX.Element { ... }
```

Code that uses `JSX.Element` / `JSX.IntrinsicElements` from the global namespace will break unless the project has the legacy global JSX namespace polyfill enabled. The codemod rewrites these.

## `ReactElement` default generic now `unknown`

```tsx
// React 18
const x: ReactElement = <div/>; // props: any
// React 19
const x: ReactElement = <div/>; // props: unknown — narrow before use
```

## New hooks (port-relevant)

| Hook | Use |
|---|---|
| `useActionState(fn, initial)` | replaces `useFormState` from `react-dom` |
| `useFormStatus()` | from `react-dom` — pending state of enclosing form |
| `useOptimistic(state, reducer)` | optimistic UI update |
| `use(promise / context)` | unwrap promises and context inline |

In SPA targets (no server actions), `useActionState` is fine for client-side form handling. `useFormStatus` works inside any `<form>`.

## Removed `react-dom` APIs

- `ReactDOM.render`, `ReactDOM.hydrate`, `ReactDOM.unmountComponentAtNode` were removed in React 18. If source still uses them, codemod the entrypoint.
- `findDOMNode` removed in React 19. Use refs.

## `act` import

```tsx
// React 18
import { act } from 'react-dom/test-utils';
// React 19
import { act } from 'react';
```

## Codemods used by the skill

- `npx codemod@latest react/19/migration-recipe` — runs the bundle of recipes (forwardRef, propTypes, Context, useRef, etc.).
- `npx types-react-codemod@latest preset-19 <paths>` — covers type-level breakages (JSX namespace, ReactElement, hooks signatures).

Both are idempotent. Run on `<targetRoot>/src` after each port phase completes.

## Peer-deps watch list (common React 18 → 19 sticking points)

- `framer-motion` — needs `>=11.5` for React 19.
- `@lexical/react` — needs `>=0.18`.
- `react-redux` — needs `>=9.x`.
- `@radix-ui/*` — needs current versions; older versions will warn.
- `react-hook-form` — `>=7.53` declares React 19 peer.

The `port-components.mjs` script runs `npm ls --json` after install and reports any package with a React 18 peer constraint.
