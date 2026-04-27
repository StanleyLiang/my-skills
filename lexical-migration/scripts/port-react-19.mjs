#!/usr/bin/env node
// Phase 6 — Apply React 19 codemods to editor files.
// Conservative regex-based transforms:
//   - bare useRef() / useRef<T>() → useRef<T | null>(null)
//   - JSX.Element → React.JSX.Element (and friends), adding React import if needed
//   - propTypes assignment block → strip (with a TODO note pointing at the file)
//   - forwardRef simple wrapping pattern → ref-as-prop (only for the simplest shape)
// Anything ambiguous is left untouched and noted.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  say, stop, parseArgs, selfTestGate, readMigration, readSpec, readState, writeState,
  writeFile, stateDir, findMigrationRoot, appendNote,
} from './_lib.mjs';

const SCRIPT = 'port-react-19.mjs';
const args = parseArgs(process.argv.slice(2));
selfTestGate(args, SCRIPT);

const repoRoot = findMigrationRoot(process.cwd());
if (!repoRoot) stop('no migration.json found');
const m = readMigration(repoRoot);
const spec = readSpec(repoRoot);
if (!spec) stop('editor-spec.json missing');

const state = readState(repoRoot) || { phase: '6', step: 'react19', queues: {}, pending: null, lastError: null };

if (!state.queues.react19) {
  // Union of every editor file we know about
  const set = new Set([
    ...spec.customNodes.map(n => n.file),
    ...spec.plugins.map(p => p.file),
    ...spec.themeFiles,
    ...spec.composers.map(c => c.file),
    ...spec.serializationFiles,
  ]);
  state.queues.react19 = { items: [...set], cursor: 0, doneCount: 0 };
  writeState(repoRoot, state);
}

const q = state.queues.react19;
if (q.cursor >= q.items.length) {
  state.step = 'react19-done';
  writeState(repoRoot, state);
  say(`react19 queue empty (${q.doneCount} processed)`);
  process.exit(0);
}

const BATCH = Number(args.flags.batch === true ? 3 : args.flags.batch || 3);
const processed = [];

for (let i = 0; i < BATCH && q.cursor < q.items.length; i++) {
  const rel = q.items[q.cursor];
  const abs = join(repoRoot, rel);
  if (!existsSync(abs)) { q.cursor++; continue; }
  const original = readFileSync(abs, 'utf8');
  let out = original;

  // 1. bare useRef
  out = out.replace(/\buseRef\s*<\s*([^>]+?)\s*>\s*\(\s*\)/g, 'useRef<$1 | null>(null)');
  out = out.replace(/\buseRef\s*\(\s*\)/g, 'useRef(null)');

  // 2. JSX namespace
  if (/\bJSX\.(Element|IntrinsicElements|LibraryManagedAttributes)\b/.test(out)) {
    out = out.replace(/\bJSX\.(Element|IntrinsicElements|LibraryManagedAttributes)\b/g, 'React.JSX.$1');
    if (!/\bimport\s+(?:\*\s+as\s+)?React\b/.test(out)) {
      out = `import * as React from 'react';\n` + out;
    }
  }

  // 3. propTypes — strip
  out = out.replace(/^\s*[A-Za-z_$][\w$]*\.propTypes\s*=\s*\{[\s\S]*?\}\s*;?\s*$/gm, () => {
    appendNote(repoRoot, `- removed legacy propTypes assignment in \`${rel}\``);
    return '';
  });

  // 4. forwardRef simple shape:
  //   const Foo = forwardRef<Ref, Props>(({a, b}, ref) => (...));
  // becomes:
  //   const Foo = ({a, b, ref}: Props & { ref?: Ref }) => (...);
  // Only very narrow pattern; complex generics left alone.
  out = out.replace(
    /const\s+([A-Za-z_$][\w$]*)\s*=\s*forwardRef\s*<\s*([^,>]+)\s*,\s*([^>]+)\s*>\s*\(\s*\(\s*(\{[^}]*\})\s*,\s*ref\s*\)\s*=>/g,
    (match, name, refType, propsType, propsDestructure) => {
      const inner = propsDestructure.replace(/\}$/, ', ref }');
      return `const ${name} = (${inner}: ${propsType.trim()} & { ref?: React.Ref<${refType.trim()}> }) =>`;
    }
  );

  if (out !== original) {
    writeFile(abs, out);
    processed.push(rel);
  } else {
    processed.push(rel + ' (no-op)');
  }
  q.cursor++;
  q.doneCount++;
}

writeState(repoRoot, state);
if (q.cursor >= q.items.length) {
  state.step = 'react19-done';
  writeState(repoRoot, state);
}

say(`port-react-19: batch=${processed.length} cursor=${q.cursor}/${q.items.length}`);
for (const p of processed.slice(0, 4)) say(`  ${p}`);
