#!/usr/bin/env node
// Phase 4b — Port routes (app/**/page.tsx → src/routes/**/*.tsx + route.meta.json).

import { existsSync, readFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { join, resolve, dirname, relative, basename } from 'node:path';
import {
  say, stop, parseArgs, selfTestGate, readMigration, readAudit, readState, writeState,
  walk, writeFile, writeJson, readJson, run, logSidecar, twspDir,
} from './_lib.mjs';
import { applyTransforms } from './_transform.mjs';

const SCRIPT = 'port-routes.mjs';
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

// ── Pre-flight STOPs ────────────────────────────────────────────────
if (audit.hasMiddleware) stop('middleware.ts present in source — STOP and ask user (deferred)');

// next.config experimental.ppr
const nextCfgCandidates = ['next.config.ts', 'next.config.js', 'next.config.mjs', 'next.config.cjs'];
for (const n of nextCfgCandidates) {
  const p = join(appRoot, n);
  if (existsSync(p)) {
    const t = readFileSync(p, 'utf8');
    if (/experimental\s*:\s*\{[^}]*ppr\s*:/.test(t)) stop('next.config has experimental.ppr enabled');
  }
}

// ── Build queue ─────────────────────────────────────────────────────
if (!state.queues.routes) {
  const appDir = join(appRoot, 'app');
  const srcAppDir = join(appRoot, 'src', 'app');
  const root = existsSync(appDir) ? appDir : (existsSync(srcAppDir) ? srcAppDir : null);
  if (!root) stop('no app/ directory found');

  const all = walk(root, { exts: ['.ts', '.tsx', '.js', '.jsx'], absolute: true });
  const items = [];
  for (const f of all) {
    const base = basename(f);
    // Detect parallel/intercepted routes — STOP
    if (/[/\\]@[^/\\]+[/\\]/.test(f)) stop(`parallel route detected: ${relative(appRoot, f)}`);
    if (/\([\.][^)]+\)/.test(f)) stop(`intercepted route detected: ${relative(appRoot, f)}`);
    // Default api routes — skip (out of scope)
    if (f.includes('/app/api/') || f.includes('/src/app/api/')) continue;
    if (/^route\./.test(base)) continue; // route handlers (just in case)
    if (/^default\./.test(base)) stop(`parallel-routes default file: ${relative(appRoot, f)}`);
    // page/layout/loading/error/not-found/template — port these
    if (/^(page|layout|loading|error|not-found|template)\.[jt]sx?$/.test(base)) items.push(f);
  }
  state.queues.routes = { items, cursor: 0, doneCount: 0, appRoot: root };
  writeState(sourceRoot, state);
}

const q = state.queues.routes;
const BATCH = Number(args.flags.batch === true ? 5 : (args.flags.batch || 5));
const end = Math.min(q.items.length, q.cursor + BATCH);

const todos = [];
const stopsEncountered = [];
let processed = 0;

function pathFromAppDir(srcFile, appRoot) {
  let rel = relative(appRoot, srcFile);
  // Drop the file name; we keep the dir as routing path
  const segs = rel.split(/[/\\]/).slice(0, -1); // dir parts only
  // route groups (folder) → omitted from path
  const cleaned = segs.filter(s => !/^\([^)]+\)$/.test(s));
  // [param] → :param ; [...slug] / [[...slug]] → *
  const route = cleaned.map(s => {
    if (/^\[\[\.\.\..+\]\]$/.test(s)) return '*';
    if (/^\[\.\.\..+\]$/.test(s)) return '*';
    if (/^\[(.+)\]$/.test(s)) return ':' + s.slice(1, -1);
    return s;
  }).join('/');
  return '/' + route;
}

