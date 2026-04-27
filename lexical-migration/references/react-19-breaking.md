# React 19 — editor-relevant breaking changes (offline)

Subset of the React 19 changelog that bites Lexical-based editor code. `port-react-19.mjs` applies the mechanical fixes; the rest are flagged.

## `forwardRef` deprecated

Refs are now plain props.

Before:
```tsx
const Editor = forwardRef<HTMLDivElement, Props>(({a}, ref) => (
  <div ref={ref}>{a}</div>
));
```

After:
```tsx
const Editor = ({a, ref}: Props & { ref?: React.Ref<HTMLDivElement> }) => (
  <div ref={ref}>{a}</div>
);
```

The script auto-applies the simplest shape; complex generics or nested `forwardRef` calls are left alone with a TODO note.

## `useRef` requires explicit initial argument

Before:
```ts
const r = useRef<HTMLDivElement>();
```

After:
```ts
const r = useRef<HTMLDivElement | null>(null);
```

Auto-applied by the script.

## `JSX.*` namespace moved

Before:
```ts
class N extends DecoratorNode<JSX.Element> { /* ... */ }
```

After:
```ts
class N extends DecoratorNode<React.JSX.Element> { /* ... */ }
```

Auto-applied; if `React` isn't imported, the script adds `import * as React from 'react'`.

## `propTypes` / `defaultProps` removed for function components

The script strips `Component.propTypes = { ... }` blocks and adds a `MIGRATION_NOTES.md` line for review.

## `Context.Provider` shorthand

`<MyContext value={...}>` works directly (no `.Provider`). Not auto-applied — risk of false positives when an unrelated `Provider` symbol is in scope.

## `ReactElement` default generic now `unknown`

Old: `ReactElement<any>`. New: `ReactElement<unknown>`. Existing explicit-generic call sites unaffected; bare `ReactElement` may flip to stricter.

## What the script does NOT do

- Rewrite class components using `getDerivedStateFromProps` etc.
- Fix HOCs that wrap `forwardRef`.
- Resolve type errors that surface only after the codemod runs (those go to the user).
