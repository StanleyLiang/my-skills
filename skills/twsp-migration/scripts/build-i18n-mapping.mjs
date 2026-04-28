#!/usr/bin/env node
// Phase 3b — Build i18n mapping from user-supplied new-intl spec markdown.

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  say, stop, parseArgs, selfTestGate, readMigration, readAudit, readState, writeState,
  writeFile, writeJson, twspDir, walk,
} from './_lib.mjs';

const SCRIPT = 'build-i18n-mapping.mjs';
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
const T = twspDir(sourceRoot);

// ── Detect next-intl symbols actually used in source ────────────────
const NEXT_INTL_SYMBOLS = [
  'useTranslations', 'useFormatter', 'useLocale', 'useTimeZone', 'useNow', 'useMessages',
  'NextIntlClientProvider', 'createTranslator',
  'getTranslations', 'getFormatter', 'getLocale', 'getNow', 'getMessages', 'getTimeZone',
  'getRequestConfig', 'setRequestLocale',
];

const codeFiles = walk(sourceRoot, { exts: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'] });
const detected = new Set();
const importRe = /from\s+['"]next-intl(?:\/[^'"]*)?['"]/;
for (const f of codeFiles) {
  let content;
  try { content = readFileSync(f, 'utf8'); } catch { continue; }
  if (!importRe.test(content)) continue;
  for (const sym of NEXT_INTL_SYMBOLS) {
    if (new RegExp(`\\b${sym}\\b`).test(content)) detected.add(sym);
  }
}

if (args.flags['emit-prompt']) {
  const detectedList = [...detected].sort();
  const prompt = `# Phase 3b — New intl package spec needed\n\nThe migration detected \`next-intl\` (version ${audit.nextIntlVersion}) in source. Symbols actually used:\n\n${detectedList.map(s => `- \`${s}\``).join('\n')}\n\nPlease provide the new intl package's spec markdown. Either paste below, or send a single line \`PATH: /abs/path/to/spec.md\`.\n\n## Required spec sections\n\n1. **Package name** — \`name: @your/intl\`\n2. **Import paths** — e.g. \`@your/intl/react\` for client, etc.\n3. **Provider component** — name, props (\`messages\`, \`locale\`, etc.), import path.\n4. **Hook mappings** — for each next-intl symbol used above, the new-package replacement:\n   - export name (or \`DROP\`/\`STOP\`)\n   - call shape: \`function-positional\` (\`t(key, vals)\`) | \`function-object\` (\`t({key, ...vals})\`) | \`path-accessor\` (\`t.foo.bar(vals)\`)\n   - namespace mode: \`argument\` (\`useT('home')\`) | \`prefix-key\` (\`t('home.title')\`) | \`none\`\n5. **Locale routing strategy** — one of: \`pathname\` | \`subdomain\` | \`queryparam\` | \`context-only\`\n6. **Message file format** — \`identical\` | \`transform: <id>\` | \`manual\`. Plus messages dir path (e.g. \`messages/<locale>.json\`).\n\n## Example\n\n\`\`\`md\n# @your/intl spec\n\n- name: @your/intl\n- provider: { import: '@your/intl/react', name: IntlProvider, props: messages, locale }\n- localeRouting: pathname\n- messageFormat: identical\n- messagesDir: messages\n\n## Hook mappings\n\n| next-intl | replacement | callShape | namespaceMode | notes |\n|---|---|---|---|---|\n| useTranslations | { import: '@your/intl/react', name: useT } | function-positional | argument | |\n| useLocale | { name: useLocale } | function-positional | none | |\n| getTranslations | DROP | | | server-only — not ported |\n\`\`\`\n`;
  writeFile(join(T, 'prompts', 'i18n-spec.md'), prompt);
  const state = readState(sourceRoot);
  state.step = 'enter-3b';
  writeState(sourceRoot, state);
  say(`prompt written: ${join(T, 'prompts', 'i18n-spec.md')}`);
  process.exit(0);
}

// ── Read user's spec answer ─────────────────────────────────────────
const answerPath = join(T, 'answers', 'i18n-spec-answer.md');
if (!existsSync(answerPath)) stop(`missing user answer at ${answerPath}; run --emit-prompt first`);

let specText = readFileSync(answerPath, 'utf8').trim();
if (specText.startsWith('PATH:')) {
  const p = specText.slice(5).trim();
  if (!existsSync(p)) stop(`PATH not found: ${p}`);
  specText = readFileSync(p, 'utf8');
}

// ── Parse spec ──────────────────────────────────────────────────────
function findField(re, fallback = null) {
  const mm = specText.match(re);
  return mm ? mm[1].trim() : fallback;
}

