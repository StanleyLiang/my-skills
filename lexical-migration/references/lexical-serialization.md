# Lexical serialization (offline)

What `port-nodes.mjs` enforces, and what stays manual.

## JSON serialization

Every custom node MUST implement:

```ts
exportJSON(): SerializedX {
  return {
    ...super.exportJSON(),    // covers detail/format/mode/style/text for TextNode subclasses
    type: this.getType(),
    version: 1,
    // any custom fields…
  };
}

static importJSON(serialized: SerializedX): MyNode {
  const node = $createMyNode(/* args from serialized */);
  // restore custom fields
  return node;
}
```

The script enforces (idempotently):
- `type: this.getType()` is present in the returned object literal of every `exportJSON`.
- `version: <n>` is present (default 1; bump manually if the shape changes).

The script does NOT auto-translate field renames between versions — those are spec-driven and should land as `note:` amendments during Phase 1.

## DOM serialization

```ts
exportDOM(_editor: LexicalEditor): DOMExportOutput {
  const element = document.createElement('span');
  element.dataset.lexicalKey = this.getKey();
  return { element };
}

static importDOM(): DOMConversionMap | null {
  return {
    span: (node: HTMLElement) => {
      if (!node.dataset.lexicalKey) return null;
      return { conversion: convertSpan, priority: 0 };
    },
  };
}
```

The script does not rewrite DOM serialization — too domain-specific. It only flags the file as touching DOM serialization in the audit.

## Versioning policy

When you change `exportJSON` shape, bump `version` and add a migration branch in `importJSON`:

```ts
static importJSON(serialized: SerializedMyNode): MyNode {
  if (serialized.version === 1) {
    // legacy path
  }
  // current path
}
```

Add a `note:` amendment during Phase 1 when shape change is intentional.