for (let i = q.cursor; i < end; i++) {
  const srcFile = q.items[i];
  const base = basename(srcFile);
  const kind = base.replace(/\.[jt]sx?$/, ''); // page | layout | loading | error | not-found | template
  const routePath = pathFromAppDir(srcFile, q.appRoot);

  const content = readFileSync(srcFile, 'utf8');

  // Detect server-only API usage in route file
  if (/\b(?:cookies|headers|draftMode)\s*\(\s*\)/.test(content) && /from\s+['"]next\/headers['"]/.test(content)) {
    stopsEncountered.push({ file: relative(appRoot, srcFile), stops: ['server-only cookies/headers/draftMode'] });
    continue;
  }
  if (/from\s+['"]next-intl\/server['"]/.test(content)) {
    stopsEncountered.push({ file: relative(appRoot, srcFile), stops: ['imports from next-intl/server'] });
    continue;
  }

  // Apply common transforms
  const { text, stops: tStops } = applyTransforms(content, { uiMapping, i18nMapping, todos });
  if (tStops.length > 0) {
    stopsEncountered.push({ file: relative(appRoot, srcFile), stops: tStops });
    continue;
  }

  // Rewrite async params/searchParams: replace `await params` with hook + drop async on default export.
  let body = text;
  body = body.replace(/await\s+params/g, 'params');
  body = body.replace(/await\s+searchParams/g, 'searchParams');

  // Insert RR hook injection at top of default-exported function
  // (best-effort; the agent will adjust)
  if (/\bparams\b/.test(body) && !/useParams\(/.test(body)) {
    body = body.replace(/import \{([^}]+)\} from 'react-router-dom';/, (full, items) => {
      const list = items.split(',').map(s => s.trim());
      if (!list.includes('useParams')) list.push('useParams');
      return `import { ${list.join(', ')} } from 'react-router-dom';`;
    });
    if (!/from 'react-router-dom'/.test(body)) {
      body = `import { useParams } from 'react-router-dom';\n` + body;
    }
  }
  if (/\bsearchParams\b/.test(body) && !/useSearchParams\(/.test(body)) {
    if (/import \{([^}]+)\} from 'react-router-dom';/.test(body)) {
      body = body.replace(/import \{([^}]+)\} from 'react-router-dom';/, (full, items) => {
        const list = items.split(',').map(s => s.trim());
        if (!list.includes('useSearchParams')) list.push('useSearchParams');
        return `import { ${list.join(', ')} } from 'react-router-dom';`;
      });
    } else {
      body = `import { useSearchParams } from 'react-router-dom';\n` + body;
    }
  }

  // Determine destination + write meta
  const relDir = relative(q.appRoot, dirname(srcFile));
  const dstDir = join(target, 'src', 'routes', relDir);
  mkdirSync(dstDir, { recursive: true });
  const dstFile = join(dstDir, base.replace(/\.([jt]sx?)$/, kind === 'layout' ? '._layout.$1' : `.$1`).replace('._layout.', '_layout.'));
  // Actually simpler: keep filename but rename layout → _layout
  let outName = base;
  if (kind === 'layout') outName = '_layout' + base.slice('layout'.length);
  const finalDst = join(dstDir, outName);
  writeFile(finalDst, body);

  // Emit route.meta.json (one per page/layout/error/notfound/loading, deduped per dir)
  const metaPath = join(dstDir, 'route.meta.json');
  const meta = readJson(metaPath, { dir: relDir, path: routePath, kinds: {} });
  meta.kinds[kind] = outName;
  writeJson(metaPath, meta);

  processed++;
}

q.cursor = end;
q.doneCount += processed;
writeState(sourceRoot, state);

if (stopsEncountered.length > 0) {
  const lines = stopsEncountered.flatMap(s => s.stops.map(r => `- ${s.file}: ${r}`));
  const log = logSidecar(sourceRoot, SCRIPT, lines.join('\n'));
  stop(`${stopsEncountered.length} routes have STOP issues`, log);
}

if (todos.length > 0) {
  appendFileSync(join(target, 'MIGRATION_NOTES.md'),
    `\n## Phase 4b — TODOs from route port\n\n` +
    [...new Set(todos)].map(t => `- ${t}`).join('\n') + '\n');
}

if (q.cursor >= q.items.length) {
  const tsc = run('npx', ['tsc', '--noEmit'], { cwd: target });
  if (tsc.code !== 0) {
    const log = logSidecar(sourceRoot, SCRIPT, tsc.stderr || tsc.stdout);
    say(`tsc warnings after routes (continuing): ${log}`);
  }
}

state.step = 'routes';
writeState(sourceRoot, state);

say(`port-routes: batch=${processed} cursor=${q.cursor}/${q.items.length} done=${q.doneCount}`);
