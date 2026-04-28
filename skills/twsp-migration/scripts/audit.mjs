#!/usr/bin/env node
// Phase 0 — Audit source repo.
// Reads sourceRoot, writes <sourceRoot>/.twsp/{audit,migration,state}.json.
//
// Usage:
//   node audit.mjs --source <path> --target <path> [--in-house-pkg <name>]
//   node audit.mjs --self-test

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  say, stop, parseArgs, selfTestGate, ensureTwspDir, twspDir,
  writeJson, readJson, walk, readPkg, depVersion, detectMajor,
} from './_lib.mjs';

const SCRIPT = 'audit.mjs';
const args = parseArgs(process.argv.slice(2));
selfTestGate(args, SCRIPT);

const sourceRoot = args.flags.source ? resolve(args.flags.source) : null;
const targetRoot = args.flags.target ? resolve(args.flags.target) : null;
if (!sourceRoot || !targetRoot) stop('audit needs --source <sourceRoot> --target <targetRoot>');
if (!existsSync(sourceRoot)) stop(`source not found: ${sourceRoot}`);
if (existsSync(targetRoot)) {
  const entries = readdirSync(targetRoot).filter(n => !n.startsWith('.'));
  if (entries.length > 0) stop(`targetRoot is not empty: ${targetRoot}`);
}

const pkg = readPkg(sourceRoot);
if (!pkg) stop(`no package.json at ${sourceRoot}`);

// ── Detect package presence / versions ──────────────────────────────
const reactVer = depVersion(pkg, 'react');
const reactDomVer = depVersion(pkg, 'react-dom');
const nextVer = depVersion(pkg, 'next');
const tailwindVer = depVersion(pkg, 'tailwindcss');
const typesReactVer = depVersion(pkg, '@types/react');
const nextIntlVer = depVersion(pkg, 'next-intl');

const nextMajor = detectMajor(nextVer);

// ── Detect file presence ────────────────────────────────────────────
const hasAppDir = existsSync(join(sourceRoot, 'app'));
const hasPagesDir = existsSync(join(sourceRoot, 'pages'));
const hasShadcn = existsSync(join(sourceRoot, 'components.json'));
const hasMiddleware =
  existsSync(join(sourceRoot, 'middleware.ts')) ||
  existsSync(join(sourceRoot, 'middleware.tsx')) ||
  existsSync(join(sourceRoot, 'middleware.js')) ||
  existsSync(join(sourceRoot, 'src', 'middleware.ts'));

