# Lexical core API surface (offline)

Quick reference for the `lexical` package types the migration scripts reason about. Not exhaustive — lookup-table for the patterns the scripts detect and rewrite.

## Node base classes

- `ElementNode` — block-level container; children are other nodes.
- `TextNode` — inline text leaf; supports `format`, `style`, `mode`.
- `DecoratorNode<T>` — leaf that renders a React component (or other host primitive) for `T`.
- `LineBreakNode` — singleton for `<br>`-equivalent insertions.
- `RootNode` — singleton root of the tree; rarely subclassed.
- `ParagraphNode` — default `ElementNode` subclass for paragraphs.

## Required statics on every custom node

- `static getType(): string` — unique, stable type tag. Never rename across migrations.
- `static clone(node: T): T` — must reproduce all internal state (key included).
- `static importJSON(serializedNode: SerializedT): T` — required for SSR / clipboard / collab.

## Required instance methods (typical)

- `createDOM(config: EditorConfig): HTMLElement` — initial DOM render.
- `updateDOM(prev: T, dom: HTMLElement, config: EditorConfig): boolean` — return true to trigger re-render.
- `exportJSON(): SerializedT` — must include `type: this.getType()` and `version: <n>` keys (0.16+).
- `exportDOM(editor): DOMExportOutput` — for clipboard / SSR.
- `static importDOM(): DOMConversionMap | null` — paste handling.

## Selection

- `$getSelection(): BaseSelection | null`. Always guard for `RangeSelection` etc.
- `$isRangeSelection`, `$isNodeSelection`, `$isGridSelection` are the safe narrowing helpers.

## EditorConfig

- Passed to `createDOM` / `updateDOM` / `decorate`. Contains `theme`, `namespace`, `nodes`, `editorState` accessor in newer versions.

## Commands

- `createCommand<TPayload>(name?: string): LexicalCommand<TPayload>`.
- `editor.dispatchCommand(COMMAND, payload)`.
- `editor.registerCommand(COMMAND, handler, priority)` — priority is `COMMAND_PRIORITY_{LOW|NORMAL|HIGH|CRITICAL|EDITOR}`. `LOW` is the safest default for app-level handlers.

## Transforms

- `editor.registerNodeTransform(NodeClass, fn)` — fires when a node of that class becomes dirty.
- `editor.registerUpdateListener(fn)` — every editor update.

## Serialization shape (current)

```ts
type SerializedTextNode = {
  detail: number;
  format: number;
  mode: 'normal' | 'token' | 'segmented';
  style: string;
  text: string;
  type: 'text';
  version: 1;
};
```

Custom subclasses extend this; `type` must be the subclass's `getType()` and `version` should bump when the shape changes.
