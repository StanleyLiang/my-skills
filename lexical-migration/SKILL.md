---
name: lexical-migration
description: Use when migrating an in-house Lexical-based rich-text editor to a newer Lexical version (typically for React 19 compatibility). Auto-invoke when the user mentions upgrading Lexical, fixing a Lexical editor for React 19, or migrating @lexical/react. Also auto-invoke on Traditional Chinese prompts like 「升級 Lexical」「Lexical 編輯器搬遷」「lexical 遷移」. The skill stocktakes the in-house editor first — locating its custom nodes, plugins, commands, themes, and serialization surface — then asks the user to confirm or amend the discovered spec before any code transforms run. Walks an ordered phased playbook with verification gates, queue-driven per-file porting, and explicit STOP triggers for unsafe changes. Designed for ~12k-token sessions: one tiny step per session, resumable from `./.lexm/state.json`.
---

# lexical-migration

Migrate an in-house Lexical editor across version boundaries (e.g. 0.18 → latest 0.x), aligning custom nodes, plugins, commands, themes, and serialization with the target version, and applying React 19 fixes to editor code where present.

## Session protocol (do this every session)

1. **Confirm inputs.** If `./.lexm/migration.json` exists, read `repoRoot` and `editorRoot` from it. Otherwise ask the user for both, then run:
   ```sh
   node $SKILL/scripts/audit.mjs --repo <repoRoot> --editor <editorRoot>
   ```
   (`$SKILL` = `skills/lexical-migration` — substitute the absolute path.)

2. **Run the dispatcher.** This is the single source of truth for what to do this session:
   ```sh
   node $SKILL/scripts/next.mjs
   ```
   It reads `./.lexm/state.json` and prints exactly one directive, ≤200 tokens.

3. **Execute the directive.** One of:
   - `RUN <cmd...>` — run that exact command. Quote stdout back to the user (≤200 tokens). On non-zero exit, STOP.
   - `ASK <prompt-file> <answer-file>` — read the prompt file (≤1k tokens), pose it to the user verbatim, write their answer (path or pasted markdown) to the answer file.
   - `COMMIT <message>` — `git -C <repoRoot> add -A && git -C <repoRoot> commit -m "<message>"`.
   - `DONE` — migration finished. Tell the user, exit.

4. **Advance the state machine:**
   ```sh
   node $SKILL/scripts/next.mjs --advance
   ```

5. **Loop or exit.** If `--advance` prints another directive AND your cumulative session tokens are still under ~8k, loop back to step 3. Otherwise stop and let the next session resume.

## Hard rules

- Never read or write editor source files directly. Every read or transform happens inside a script. Your job is dispatch + commit + ask.
- Never invent commands. Only run what `next.mjs` told you to.
- Never skip a STOP. If a script exits non-zero, surface the `STOP <reason>` line and stop.
- Never modify files outside `<editorRoot>` or `<repoRoot>/.lexm/`.
- Never use `WebFetch` / `WebSearch`. All references are local under `references/`.
- Never bump Lexical without first stocktaking. The audit's spec is the contract every later phase consumes.

## Scope

**In scope (migrated):** custom Lexical node subclasses (`ElementNode` / `TextNode` / `DecoratorNode` / `LineBreakNode`), `@lexical/react` plugin components, `createCommand` / `registerCommand` sites, theme objects, JSON+DOM serialization (`exportJSON` / `importJSON` / `exportDOM` / `importDOM`), composer configuration, React 19 breaking changes inside editor code.

**Out of scope (NOT migrated):** the host application around the editor (route components, app shell, non-editor utilities). Editor markup that depends on third-party rich-text engines other than Lexical (Quill, ProseMirror, Slate). Server-side rendering of editor state.

**Deferred (STOP and ask):** custom nodes that override `clone()` with non-trivial logic; plugins that register synthetic events outside Lexical's command bus; theme classes referenced by other parts of the host app; unmapped transitive `@lexical/*` packages newly required by the target version. The skill never auto-resolves these.

## Phase index

| Phase | Name | Key script | What it does |
|---|---|---|---|
| 0 | Stocktake (audit) | `audit.mjs` | Locate editor; inventory nodes, plugins, commands, themes, serialization, React 19 risks |
| 1 | Confirm spec | `build-spec.mjs` | ASK user to approve/amend the auto-derived editor spec (markdown) |
| 2 | Plan version path | `plan-version.mjs` | ASK target Lexical version; emit ordered hops if multi-version jump |
| 3 | Upgrade deps | `upgrade-deps.mjs` | Bump `lexical` + `@lexical/*` to target; install; baseline verify (pre-transform) |
| 4 | Port nodes (queue) | `port-nodes.mjs` | Per-file transforms on custom node subclasses for API deltas |
| 5 | Port plugins (queue) | `port-plugins.mjs` | Per-file transforms on `@lexical/react` plugin components and command sites |
| 6 | Align React 19 (queue) | `port-react-19.mjs` | `forwardRef` removal, ref-as-prop, `useRef` initial-arg, JSX namespace fixes inside editor code |
| 7 | Final verify | `verify.sh` | tsc + build + (optional) editor unit tests; list TODOs in `MIGRATION_NOTES.md` |

Per-phase narrative lives in `references/phases.md`. `next.mjs` quotes the relevant section into stdout when context is needed; do not auto-load.

## Reference index

- `references/lexical-version-deltas.md` — minor-by-minor breaking changes across recent Lexical 0.x; the canonical lookup for what each port phase rewrites.
- `references/lexical-core-api.md` — `ElementNode` / `TextNode` / `DecoratorNode` / `LineBreakNode` shapes, required statics (`getType`, `clone`), update lifecycle methods.
- `references/lexical-react-api.md` — `<LexicalComposer>` config shape, `useLexicalComposerContext`, plugin patterns, `LexicalEditor.registerCommand` signatures.
- `references/lexical-serialization.md` — `exportJSON` / `importJSON` shape evolution, `exportDOM` / `importDOM` `DOMConversionMap` rules.
- `references/react-19-breaking.md` — Editor-relevant React 19 deltas: `forwardRef` deprecation, `useRef` argument, ref-as-prop, `JSX.*` → `React.JSX`.
- `references/phases.md` — per-phase narrative; `next.mjs` quotes from this on demand.

## STOP triggers (the script will print exactly one)

- `editorRoot` is outside `repoRoot`, doesn't exist, or contains no Lexical imports (Phase 0).
- `lexical` version not detectable from `package.json` or lockfile (Phase 0).
- Custom node missing required `getType()` static or with non-trivial `clone()` override that we can't preserve safely (Phase 4).
- Plugin uses a Lexical export that's removed in the target version and has no documented replacement (Phase 5).
- `exportJSON`/`importJSON` shape change between current and target version that the script can't auto-translate (Phase 4).
- Target version requires a transitive `@lexical/*` package not currently installed (Phase 3, surfaced for user approval).
- React 19 codemod produces a diff that introduces type errors the script can't auto-resolve (Phase 6).
- Final verify fails after the last queue drains (Phase 7).

## When you finish

When `next.mjs` prints `DONE`, tell the user the migration is complete and point them to `<repoRoot>/MIGRATION_NOTES.md` for any TODOs the scripts emitted (manual `clone()` overrides, theme class renames touching the host app, transitive `@lexical/*` upgrades, etc.).
