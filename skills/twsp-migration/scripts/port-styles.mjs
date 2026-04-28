#!/usr/bin/env node
// Phase 2a — Port styles (Tailwind v3 → v4 CSS-first).
// Reads <sourceRoot>/tailwind.config.{ts,js,cjs,mjs} and <sourceRoot>/{app,src}/**/*.css.
// Writes <targetRoot>/src/index.css with @theme block + prefix/important translation.

import { existsSync, readFileSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  say, stop, parseArgs, selfTestGate, readMigration, readState, writeState,
  walk, readTemplate, writeFile, logSidecar,
} from './_lib.mjs';

const SCRIPT = 'port-styles.mjs';
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

// ── Find source tailwind config ─────────────────────────────────────
const cfgCandidates = ['tailwind.config.ts', 'tailwind.config.js', 'tailwind.config.cjs', 'tailwind.config.mjs'];
let cfgPath = null;
for (const n of cfgCandidates) if (existsSync(join(sourceRoot, n))) { cfgPath = join(sourceRoot, n); break; }

let cfgText = '';
if (cfgPath) cfgText = readFileSync(cfgPath, 'utf8');

// ── Extract prefix / important / darkMode ───────────────────────────
function extractStr(re) {
  const m = cfgText.match(re);
  return m ? m[1] : null;
}
const prefix = extractStr(/prefix\s*:\s*['"]([^'"]+?)-?['"]/);
const important = extractStr(/important\s*:\s*['"]([^'"]+)['"]/);
const importantBool = /important\s*:\s*true/.test(cfgText);
const darkMode = extractStr(/darkMode\s*:\s*['"]([^'"]+)['"]/);

// ── Extract theme.extend tokens (color/spacing/font/radius/shadow) ──
// Crude but effective: pull each named subtree as text, then scrape "key: 'value'" pairs.
function extractObjBlock(text, key) {
  const re = new RegExp(`${key}\\s*:\\s*\\{`);
  const m = text.match(re);
  if (!m) return null;
  let i = m.index + m[0].length;
  let depth = 1;
  let start = i;
  while (i < text.length && depth > 0) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') depth--;
    i++;
  }
  return text.slice(start, i - 1);
}

