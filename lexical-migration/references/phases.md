# Phases — narrative

Loaded section-by-section by `next.mjs` when the agent needs context. Do not auto-load.

## Phase 0 — Stocktake (audit)

Locate the editor (`editorRoot`). Walk it. Detect:
- Lexical & `@lexical/*` versions in `package.json`.
- Custom node classes (`extends ElementNode|TextNode|DecoratorNode|...`) with their lifecycle methods.
- Plugin components (anything calling `useLexicalComposerContext`).
- Created and registered commands.
- Theme files and composer call sites.
- Files using JSON / DOM serialization.
- React 19 risk signals (forwardRef, propTypes, bare useRef, JSX.* namespace).

Output: `audit.json`. STOP if `editorRoot` has no Lexical imports or `lexical` version is not parseable.

## Phase 1 — Confirm spec

Emit a markdown summary of the audit (`prompts/editor-spec.md`). User replies `yes` / `no` / `AMEND:` followed by add/drop lines. Result: `editor-spec.json` — the single source of truth every later phase consumes.

## Phase 2 — Plan version path

Ask the user for the target Lexical version (concrete, or `latest`). The script computes intermediate hops from a curated list of known-breaking minors, persists `version-plan.json`. STOP if target equals current.

## Phase 3 — Upgrade deps

Bump `lexical` and every `@lexical/*` entry in `package.json` to `^<target>`. `npm install`. Run `tsc --noEmit` for a baseline (errors here are expected — the type errors are precisely what later phases fix).

## Phase 4 — Port custom nodes (queue)

Per file, idempotently:
- Ensure `exportJSON` includes `type: this.getType()` and `version`.
- Add `EditorConfig` parameter to `decorate(editor, config)` for `DecoratorNode`s.
- Ensure required type imports (`EditorConfig`, `NodeKey`).
- Flag non-trivial `clone()` overrides as MIGRATION_NOTES TODOs.

Batch size: 3 per session. Commit per batch.

## Phase 5 — Port plugins (queue)

Per file, idempotently:
- Ensure `editor.registerCommand` calls have an explicit `COMMAND_PRIORITY_*` (default LOW) and the priority is imported.
- Strip `<HistoryPlugin delay={...}>` legacy prop.
- Flag `useLexicalComposerContext()` results that don't destructure as `[editor]`.

Batch size: 3 per session.

## Phase 6 — Align React 19 (queue)

Apply over the union of all editor files (nodes ∪ plugins ∪ themes ∪ composers ∪ serialization). Skipped entirely if Phase 0 detected zero risk signals.

- `useRef` → explicit initial arg.
- `JSX.*` → `React.JSX.*`.
- `propTypes` block strip with TODO.
- Simplest `forwardRef` shape → ref-as-prop.

## Phase 7 — Final verify

`tsc --noEmit && npm run build`. STOP on failure. On success, point user at `MIGRATION_NOTES.md`.
