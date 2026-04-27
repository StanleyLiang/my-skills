# `@lexical/react` API surface (offline)

Quick reference for the React-side APIs the migration scripts inspect and rewrite.

## Composer

```tsx
<LexicalComposer initialConfig={initialConfig}>
  {/* plugins live as children */}
</LexicalComposer>
```

`initialConfig` shape:

```ts
type InitialConfig = {
  namespace: string;
  theme?: EditorThemeClasses;
  onError: (error: Error, editor: LexicalEditor) => void;
  nodes?: Array<Klass<LexicalNode> | LexicalNodeReplacement>;
  editorState?: InitialEditorStateType;
  editable?: boolean;
};
```

## Plugin pattern

```tsx
function MyPlugin(): null {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    return editor.registerCommand(
      MY_COMMAND,
      (payload) => { /* … */ return true; },
      COMMAND_PRIORITY_LOW,
    );
  }, [editor]);
  return null;
}
```

Key points the scripts enforce:
- `useLexicalComposerContext()` returns a tuple `[editor]`.
- `registerCommand` always takes a priority as third argument.
- The cleanup return is unsubscription; multiple `register*` calls should be combined via `mergeRegister` from `@lexical/utils`.

## Common plugins

- `<RichTextPlugin />` / `<PlainTextPlugin />` — provide the `Editable` and `Placeholder` slots.
- `<HistoryPlugin />` — undo/redo. The `delay` prop was **removed in 0.17+**; the script strips it.
- `<OnChangePlugin onChange={fn} />` — fires on every editor state change.
- `<LexicalErrorBoundary>` — recommended at the composer root from 0.17+.

## Decorator components

Decorator nodes' `decorate(editor, config)` typically returns a React element:

```ts
class MyDecoratorNode extends DecoratorNode<JSX.Element> {
  decorate(_editor: LexicalEditor, _config?: EditorConfig): JSX.Element {
    return <MyComponent nodeKey={this.getKey()} />;
  }
}
```

In React 19 the `JSX.Element` reference becomes `React.JSX.Element`; `port-react-19.mjs` rewrites it.
