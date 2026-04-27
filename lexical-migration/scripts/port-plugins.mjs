#!/usr/bin/env node
// Phase 5 — Port @lexical/react plugins and command sites for the target version.
// Queue-driven: processes up to N (default 3) files per --batch.
// Transforms:
//   - registerCommand: ensure third arg COMMAND_PRIORITY_* is present (newer versions tightened types)
//   - useLexicalComposerContext destructure: returns [editor] tuple — flag if pattern differs
//   - $createParagraphNode/$getRoot import path consistency
//   - INSERT_PARAGRAPH_COMMAND etc. — keep as-is (no rename in 0.x)
//   - Drop legacy `<HistoryPlugin>` `delay` prop if present (removed in 0.17+)

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  say, stop, parseArgs, selfTestGate, readMigration, readSpec, readPlan, readState, writeState,
  writeFile, stateDir, findMigrationRoot, appendNote,
} from './_lib.mjs';

const SCRIPT = 'port-plugins.mjs';
const args = parseArgs(process.argv.slice(2));
selfTestGate(args, SCRIPT);

const repoRoot = findMigrationRoot(process.cwd());
if (!repoRoot) stop('no migration.json found');
const m = readMigration(repoRoot);
const spec = readSpec(repoRoot);
const plan = readPlan(repoRoot);
if (!spec || !plan) stop('spec or plan missing');

const state = readState(repoRoot) || { phase: '5', step: 'plugins', queues: {}, pending: null, lastError: null };

if (!state.queues.plugins) {
  state.queues.plugins = {
    items: spec.plugins.map(p => p.file),
    cursor: 0,
    doneCount: 0,
  };
  writeState(repoRoot, state);
}

const q = state.queues.plugins;
if (q.cursor >= q.items.length) {
  state.step = 'plugins-done';
  writeState(repoRoot, state);
  say(`plugins queue empty (${q.doneCount} processed)`);
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

  // 1. registerCommand without explicit priority — append COMMAND_PRIORITY_LOW + import
  let added = false;
  out = out.replace(
    /(\beditor\.registerCommand\s*\(\s*[^,]+,\s*[^,]+)(\s*\)\s*[,;])/g,
    (match, head, tail) => { added = true; return `${head}, COMMAND_PRIORITY_LOW${tail}`; }
  );
  if (added && !/COMMAND_PRIORITY_LOW/.test(
    (out.match(/import[^;]+from\s+['"]lexical['"]/g) || []).join('\n')
  )) {
    if (/from\s+['"]lexical['"]/.test(out)) {
      out = out.replace(
        /(import\s+\{[^}]*?)(\}\s+from\s+['"]lexical['"])/,
        (mm, inner, tail) => `${inner}, COMMAND_PRIORITY_LOW${tail}`
      );
    } else {
      out = `import { COMMAND_PRIORITY_LOW } from 'lexical';\n` + out;
    }
  }

  // 2. HistoryPlugin delay prop removal (0.17+)
  out = out.replace(/(<HistoryPlugin\b[^>]*?)\s+delay=\{[^}]+\}/g, (match, head) => {
    appendNote(repoRoot, `- removed legacy \`delay\` prop from HistoryPlugin in \`${rel}\``);
    return head;
  });

  // 3. useLexicalComposerContext — confirm destructure shape; flag if not [editor] tuple
  if (/useLexicalComposerContext\s*\(\s*\)/.test(out)
    && !/const\s*\[\s*editor\b/.test(out)) {
    appendNote(repoRoot, `- review \`${rel}\`: useLexicalComposerContext() result not destructured as [editor] — verify after upgrade`);
  }

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
  state.step = 'plugins-done';
  writeState(repoRoot, state);
}

say(`port-plugins: batch=${processed.length} cursor=${q.cursor}/${q.items.length}`);
for (const p of processed.slice(0, 4)) say(`  ${p}`);