// In-house pkg detection. Strategy: user-supplied name wins; otherwise
// look for any dependency starting with @<scope>/ that is NOT well-known.
const knownScopes = new Set([
  '@types', '@tailwindcss', '@rsbuild', '@radix-ui', '@hookform', '@tanstack',
  '@floating-ui', '@vercel', '@next', '@swc', '@babel', '@eslint', '@typescript-eslint',
  '@testing-library', '@reduxjs', '@react-types', '@lexical', '@formatjs',
]);
let inHousePkg = args.flags['in-house-pkg'] || null;
if (!inHousePkg) {
  const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  for (const name of Object.keys(allDeps)) {
    const m = name.match(/^@([^/]+)\//);
    if (!m) continue;
    if (knownScopes.has(`@${m[1]}`)) continue;
    inHousePkg = name; // first match — heuristic, user can override
    break;
  }
}

// ── Grep code under app/ + src/ ─────────────────────────────────────
const codeDirs = ['app', 'src', 'pages'].map(d => join(sourceRoot, d)).filter(existsSync);
const codeFiles = codeDirs.flatMap(d => walk(d, { exts: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'] }));

let useServerHits = 0;
let nextImageHits = 0;
let nextFontHits = 0;
let asyncCookiesHeadersHits = 0;
let serverIntlHits = 0;
let apiRouteCount = 0;
let hasLocaleSegment = false;

const useServerRe = /['"]use server['"]/;
const nextImageRe = /from\s+['"]next\/image['"]/;
const nextFontRe = /from\s+['"]next\/font/;
const cookiesHeadersRe = /\b(?:cookies|headers|draftMode)\s*\(\s*\)/;
const serverIntlRe = /from\s+['"]next-intl\/server['"]/;

// Walk app/api specifically
if (hasAppDir) {
  const apiDir = join(sourceRoot, 'app', 'api');
  if (existsSync(apiDir)) {
    apiRouteCount = walk(apiDir, { exts: ['.ts', '.tsx', '.js'] }).filter(p => /\/route\.[jt]sx?$/.test(p)).length;
  }
  // [locale] segment detection
  const checkLocale = (d) => {
    if (!existsSync(d)) return;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (e.name === '[locale]') { hasLocaleSegment = true; return; }
      }
    }
  };
  checkLocale(join(sourceRoot, 'app'));
  checkLocale(join(sourceRoot, 'src', 'app'));
}

for (const f of codeFiles) {
  let content;
  try { content = (await import('node:fs')).readFileSync(f, 'utf8'); } catch { continue; }
  if (useServerRe.test(content)) useServerHits++;
  if (nextImageRe.test(content)) nextImageHits++;
  if (nextFontRe.test(content)) nextFontHits++;
  if (cookiesHeadersRe.test(content)) asyncCookiesHeadersHits++;
  if (serverIntlRe.test(content)) serverIntlHits++;
}

// ── In-house pkg usage check ────────────────────────────────────────
let inHouseImportCount = 0;
if (inHousePkg) {
  const re = new RegExp(`from\\s+['"]${inHousePkg.replace(/[/.]/g, '\\$&')}(?:/|['"])`, 'g');
  for (const f of codeFiles) {
    let content;
    try { content = (await import('node:fs')).readFileSync(f, 'utf8'); } catch { continue; }
    const m = content.match(re);
    if (m) inHouseImportCount += m.length;
  }
  if (inHouseImportCount === 0) inHousePkg = null; // false positive
}

const hasNextIntl = !!nextIntlVer;
const requiresUiSpec = !!inHousePkg;
const requiresI18nSpec = hasNextIntl;

// ── STOP gates ──────────────────────────────────────────────────────
if (hasPagesDir) stop('out of scope: pages/ router');
if (!hasAppDir) stop('source has no app/ directory; nothing to port');

// ── Skip flags ──────────────────────────────────────────────────────
const skips = {
  uiMapping: !requiresUiSpec,
  i18nMapping: !requiresI18nSpec,
  apiRoutes: apiRouteCount === 0,
};

// ── Write outputs ───────────────────────────────────────────────────
ensureTwspDir(sourceRoot);

const audit = {
  audited_at: new Date().toISOString(),
  sourceRoot, targetRoot,
  react: reactVer, reactDom: reactDomVer,
  next: nextVer, nextMajor,
  tailwind: tailwindVer,
  typesReact: typesReactVer,
  hasShadcn,
  inHousePkg, inHouseImportCount,
  hasNextIntl, nextIntlVersion: nextIntlVer,
  hasLocaleSegment,
  hasMiddleware,
  apiRouteCount,
  useServerHits,
  nextImageHits,
  nextFontHits,
  asyncCookiesHeadersHits,
  serverIntlHits,
  hasPagesDir,
  requiresUiSpec, requiresI18nSpec,
  skips,
};
writeJson(join(twspDir(sourceRoot), 'audit.json'), audit);

writeJson(join(twspDir(sourceRoot), 'migration.json'), {
  sourceRoot, targetRoot, createdAt: new Date().toISOString(),
});

writeJson(join(twspDir(sourceRoot), 'state.json'), {
  phase: '1', step: 'scaffold', queues: {}, pending: null, lastError: null,
});

say(`audit: react=${reactVer} next=${nextVer}(maj=${nextMajor}) tw=${tailwindVer} shadcn=${hasShadcn} intl=${hasNextIntl} inhouse=${inHousePkg || 'none'} api=${apiRouteCount} mw=${hasMiddleware}`);
say(`stop-risks: useServer=${useServerHits} nextImage=${nextImageHits} nextFont=${nextFontHits} serverApis=${asyncCookiesHeadersHits} serverIntl=${serverIntlHits}`);
