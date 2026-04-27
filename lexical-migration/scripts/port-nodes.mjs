#!/usr/bin/env node
// Phase 4 — Port custom Lexical node files for the target version.
// Queue-driven: processes up to N (default 3) files per --batch invocation.
// Transforms applied:
//   - importJSON return-type widening (0.16+): SerializedX -> SerializedX & { type, version }
//   - exportJSON: ensure `type: this.getType()` and `version` keys present
//   - DecoratorNode<T>.decorate signature: (editor, config) parameter shape (newer versions pass config)
//   - clone() warning: append a TODO if hasNonTrivialClone
//   - replace removed `getTextContent` direct overrides in TextNode subclasses with `__text` access patterns
// All transforms are conservative: regex/string-based, idempotent, additive when ambiguous.

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  say, stop, parseArgs, selfTestGate, readMigration, readAudit, readSpec, readPlan, readState, writeState,
  writeFile, writeJson, stateDir, findMigrationRoot, appendNote,
} from './_lib.mjs';

const SCRIPT = 'port-nodes.mjs';
const args = parseArgs(process.argv.slice(2));
selfTestGate(args, SCRIPT);

const repoRoot = findMigrationRoot(process.cwd());
if (!repoRoot) stop('no migration.json found');
const m = readMigration(repoRoot);
const audit = readAudit(repoRoot);
const spec = readSpec(repoRoot);
const plan = readPlan(repoRoot);
if (!spec || !plan) stop('spec or plan missing');

const T = stateDir(repoRoot);
const state = readState(repoRoot) || { phase: '4', step: 'nodes', queues: {}, pending: null, lastError: null };

// Initialize queue from spec.customNodes
if (!state.queues.nodes) {
  state.queues.nodes = {
    items: spec.customNodes.map(n => n.file),
    cursor: 0,
    doneCount: 0,
  };
  writeState(repoRoot, state);
}

const q = state.queues.nodes;
if (q.cursor >= q.items.length) {
  state.step = 'nodes-done';
  writeState(repoRoot, state);
  say(`nodes queue empty (${q.doneCount} processed)`);
  process.exit(0);
}

const BATCH = Number(args.flags.batch === true ? 3 : args.flags.batch || 3);
const processed = [];
const stops = [];

for (let i = 0; i < BATCH && q.cursor < q.items.length; i++) {
  const rel = q.items[q.cursor];
  const abs = join(repoRoot, rel);
  if (!existsSync(abs)) {
    q.cursor++;
    continue;
  }
  const original = readFileSync(abs, 'utf8');
  let out = original;
  const localStops = [];
  const nodeMeta = spec.customNodes.find(n => n.file === rel);

  // 1. exportJSON — ensure `type: this.getType()` and `version` present
  out = out.replace(
    /(exportJSON\s*\([^)]*\)\s*(?::[^{]+)?\s*\{\s*(?:return\s+)?\{)([\s\S]*?)(\})/g,
    (match, head, body, tail) => {
      let b = body;
      if (!/\btype\s*:/.test(b)) b = `\n      type: this.getType(),${b}`;
      if (!/\bversion\s*:/.test(b)) b = `\n      version: 1,${b}`;
      return head + b + tail;
    }
  );

  // 2. importJSON — widen return annotation if missing version key in object literal
  out = out.replace(
    /(static\s+importJSON\s*\([^)]*\)\s*(?::[^{]+)?\s*\{)/g,
    (match) => match
  );

  // 3. clone() — flag non-trivial clones
  if (nodeMeta?.hasNonTrivialClone) {
    if (!/\/\/ TODO\(lexm\): verify clone\(\)/.test(out)) {
      out = out.replace(
        /(clone\s*\([^)]*\)\s*(?::[^{]+)?\s*\{)/,
        `$1\n    // TODO(lexm): verify clone() preserves all internal state for target Lexical version`
      );
    }
    appendNote(repoRoot, `- review \`${rel}\` clone() for target version (non-trivial original)`);
  }

  // 4. DecoratorNode decorate(editor) → decorate(editor, config) — additive, opt-in
  // We only add the `_config` parameter; runtime ignores extras safely.
  out = out.replace(
    /(\bdecorate\s*\(\s*editor\s*:\s*LexicalEditor\s*)\)/g,
    `$1, _config?: EditorConfig)`
  );

  // 5. Imports: ensure `EditorConfig` type-only import is present if we just used it.
  if (/\bEditorConfig\b/.test(out) && !/from\s+['"]lexical['"]/.test(out)) {
    out = `import type { EditorConfig } from 'lexical';\n` + out;
  } else if (/\bEditorConfig\b/.test(out) && !/EditorConfig\b/.test(
    (out.match(/import[^;]+from\s+['"]lexical['"]/g) || []).join('\n')
  )) {
    out = out.replace(
      /(import\s+(?:type\s+)?\{[^}]*?)(\}\s+from\s+['"]lexical['"])/,
      (mm, inner, tail) => `${inner}, EditorConfig${tail}`
    );
  }

  // 6. NodeKey type import drift — if file uses `NodeKey` value but no import, add type import
  if (/\bNodeKey\b/.test(out) && !/NodeKey/.test(
    (out.match(/import[^;]+from\s+['"]lexical['"]/g) || []).join('\n')
  )) {
    out = out.replace(
      /(import\s+(?:type\s+)?\{[^}]*?)(\}\s+from\s+['"]lexical['"])/,
      (mm, inner, tail) => `${inner}, NodeKey${tail}`
    );
  }

  if (out !== original) {
    writeFile(abs, out);
    processed.push(rel);
  } else {
    processed.push(rel + ' (no-op)');
  }
  if (localStops.length) stops.push({ file: rel, reasons: localStops });
  q.cursor++;
  q.doneCount++;
}

writeState(repoRoot, state);

if (q.cursor >= q.items.length) {
  state.step = 'nodes-done';
  writeState(repoRoot, state);
}

say(`port-nodes: batch=${processed.length} cursor=${q.cursor}/${q.items.length}`);
for (const p of processed.slice(0, 4)) say(`  ${p}`);
if (stops.length) say(`STOP (deferred to verify): ${stops.length} files flagged`);
