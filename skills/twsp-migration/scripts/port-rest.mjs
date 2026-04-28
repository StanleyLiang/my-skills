#!/usr/bin/env node
// Phase 4c — Port lib / hooks / store / types / utils + locale messages.

import { existsSync, readFileSync, mkdirSync, copyFileSync, appendFileSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import {
  say, stop, parseArgs, selfTestGate, readMigration, readAudit, readState, writeState,
  walk, writeFile, readJson, run, logSidecar, twspDir,
} from './_lib.mjs';
import { applyTransforms } from './_transform.mjs';

const SCRIPT = 'port-rest.mjs';
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

const restDirs = ['lib', 'hooks', 'store', 'types', 'utils', 'constants', 'services', 'context', 'providers'];

if (!state.queues.rest) {
  const items = [];
  for (const top of [appRoot, join(appRoot, 'src')]) {
    for (const d of restDirs) {
      const p = join(top, d);
      if (existsSync(p)) {
        for (const f of walk(p, { exts: ['.ts', '.tsx', '.js', '.jsx'], absolute: true })) {
          if (/\.(spec|test|stories)\./.test(f)) continue;
          items.push(f);
        }
      }
    }
  }
  state.queues.rest = { items, cursor: 0, doneCount: 0 };
  writeState(sourceRoot, state);
}

const q = state.queues.rest;
const BATCH = Number(args.flags.batch === true ? 8 : (args.flags.batch || 8));
const end = Math.min(q.items.length, q.cursor + BATCH);

const todos = [];
const stopsEncountered = [];
let processed = 0;

for (let i = q.cursor; i < end; i++) {
  const srcFile = q.items[i];
  const rel = relative(appRoot, srcFile);
  const dstRel = rel.startsWith('src/') ? rel : 'src/' + rel;
  const dst = join(target, dstRel);

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

if (stopsEncountered.length > 0) {
  const lines = stopsEncountered.flatMap(s => s.stops.map(r => `- ${s.file}: ${r}`));
  const log = logSidecar(sourceRoot, SCRIPT, lines.join('\n'));
  stop(`${stopsEncountered.length} files have STOP issues`, log);
}

// ── If queue done, copy locale messages ─────────────────────────────
if (q.cursor >= q.items.length) {
  if (i18nMapping && i18nMapping.messagesDir) {
    const dir = i18nMapping.messagesDir;
    const candidates = [
      join(appRoot, dir),
      join(appRoot, 'src', dir),
    ].filter(existsSync);
    let copied = 0;
    for (const root of candidates) {
      for (const f of walk(root, { exts: ['.json'], absolute: true })) {
        const r = relative(appRoot, f);
        const dst = join(target, r.startsWith('src/') ? r : 'src/' + r);
        mkdirSync(dirname(dst), { recursive: true });

        if (i18nMapping.messageFormat === 'identical') {
          copyFileSync(f, dst);
        } else if (i18nMapping.messageFormat?.startsWith('transform:')) {
          // Only built-in transformer is no-op; copy as-is + TODO.
          copyFileSync(f, dst);
          todos.push(`messages transformer "${i18nMapping.messageFormat}" not implemented — file copied as-is: ${r}`);
        } else {
          copyFileSync(f, dst);
          todos.push(`message format "${i18nMapping.messageFormat}" requires manual review: ${r}`);
        }
        copied++;
      }
    }
    say(`messages: copied ${copied}`);
  }

  // Final tsc + build
  const tsc = run('npx', ['tsc', '--noEmit'], { cwd: target });
  if (tsc.code !== 0) {
    const log = logSidecar(sourceRoot, SCRIPT, tsc.stderr || tsc.stdout);
    say(`tsc warnings (will recheck after Phase 5): ${log}`);
  }
}

if (todos.length > 0) {
  appendFileSync(join(target, 'MIGRATION_NOTES.md'),
    `\n## Phase 4c — TODOs from rest port\n\n` +
    [...new Set(todos)].map(t => `- ${t}`).join('\n') + '\n');
}

state.step = 'rest';
writeState(sourceRoot, state);

say(`port-rest: batch=${processed} cursor=${q.cursor}/${q.items.length} done=${q.doneCount}`);