const pkgName = findField(/(?:^|\n)\s*-?\s*name\s*:\s*([^\s\n]+)/i) || '@your/intl';
const localeRouting = findField(/localeRouting\s*:\s*([a-z-]+)/i) || 'pathname';
const messageFormat = findField(/messageFormat\s*:\s*([a-z-]+(?::\s*[a-zA-Z0-9_-]+)?)/i) || 'identical';
const messagesDir = findField(/messagesDir\s*:\s*([^\s\n]+)/i) || 'messages';

// Provider line: provider: { import: '...', name: '...' }
const providerImport = findField(/provider:\s*\{\s*import\s*:\s*['"]([^'"]+)['"]/) || pkgName;
const providerName = findField(/provider:\s*\{[^}]*name\s*:\s*([A-Za-z_$][A-Za-z0-9_$]*)/) || 'IntlProvider';

// Parse hook table
const hookTableRe = /\|\s*next-intl[^\n]*\n\|[-:\s|]+\|\n((?:\|[^\n]+\n?)+)/;
const hookMatch = specText.match(hookTableRe);
const hookRows = hookMatch ? hookMatch[1].trim().split('\n') : [];

const symbolMap = {};
for (const row of hookRows) {
  const cells = row.split('|').slice(1, -1).map(c => c.trim());
  if (cells.length < 2) continue;
  const sym = cells[0];
  const repl = cells[1];
  const callShape = cells[2] || 'function-positional';
  const nsMode = cells[3] || 'argument';
  const notes = cells[4] || '';

  if (/^DROP$/i.test(repl)) {
    symbolMap[sym] = { action: 'DROP', notes };
  } else if (/^STOP$/i.test(repl)) {
    symbolMap[sym] = { action: 'STOP', notes };
  } else {
    // Parse `{ import: '...', name: ... }`
    const im = repl.match(/import\s*:\s*['"]([^'"]+)['"]/);
    const nm = repl.match(/name\s*:\s*([A-Za-z_$][A-Za-z0-9_$]*)/);
    symbolMap[sym] = {
      replacement: { importPath: im ? im[1] : pkgName, exportName: nm ? nm[1] : sym },
      callShape, namespaceMode: nsMode, notes,
    };
  }
}

// ── Detect gaps ─────────────────────────────────────────────────────
const gaps = [...detected].filter(s => !(s in symbolMap));
const serverOnly = ['getTranslations', 'getFormatter', 'getLocale', 'getNow', 'getMessages', 'getTimeZone', 'getRequestConfig', 'setRequestLocale'];
const serverHits = [...detected].filter(s => serverOnly.includes(s));

// ── Write mapping ───────────────────────────────────────────────────
writeJson(join(T, 'i18n-mapping.json'), {
  generatedAt: new Date().toISOString(),
  newPackage: pkgName,
  provider: { importPath: providerImport, exportName: providerName },
  localeRouting,
  messageFormat,
  messagesDir,
  symbols: symbolMap,
  detectedSymbols: [...detected].sort(),
  gaps,
  serverOnlyHits: serverHits,
});

// ── Emit approval prompt ────────────────────────────────────────────
const lines = [];
lines.push('# Phase 3b — i18n mapping for review\n');
lines.push(`New package: \`${pkgName}\``);
lines.push(`Provider: \`<${providerName}>\` from \`${providerImport}\``);
lines.push(`Locale routing: \`${localeRouting}\` · message format: \`${messageFormat}\` · dir: \`${messagesDir}\`\n`);

lines.push('## Symbol mappings\n');
lines.push('| next-intl symbol | replacement | callShape | namespaceMode |');
lines.push('|---|---|---|---|');
for (const [sym, v] of Object.entries(symbolMap)) {
  if (v.action) lines.push(`| ${sym} | **${v.action}** | — | — |`);
  else lines.push(`| ${sym} | \`${v.replacement.exportName}\` from \`${v.replacement.importPath}\` | ${v.callShape} | ${v.namespaceMode} |`);
}

if (gaps.length > 0) {
  lines.push('\n## ⚠️ Gaps — symbols used in source but missing from spec\n');
  for (const g of gaps) lines.push(`- \`${g}\``);
  lines.push('\nAmend the spec to cover these (or mark them DROP/STOP) before approving.\n');
}

if (serverHits.length > 0) {
  lines.push('\n## Server-only symbols detected (will STOP in Phase 4 unless DROPed)\n');
  for (const s of serverHits) lines.push(`- \`${s}\``);
  lines.push('');
}

lines.push('\n## Approve?\n');
lines.push('- `yes` to proceed');
lines.push('- `no` to abort');
lines.push('- `EDITS:` block to amend mappings');
writeFile(join(T, 'prompts', 'i18n-approval.md'), lines.join('\n') + '\n');

const state = readState(sourceRoot);
state.step = 'parse-i18n-spec';
writeState(sourceRoot, state);

say(`i18n-mapping: pkg=${pkgName} symbols=${Object.keys(symbolMap).length} detected=${detected.size} gaps=${gaps.length} serverOnly=${serverHits.length}`);
