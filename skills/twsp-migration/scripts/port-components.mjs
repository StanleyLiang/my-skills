#!/usr/bin/env node
// Phase 4a — Port components.
// Queue-driven: processes one batch per session, exits, agent commits, --advances.

import { existsSync, readFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import {
  say, stop, parseArgs, selfTestGate, readMigration, readAudit, readState, writeState,
  walk, writeFile, readJson, run, logSidecar, twspDir,
} from './_lib.mjs';
import { applyTransforms } from './_transform.mjs';

const SCRIPT = 'port-components.mjs';
const args = parseArgs(process.argv.slice(2));
selfTestGate(args, SCRIPT);

function findSource() {
  if (args.flags.source) return resolve(args.flags.source);
  let d = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(d, '.twsp', 'migration.json'))) return d;
    const p = resolve(d, '..');
    if (p === d) break;
    d = p;
  }
  return null;
}

const sourceRoot = findSource();
if (!sourceRoot) stop('no migration.json found');
const m = readMigration(sourceRoot);
const audit = readAudit(sourceRoot);
const target = m.targetRoot;
const appRoot = m.appPackageRoot || sourceRoot;
const T = twspDir(sourceRoot);

const uiMapping = readJson(join(T, 'ui-mapping.json'));
const i18nMapping = readJson(join(T, 'i18n-mapping.json'));

const state = readState(sourceRoot);

// ── Build queue (only first time) ───────────────────────────────────
if (!state.queues.components) {
  const candidates = [
    join(appRoot, 'components'),
    join(appRoot, 'src', 'components'),
  ].filter(existsSync);
  const items = [];
  for (const dir of candidates) {
    for (const f of walk(dir, { exts: ['.ts', '.tsx', '.jsx', '.js'], absolute: true })) {
      // Skip .stories./.spec./.test.
      if (/\.(stories|spec|test)\./.test(f)) continue;
      items.push(f);
    }
  }
  state.queues.components = { items, cursor: 0, doneCount: 0 };

  // Run shadcn add for the primitives needed
  if (uiMapping && uiMapping.primitivesNeeded?.length > 0) {
    const kebab = uiMapping.primitivesNeeded.map(p =>
      p.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
    );
    const r = run('npx', ['--yes', 'shadcn@latest', 'add', '--yes', ...kebab], { cwd: target });
    if (r.code !== 0) {
      const log = logSidecar(sourceRoot, SCRIPT, r.stderr || r.stdout);
      stop(`shadcn add failed: ${kebab.join(', ')}`, log);
    }
  }
  writeState(sourceRoot, state);
}

const q = state.queues.components;
const BATCH = Number(args.flags.batch === true ? 5 : (args.flags.batch || 5));
const end = Math.min(q.items.length, q.cursor + BATCH);

let processed = 0;
let stopsEncountered = [];
const todos = [];

for (let i = q.cursor; i < end; i++) {
  const srcFile = q.items[i];
  const rel = relative(appRoot, srcFile)
    .replace(/^src\//, 'src/')
    .replace(/^components\//, 'src/components/');
  const dst = join(target, rel.startsWith('src/') ? rel : 'src/' + rel);
  const content = readFileSync(srcFile, 'utf8');
  const { text, stops } = applyTransforms(content, { uiMapping, i18nMapping, todos });
  if (stops.length > 0) {
    stopsEncountered.push({ file: rel, stops });
    continue;
  }
  mkdirSync(dirname(dst), { recursive: true });
  writeFile(dst, text);
  processed++;
}

q.cursor = end;
q.doneCount += processed;
writeState(sourceRoot, state);

// ── If reached end of queue, run codemods ──────────────────────────
if (q.cursor >= q.items.length) {
  const cm1 = run('npx', ['--yes', 'codemod@latest', 'react/19/migration-recipe', '--target', join(target, 'src')], { cwd: target });
  if (cm1.code !== 0) {
    const log = logSidecar(sourceRoot, SCRIPT, cm1.stderr || cm1.stdout);
    say(`react 19 codemod warning: ${log}`);
  }
  const cm2 = run('npx', ['--yes', 'types-react-codemod@latest', 'preset-19', join(target, 'src')], { cwd: target });
  if (cm2.code !== 0) {
    const log = logSidecar(sourceRoot, SCRIPT, cm2.stderr || cm2.stdout);
    say(`types-react codemod warning: ${log}`);
  }

  const tsc = run('npx', ['tsc', '--noEmit'], { cwd: target });
  if (tsc.code !== 0) {
    const log = logSidecar(sourceRoot, SCRIPT, tsc.stderr || tsc.stdout);
    stop('tsc failed after components port', log);
  }
}

if (todos.length > 0) {
  appendFileSync(join(target, 'MIGRATION_NOTES.md'),
    `\n## Phase 4a — TODOs from component port (batch end)\n\n` +
    [...new Set(todos)].map(t => `- ${t}`).join('\n') + '\n');
}

if (stopsEncountered.length > 0) {
  const lines = stopsEncountered.flatMap(s => s.stops.map(r => `- ${s.file}: ${r}`));
  const log = logSidecar(sourceRoot, SCRIPT, lines.join('\n'));
  stop(`${stopsEncountered.length} components have STOP issues`, log);
}

state.step = q.cursor >= q.items.length ? 'components' : 'components';
writeState(sourceRoot, state);

say(`port-components: batch=${processed} cursor=${q.cursor}/${q.items.length} done=${q.doneCount}`);