const themeExtend = extractObjBlock(cfgText, 'extend') || '';
const tokens = [];
function harvestNamespace(ns, cssPrefix) {
  const block = extractObjBlock(themeExtend, ns);
  if (!block) return;
  // Match pairs like `key: 'value'` or `key: "value"` or unquoted `key: someExpr,`
  const re = /([a-zA-Z0-9_$\-]+|'[^']+'|"[^"]+")\s*:\s*('[^']*'|"[^"]*"|[^,{}\n]+)/g;
  let mm;
  while ((mm = re.exec(block)) !== null) {
    let key = mm[1].replace(/^['"]|['"]$/g, '');
    let val = mm[2].trim().replace(/[,;]+$/, '');
    // Skip nested objects (multi-line); we only want flat values
    if (val.startsWith('{')) continue;
    val = val.replace(/^['"]|['"]$/g, '');
    tokens.push(`  --${cssPrefix}-${key}: ${val};`);
  }
}

harvestNamespace('colors', 'color');
harvestNamespace('spacing', 'spacing');
harvestNamespace('fontFamily', 'font');
harvestNamespace('fontSize', 'text');
harvestNamespace('borderRadius', 'radius');
harvestNamespace('boxShadow', 'shadow');
harvestNamespace('screens', 'breakpoint');
harvestNamespace('zIndex', 'z');

// ── Find source globals.css and split into layers ───────────────────
const globalsCandidates = [
  join(sourceRoot, 'app', 'globals.css'),
  join(sourceRoot, 'app', 'global.css'),
  join(sourceRoot, 'src', 'app', 'globals.css'),
  join(sourceRoot, 'src', 'index.css'),
  join(sourceRoot, 'src', 'styles', 'globals.css'),
  join(sourceRoot, 'styles', 'globals.css'),
];
let globalsText = '';
let globalsPath = null;
for (const p of globalsCandidates) if (existsSync(p)) { globalsText = readFileSync(p, 'utf8'); globalsPath = p; break; }

// Strip v3 directives
let cleanedGlobals = globalsText
  .replace(/@tailwind\s+(?:base|components|utilities|screens|variants);?\s*\n?/g, '')
  .replace(/@layer\s+(base|components|utilities)\s*\{/g, '@layer $1 {');

// Detect bare @apply outside @layer (reject)
const lines = cleanedGlobals.split('\n');
let depth = 0;
let inLayer = false;
const bareApplyOffenders = [];
for (let i = 0; i < lines.length; i++) {
  const ln = lines[i];
  const opens = (ln.match(/\{/g) || []).length;
  const closes = (ln.match(/\}/g) || []).length;
  if (/@layer\s+(base|components|utilities)/.test(ln)) inLayer = true;
  if (/@apply/.test(ln) && !inLayer) bareApplyOffenders.push(i + 1);
  depth += opens - closes;
  if (depth <= 0) inLayer = false;
}

if (bareApplyOffenders.length > 0) {
  const log = logSidecar(sourceRoot, SCRIPT, `bare @apply outside @layer in ${globalsPath}:\n` + bareApplyOffenders.map(n => `  line ${n}`).join('\n'));
  stop(`@apply outside @layer (${bareApplyOffenders.length} occurrences)`, log);
}

// ── Detect custom JS plugins ────────────────────────────────────────
const pluginsBlock = extractObjBlock(cfgText, 'plugins');
const customPlugins = [];
if (pluginsBlock) {
  const reqRe = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  let mm;
  while ((mm = reqRe.exec(pluginsBlock)) !== null) customPlugins.push(mm[1]);
  // Inline functions like `function({ addUtilities }) {...}` or `plugin(...)`
  if (/function\s*\(/.test(pluginsBlock) || /plugin\s*\(/.test(pluginsBlock)) {
    customPlugins.push('<inline plugin function>');
  }
}

// ── Build target src/index.css ──────────────────────────────────────
let importLine = '@import "tailwindcss"';
if (prefix) importLine += ` prefix(${prefix})`;
if (important && !importantBool) importLine += ` important(${important})`;
importLine += ';';

let darkVariant = '';
if (darkMode === 'class' || darkMode === 'selector') {
  darkVariant = '@custom-variant dark (&:where(.dark, .dark *));';
}

const themeBody = tokens.length > 0 ? tokens.join('\n') : '  /* (no tokens detected from source theme.extend) */';

let out = readTemplate('index.css.tmpl');
out = out
  .replace('@import "tailwindcss"<PREFIX_AND_IMPORTANT>;', importLine)
  .replace('<DARK_VARIANT>', darkVariant)
  .replace('<THEME_TOKENS>', themeBody)
  .replace('<LAYER_BASE>\n<LAYER_COMPONENTS>\n<LAYER_UTILITIES>', cleanedGlobals.trim());

writeFile(join(target, 'src', 'index.css'), out);

// ── Update target components.json prefix if it exists ──────────────
const cjPath = join(target, 'components.json');
if (existsSync(cjPath)) {
  const cj = JSON.parse(readFileSync(cjPath, 'utf8'));
  if (prefix) cj.tailwind = { ...(cj.tailwind || {}), prefix };
  writeFile(cjPath, JSON.stringify(cj, null, 2) + '\n');
}

// ── MIGRATION_NOTES for plugins ─────────────────────────────────────
if (customPlugins.length > 0) {
  appendFileSync(join(target, 'MIGRATION_NOTES.md'),
    `\n## Phase 2a — Tailwind plugins (manual conversion)\n\n` +
    `Source had these plugins; convert to v4 CSS or @plugin directives:\n\n` +
    customPlugins.map(p => `- ${p}`).join('\n') + '\n');
}

// ── Verify build ────────────────────────────────────────────────────
const { run } = await import('./_lib.mjs');
const r = run('npx', ['rsbuild', 'build'], { cwd: target });
if (r.code !== 0) {
  const log = logSidecar(sourceRoot, SCRIPT, r.stderr || r.stdout);
  stop('rsbuild build failed after style port', log);
}

// ── State ───────────────────────────────────────────────────────────
const state = readState(sourceRoot);
state.step = 'styles';
writeState(sourceRoot, state);

say(`port-styles: prefix=${prefix || 'none'} important=${important || 'none'} darkMode=${darkMode || 'media'} tokens=${tokens.length} plugins=${customPlugins.length}`);
