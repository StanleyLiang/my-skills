#!/usr/bin/env node
// Phase 5 — Wire entrypoint.
// Walks <targetRoot>/src/routes/**/route.meta.json, builds RouteObject[] tree,
// writes <targetRoot>/src/routes.gen.ts and src/main.tsx (with intl provider if applicable).

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative, dirname } from 'node:path';
import {
  say, stop, parseArgs, selfTestGate, readMigration, readState, writeState,
  readJson, readTemplate, writeFile, run, logSidecar, twspDir,
} from './_lib.mjs';

const SCRIPT = 'wire-entrypoint.mjs';
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
const target = m.targetRoot;
const T = twspDir(sourceRoot);

const i18nMapping = readJson(join(T, 'i18n-mapping.json'));

// ── Walk routes/ and collect meta ───────────────────────────────────
const routesRoot = join(target, 'src', 'routes');
if (!existsSync(routesRoot)) stop(`no routes directory at ${routesRoot}`);

const metaList = [];
function walkMeta(dir) {
  const meta = readJson(join(dir, 'route.meta.json'));
  if (meta) metaList.push({ dir: relative(routesRoot, dir) || '', meta });
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) walkMeta(join(dir, e.name));
  }
}
walkMeta(routesRoot);

// ── Build a tree by sorting on dir depth ────────────────────────────
metaList.sort((a, b) => a.dir.length - b.dir.length);

// Build a routes.gen.ts content: a flat RouteObject[] keyed by `path` from meta.
const importLines = [];
const routeEntries = [];
let lazyIdx = 0;
for (const item of metaList) {
  const k = item.meta.kinds || {};
  const dirRel = item.meta.dir || '';
  const importPathFor = (file) => {
    const rel = ('./' + (dirRel ? dirRel + '/' : '') + file).replace(/\.[jt]sx?$/, '');
    return rel.replace(/\\/g, '/');
  };

  const fields = {};
  if (k.layout) {
    const id = `R${lazyIdx++}`;
    importLines.push(`const ${id} = lazy(() => import('${importPathFor(k.layout)}'));`);
    fields.layoutId = id;
  }
  if (k.page) {
    const id = `R${lazyIdx++}`;
    importLines.push(`const ${id} = lazy(() => import('${importPathFor(k.page)}'));`);
    fields.pageId = id;
  }
  if (k.error) {
    const id = `R${lazyIdx++}`;
    importLines.push(`const ${id} = lazy(() => import('${importPathFor(k.error)}'));`);
    fields.errorId = id;
  }
  if (k['not-found']) {
    const id = `R${lazyIdx++}`;
    importLines.push(`const ${id} = lazy(() => import('${importPathFor(k['not-found'])}'));`);
    fields.notFoundId = id;
  }

  routeEntries.push({ path: item.meta.path, dir: dirRel, fields });
}

// Generate flat RouteObject[] (we don't attempt to nest layouts here — RR can
// also handle a flat tree; nested layouts are a TODO for the user).
let body = `import { lazy } from 'react';\nimport type { RouteObject } from 'react-router-dom';\n`;
body += importLines.join('\n') + '\n\n';
body += `export const routes: RouteObject[] = [\n`;
for (const r of routeEntries) {
  if (!r.fields.pageId && !r.fields.layoutId) continue;
  const Comp = r.fields.pageId || r.fields.layoutId;
  let entry = `  { path: ${JSON.stringify(r.path || '/')}, Component: ${Comp}`;
  if (r.fields.errorId) entry += `, errorElement: <${r.fields.errorId} />`;
  entry += ` },`;
  body += entry + '\n';
}
body += `];\n`;

writeFile(join(target, 'src', 'routes.gen.ts'), body);

// ── Wire main.tsx ───────────────────────────────────────────────────
let mainTpl = readTemplate('main.tsx.tmpl');

if (i18nMapping && i18nMapping.provider) {
  const p = i18nMapping.provider;
  mainTpl = mainTpl.replace('// <INTL_IMPORT>', `import { ${p.exportName} } from '${p.importPath}';`);
  mainTpl = mainTpl.replace('{/* <INTL_PROVIDER_OPEN> */}', `<${p.exportName} messages={{}} locale="en">`);
  mainTpl = mainTpl.replace('{/* <INTL_PROVIDER_CLOSE> */}', `</${p.exportName}>`);
} else {
  mainTpl = mainTpl
    .replace(/\/\/ <INTL_IMPORT>.*\n/g, '')
    .replace(/\{\/\* <INTL_PROVIDER_OPEN> \*\/\}\s*/g, '')
    .replace(/\s*\{\/\* <INTL_PROVIDER_CLOSE> \*\/\}/g, '');
}
writeFile(join(target, 'src', 'main.tsx'), mainTpl);

// ── Final verify ────────────────────────────────────────────────────
const tsc = run('npx', ['tsc', '--noEmit'], { cwd: target });
if (tsc.code !== 0) {
  const log = logSidecar(sourceRoot, SCRIPT, tsc.stderr || tsc.stdout);
  stop('final tsc failed', log);
}
const build = run('npx', ['rsbuild', 'build'], { cwd: target });
if (build.code !== 0) {
  const log = logSidecar(sourceRoot, SCRIPT, build.stderr || build.stdout);
  stop('final rsbuild build failed', log);
}

const state = readState(sourceRoot);
state.step = 'wire';
writeState(sourceRoot, state);

say(`wire-entrypoint: routes=${routeEntries.length} provider=${i18nMapping?.provider?.exportName || 'none'}`);
