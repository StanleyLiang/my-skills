#!/usr/bin/env node
// Phase 2b — Port tsconfig.
// Reads <sourceRoot>/tsconfig.json (resolving extends), writes <targetRoot>/tsconfig.json
// per the strip/keep/set rules in references/tsconfig-translation.md.
// Also mirrors `paths` into <targetRoot>/rsbuild.config.ts source.alias.

import { existsSync, readFileSync, appendFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import {
  say, stop, parseArgs, selfTestGate, readMigration, readState, writeState,
  readJson, writeFile, logSidecar,
} from './_lib.mjs';

const SCRIPT = 'port-tsconfig.mjs';
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

// Strip JSON comments (TS allows them in tsconfig)
function stripJsonComments(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/,(\s*[}\]])/g, '$1');
}
function readTsconfig(p) {
  const raw = readFileSync(p, 'utf8');
  return JSON.parse(stripJsonComments(raw));
}

const srcTsPath = join(sourceRoot, 'tsconfig.json');
if (!existsSync(srcTsPath)) {
  // No source tsconfig — keep target template as-is.
  const state = readState(sourceRoot);
  state.step = 'tsconfig';
  writeState(sourceRoot, state);
  say('port-tsconfig: no source tsconfig; kept target template');
  process.exit(0);
}

const srcTs = readTsconfig(srcTsPath);

// Resolve extends chain (only if it's a relative/absolute path file we can read)
function resolveExtends(cfg, baseDir) {
  if (!cfg.extends) return cfg;
  const ext = cfg.extends;
  const isNextPreset =
    ext === 'next/core-web-vitals' || ext === 'next/typescript' || ext === 'next' ||
    ext.startsWith('next/');
  if (isNextPreset) {
    // Strip; treat as if it didn't extend anything Next-specific.
    const { extends: _, ...rest } = cfg;
    return rest;
  }
  // Try to resolve as a path
  const candidates = [
    join(baseDir, ext),
    join(baseDir, ext + '.json'),
    join(baseDir, 'node_modules', ext, 'tsconfig.json'),
    join(baseDir, 'node_modules', ext + '.json'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      const parent = readTsconfig(p);
      const resolved = resolveExtends(parent, dirname(p));
      // Merge: parent ⊕ child
      return {
        ...resolved,
        ...cfg,
        compilerOptions: { ...(resolved.compilerOptions || {}), ...(cfg.compilerOptions || {}) },
      };
    }
  }
  // Couldn't resolve — keep extends so it's logged.
  return cfg;
}

const merged = resolveExtends(srcTs, sourceRoot);
const co = merged.compilerOptions || {};

// ── Strip ───────────────────────────────────────────────────────────
delete merged.extends;
delete co.incremental;
delete co.tsBuildInfoFile;

// Strip Next plugin
if (Array.isArray(co.plugins)) {
  co.plugins = co.plugins.filter(p => !(p && p.name && /^next/i.test(p.name)));
  if (co.plugins.length === 0) delete co.plugins;
}

// Strip Next types
if (Array.isArray(co.types)) {
  co.types = co.types.filter(t => !(t === 'next' || (typeof t === 'string' && t.startsWith('@next/'))));
  if (co.types.length === 0) delete co.types;
}

// ── Set rsbuild-friendly defaults ───────────────────────────────────
co.jsx = 'react-jsx';
co.module = 'ESNext';
co.moduleResolution = 'Bundler';
co.target = co.target || 'ES2022';
co.lib = co.lib || ['DOM', 'DOM.Iterable', 'ES2022'];
co.noEmit = true;
co.allowImportingTsExtensions = false;
co.isolatedModules = co.isolatedModules ?? true;
co.esModuleInterop = co.esModuleInterop ?? true;
co.skipLibCheck = co.skipLibCheck ?? true;
co.resolveJsonModule = co.resolveJsonModule ?? true;
co.useDefineForClassFields = co.useDefineForClassFields ?? true;
co.forceConsistentCasingInFileNames = co.forceConsistentCasingInFileNames ?? true;
co.strict = co.strict ?? true;

// ── include / exclude ──────────────────────────────────────────────
merged.include = ['src', 'index.html'];
merged.exclude = ['node_modules', 'dist'];

// Drop project references (logged)
let dropped = [];
if (Array.isArray(merged.references)) {
  dropped.push('references: ' + JSON.stringify(merged.references));
  delete merged.references;
}

// ── Write target tsconfig ───────────────────────────────────────────
merged.compilerOptions = co;
writeFile(join(target, 'tsconfig.json'), JSON.stringify(merged, null, 2) + '\n');

// ── Mirror paths into rsbuild.config.ts ─────────────────────────────
const rsbuildPath = join(target, 'rsbuild.config.ts');
if (existsSync(rsbuildPath) && co.paths) {
  let rs = readFileSync(rsbuildPath, 'utf8');
  const aliasLines = [];
  for (const [k, v] of Object.entries(co.paths)) {
    if (!Array.isArray(v) || v.length === 0) continue;
    const aliasKey = k.replace(/\/\*$/, '');
    const aliasVal = String(v[0]).replace(/\/\*$/, '');
    aliasLines.push(`      '${aliasKey}': '${aliasVal}',`);
  }
  if (aliasLines.length > 0) {
    rs = rs.replace(
      /alias:\s*\{[^}]*\}/,
      `alias: {\n${aliasLines.join('\n')}\n    }`
    );
    writeFile(rsbuildPath, rs);
  }
}

// ── MIGRATION_NOTES ─────────────────────────────────────────────────
if (dropped.length > 0) {
  appendFileSync(join(target, 'MIGRATION_NOTES.md'),
    `\n## Phase 2b — tsconfig items dropped\n\n` +
    dropped.map(s => `- ${s}`).join('\n') + '\n');
}

// ── State ───────────────────────────────────────────────────────────
const state = readState(sourceRoot);
state.step = 'tsconfig';
writeState(sourceRoot, state);

say(`port-tsconfig: paths=${Object.keys(co.paths || {}).length} jsx=react-jsx strict=${co.strict}`);
