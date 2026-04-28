# Lexical version deltas (curated, offline)

Subset of breaking changes likely to affect an in-house editor migrating across recent 0.x minors. Use this file as the lookup table when deciding what each port phase rewrites. Authoritative source is the upstream changelog; refresh on a manual cadence.

## 0.12 → 0.13

- `LexicalComposerContext` direct-export removed. Use `useLexicalComposerContext()` only.
- `INSERT_LINE_BREAK_COMMAND` reified into a typed command (was a string).

## 0.13 → 0.14

- `TextNode.getMode()` return type narrowed; subclasses with mode helpers must align.
- `EditorState.read()` callback signature stable.

## 0.14 → 0.15

- `$splitNode` helper added (no breakage but custom serialization may want to use it).
- `DecoratorNode.decorate(editor)` now also receives `config: EditorConfig` as second arg in some packages — additive, but type-checked when consumers explicitly type the override.

## 0.15 → 0.16

- `SerializedX` types stricter: every node's `exportJSON` MUST include `type` and `version` keys; missing keys are now compile errors when assignment targets `SerializedX`.
- `importJSON` static expected to accept `SerializedX` matching the node's own `type`.

## 0.16 → 0.17

- `<HistoryPlugin delay={...}>` prop removed; debouncing moved internal.
- `editor.registerNodeTransform` second arg type tightened.
- New `LexicalErrorBoundary` export from `@lexical/react`; composers without an error boundary will warn at runtime.

## 0.17 → 0.18

- Selection API refinements: `$getSelection()` return type narrowed to `BaseSelection | null`; consumers that assumed `RangeSelection` must guard.
- `RootNode` direct subclassing discouraged.

## 0.18 → 0.19

- `@lexical/yjs` collab adapter signature changes (only relevant if collab is used).
- Tree-walking utility additions; existing manual walks still work.

## 0.19 → 0.20

- `EditorThemeClasses` type expanded; theme objects with extra keys are accepted but typed.
- `registerCommand` priority constants (`COMMAND_PRIORITY_*`) export path stabilized in `lexical`.

## 0.20 → 0.21

- React 19 peer deps officially declared in `peerDependenciesMeta`.
- `@lexical/react` plugin components updated to drop internal `forwardRef` usage; consumers using refs into plugin DOM should test.

## 0.21 → 0.22 (and beyond)

- Refresh this file when actually targeting these versions; do not assume.

## How the scripts use this file

- `port-nodes.mjs` reads no version data directly; it applies the **superset** of 0.16/0.17/0.18/0.19 node-shape transforms (idempotent), so running it for a 0.18→0.21 migration covers 0.18→0.20 changes safely.
- `port-plugins.mjs` similarly applies the 0.17 HistoryPlugin delay-strip and the 0.20 priority-constant import — both idempotent.
- `port-react-19.mjs` is independent of Lexical version; gated on whether the audit detected React 19 risks in editor code.
