#!/usr/bin/env node
// Phase 2c — Port eslint config (legacy or flat → flat without next/*).

import { existsSync, readFileSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  say, stop, parseArgs, selfTestGate, readMigration, readState, writeState,
  readTemplate, writeFile, readPkg, writePkg,
} from './_lib.mjs';

const SCRIPT = 'port-eslint.mjs';
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
const appRoot = m.appPackageRoot || sourceRoot;

// ── Detect source eslint config ─────────────────────────────────────
const flatNames = ['eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs', 'eslint.config.ts'];
const legacyNames = ['.eslintrc.json', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.yml', '.eslintrc.yaml'];

let format = 'none';
let srcEslintText = '';
let srcEslintObj = null;
let srcEslintPath = null;

for (const n of flatNames) {
  const p = join(appRoot, n);
  if (existsSync(p)) { format = 'flat'; srcEslintPath = p; srcEslintText = readFileSync(p, 'utf8'); break; }
}
if (format === 'none') {
  for (const n of legacyNames) {
    const p = join(appRoot, n);
    if (existsSync(p)) {
      format = 'legacy';
      srcEslintPath = p;
      srcEslintText = readFileSync(p, 'utf8');
      if (n.endsWith('.json')) {
        try { srcEslintObj = JSON.parse(srcEslintText); } catch {}
      }
      break;
    }
  }
}
if (format === 'none') {
  // Check package.json eslintConfig
  const pkg = readPkg(appRoot);
  if (pkg && pkg.eslintConfig) {
    format = 'legacy';
    srcEslintObj = pkg.eslintConfig;
  }
}

// ── Extract carryable rules ─────────────────────────────────────────
let carriedRules = {};
let unknownExtends = [];
let customPlugins = [];

const stripPatterns = [
  /^next\/.*$/, /^plugin:@next\/.*$/, /^@next\/.*$/, /^next$/,
];
const extendsTranslation = {
  'eslint:recommended': null, // already in flat
  'plugin:@typescript-eslint/recommended': null,
  'plugin:@typescript-eslint/strict': null,
  'plugin:react/recommended': null,
  'plugin:react-hooks/recommended': null,
  'plugin:jsx-a11y/recommended': null,
  'plugin:import/recommended': null,
  'plugin:import/typescript': null,
  'prettier': null,
};

if (srcEslintObj && srcEslintObj.rules) {
  for (const [k, v] of Object.entries(srcEslintObj.rules)) {
    if (k.startsWith('@next/next/')) continue;
    carriedRules[k] = v;
  }
}
if (srcEslintObj && Array.isArray(srcEslintObj.extends)) {
  for (const e of srcEslintObj.extends) {
    if (stripPatterns.some(re => re.test(e))) continue;
    if (e in extendsTranslation) continue;
    unknownExtends.push(e);
  }
}
if (srcEslintObj && Array.isArray(srcEslintObj.plugins)) {
  for (const p of srcEslintObj.plugins) {
    if (p === '@next/next' || p === 'next' || p === 'react' || p === 'react-hooks' || p === 'jsx-a11y' || p === '@typescript-eslint') continue;
    customPlugins.push(p);
  }
}

// For flat configs (text), do a regex-level scan for carry-overs.
if (format === 'flat') {
  // Pull rules: { ... } block(s) and extract "<key>": "<val>" entries that are NOT @next/next/.
  const ruleBlockRe = /rules\s*:\s*\{([\s\S]*?)\}/g;
  let mm;
  while ((mm = ruleBlockRe.exec(srcEslintText)) !== null) {
    const body = mm[1];
    const ruleRe = /['"]([^'"]+)['"]\s*:\s*(['"][^'"]+['"]|\d+|\[[^\]]*\])/g;
    let rr;
    while ((rr = ruleRe.exec(body)) !== null) {
      const k = rr[1];
      if (k.startsWith('@next/next/')) continue;
      try {
        const valStr = rr[2].startsWith('[') ? JSON.parse(rr[2].replace(/'/g, '"')) : (rr[2].startsWith('"') || rr[2].startsWith("'")) ? rr[2].slice(1, -1) : Number(rr[2]);
        carriedRules[k] = valStr;
      } catch {
        // best-effort
      }
    }
  }
}

if (unknownExtends.length > 0) {
  appendFileSync(join(target, 'MIGRATION_NOTES.md'),
    `\n## Phase 2c — eslint extends not auto-translated\n\n` +
    unknownExtends.map(e => `- ${e}`).join('\n') +
    `\n\nReview each and add the corresponding flat-config equivalent to eslint.config.js.\n`);
}

if (customPlugins.length > 0) {
  appendFileSync(join(target, 'MIGRATION_NOTES.md'),
    `\n## Phase 2c — Custom eslint plugins from source\n\n` +
    customPlugins.map(p => `- ${p}`).join('\n') +
    `\n\nConfirm each works without Next; add to flat config if so.\n`);
}

// ── Render target eslint.config.js ──────────────────────────────────
let out = readTemplate('eslint.config.js.tmpl');
const carriedRulesStr = Object.entries(carriedRules)
  .map(([k, v]) => `      '${k}': ${JSON.stringify(v)},`)
  .join('\n');
out = out.replace('// <CARRIED_OVER_RULES>', carriedRulesStr || '// (no rules carried over from source)');
writeFile(join(target, 'eslint.config.js'), out);

// ── Update target package.json: drop next eslint, ensure new ones ──
const pkg = readPkg(target);
if (pkg) {
  const dd = pkg.devDependencies || {};
  delete dd['eslint-config-next'];
  delete dd['@next/eslint-plugin-next'];
  // The template already lists modern eslint deps; nothing else to add.
  pkg.devDependencies = dd;
  pkg.scripts = { ...(pkg.scripts || {}), lint: 'eslint . --max-warnings=0' };
  writePkg(target, pkg);
}

// ── State ───────────────────────────────────────────────────────────
const state = readState(sourceRoot);
state.step = 'eslint';
writeState(sourceRoot, state);

say(`port-eslint: format=${format} rules-carried=${Object.keys(carriedRules).length} unknown-extends=${unknownExtends.length} custom-plugins=${customPlugins.length}`);
