#!/usr/bin/env node
// Phase 0 — Audit source repo (and target).
// Reads sourceRoot, writes <sourceRoot>/.twsp/{audit,migration,state}.json.
//
// Source may be an npm/pnpm/yarn workspace; the script auto-detects which
// workspace package contains the Next.js app (heuristic: package.json with
// `next` dep + `app/` or `src/app/` directory). If 0 matches and the root
// has its own `app/`, falls back to root. If 2+ matches, STOPs and asks
// for `--app-package <relpath>`.
//
// Target may be an already-initialized npm project. If targetRoot has its
// own package.json, the script audits it instead of demanding emptiness;
// scaffold-target.mjs will merge rather than overwrite. Target with `next`
// in deps is rejected (that's a Next project, not a migration target).
//
// Usage:
//   node audit.mjs --source <path> --target <path>
//                  [--app-package <relpath>] [--in-house-pkg <name>]
//   node audit.mjs --self-test

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve, relative, isAbsolute } from 'node:path';
import {
  say, stop, parseArgs, selfTestGate, ensureTwspDir, twspDir,
  writeJson, walk, readPkg, depVersion, detectMajor,
} from './_lib.mjs';

const SCRIPT = 'audit.mjs';
const args = parseArgs(process.argv.slice(2));
selfTestGate(args, SCRIPT);

const sourceRoot = args.flags.source ? resolve(args.flags.source) : null;
const targetRoot = args.flags.target ? resolve(args.flags.target) : null;
if (!sourceRoot || !targetRoot) stop('audit needs --source <sourceRoot> --target <targetRoot>');
if (!existsSync(sourceRoot)) stop(`source not found: ${sourceRoot}`);

// ── Workspace + app-package resolution ──────────────────────────────
function readWorkspaceGlobs(rootDir) {
  const pkg = readPkg(rootDir);
  if (pkg) {
    const ws = pkg.workspaces;
    if (Array.isArray(ws)) return ws;
    if (ws && Array.isArray(ws.packages)) return ws.packages;
  }
  const pnpmPath = join(rootDir, 'pnpm-workspace.yaml');
  if (existsSync(pnpmPath)) {
    const text = readFileSync(pnpmPath, 'utf8');
    const lines = text.split('\n');
    const globs = [];
    let inPackages = false;
    for (const raw of lines) {
      const line = raw.replace(/#.*/, '').trimEnd();
      if (/^packages\s*:/i.test(line.trim())) { inPackages = true; continue; }
      if (inPackages) {
        const m = line.match(/^\s*-\s*['"]?([^'"\s]+)['"]?\s*$/);
        if (m) globs.push(m[1]);
        else if (/^\S/.test(line)) inPackages = false;
      }
    }
    if (globs.length) return globs;
  }
  return null;
}

function expandGlobs(rootDir, globs) {
  const out = new Set();
  for (const g of globs) {
    const segments = g.replace(/^\.\//, '').split('/').filter(Boolean);
    function rec(d, idx) {
      if (idx >= segments.length) {
        if (existsSync(join(d, 'package.json'))) out.add(d);
        return;
      }
      const seg = segments[idx];
      if (!existsSync(d)) return;
      if (seg === '*') {
        for (const e of readdirSync(d, { withFileTypes: true })) {
          if (e.isDirectory() && e.name !== 'node_modules') rec(join(d, e.name), idx + 1);
        }
      } else if (seg === '**') {
        rec(d, idx + 1);
        for (const e of readdirSync(d, { withFileTypes: true })) {
          if (e.isDirectory() && e.name !== 'node_modules') rec(join(d, e.name), idx);
        }
      } else {
        rec(join(d, seg), idx + 1);
      }
    }
    rec(rootDir, 0);
  }
  return [...out];
}

function findAppPackage(rootDir, overrideRel) {
  if (overrideRel) {
    const abs = isAbsolute(overrideRel) ? overrideRel : resolve(rootDir, overrideRel);
    if (!existsSync(abs)) stop(`--app-package not found: ${abs}`);
    return { kind: 'override', root: abs };
  }
  const globs = readWorkspaceGlobs(rootDir);
  const pkgRoot = readPkg(rootDir);
  const rootHasNext = pkgRoot && depVersion(pkgRoot, 'next');
  const rootHasApp = existsSync(join(rootDir, 'app')) || existsSync(join(rootDir, 'src', 'app'));

  if (!globs) {
    // Single-package source. If root has `next` AND app/, that's it.
    if (rootHasNext && rootHasApp) return { kind: 'single', root: rootDir };
    if (rootHasApp) return { kind: 'single', root: rootDir };
    return { kind: 'none', root: rootDir };
  }

  const candidates = expandGlobs(rootDir, globs);
  const matches = [];
  for (const c of candidates) {
    const pkg = readPkg(c);
    if (!pkg) continue;
    if (!depVersion(pkg, 'next')) continue;
    if (existsSync(join(c, 'app')) || existsSync(join(c, 'src', 'app'))) matches.push(c);
  }
  // Also consider the root itself if it has app/ + next dep
  if (rootHasNext && rootHasApp && !matches.includes(rootDir)) matches.unshift(rootDir);

  if (matches.length === 0) return { kind: 'none', root: rootDir, candidates };
  if (matches.length === 1) return { kind: 'workspace', root: matches[0], candidates };
  return { kind: 'multiple', root: null, matches, candidates };
}

const resolved = findAppPackage(sourceRoot, args.flags['app-package'] || null);
if (resolved.kind === 'multiple') {
  const list = resolved.matches.map(p => relative(sourceRoot, p) || '.').join(', ');
  stop(`multiple workspace packages contain a Next app: [${list}]; re-run with --app-package <relpath>`);
}
if (resolved.kind === 'none') {
  stop(`no Next.js app found under ${sourceRoot} (no app/ directory in root or any workspace package)`);
}
const appPackageRoot = resolved.root;
const appPackageRel = relative(sourceRoot, appPackageRoot) || '.';

// ── Target audit ────────────────────────────────────────────────────
const targetAudit = {
  exists: existsSync(targetRoot),
  hasPackageJson: false,
  hasRsbuildConfig: false,
  hasTsconfig: false,
  hasComponentsJson: false,
  hasSrcMain: false,
  hasIndexCss: false,
  hasGitDir: false,
  initializedDeps: {},
  conflicts: [],
};
if (targetAudit.exists) {
  targetAudit.hasPackageJson = existsSync(join(targetRoot, 'package.json'));
  targetAudit.hasRsbuildConfig =
    existsSync(join(targetRoot, 'rsbuild.config.ts')) ||
    existsSync(join(targetRoot, 'rsbuild.config.mjs')) ||
    existsSync(join(targetRoot, 'rsbuild.config.js'));
  targetAudit.hasTsconfig = existsSync(join(targetRoot, 'tsconfig.json'));
  targetAudit.hasComponentsJson = existsSync(join(targetRoot, 'components.json'));
  targetAudit.hasSrcMain =
    existsSync(join(targetRoot, 'src', 'main.tsx')) ||
    existsSync(join(targetRoot, 'src', 'main.ts'));
  targetAudit.hasIndexCss = existsSync(join(targetRoot, 'src', 'index.css'));
  targetAudit.hasGitDir = existsSync(join(targetRoot, '.git'));

  if (targetAudit.hasPackageJson) {
    const tpkg = readPkg(targetRoot);
    if (tpkg) {
      const deps = { ...(tpkg.dependencies || {}), ...(tpkg.devDependencies || {}) };
      targetAudit.initializedDeps = deps;
      if (deps['next']) targetAudit.conflicts.push('target has `next` in dependencies');
      // Detect conflicting bundlers (skill is opinionated about rsbuild)
      if (deps['vite']) targetAudit.conflicts.push('target has `vite` in dependencies');
      if (deps['webpack']) targetAudit.conflicts.push('target has `webpack` in dependencies');
    }
  }
}
if (targetAudit.conflicts.length) {
  stop(`target has conflicting state: ${targetAudit.conflicts.join('; ')}`);
}

// ── Source package.json (the app package, not necessarily root) ─────
const pkg = readPkg(appPackageRoot);
if (!pkg) stop(`no package.json at ${appPackageRoot}`);

const reactVer = depVersion(pkg, 'react');
const reactDomVer = depVersion(pkg, 'react-dom');
const nextVer = depVersion(pkg, 'next');
const tailwindVer = depVersion(pkg, 'tailwindcss');
const typesReactVer = depVersion(pkg, '@types/react');
const nextIntlVer = depVersion(pkg, 'next-intl');

const nextMajor = detectMajor(nextVer);

// ── Detect file presence (relative to appPackageRoot) ───────────────
const hasAppDir = existsSync(join(appPackageRoot, 'app')) || existsSync(join(appPackageRoot, 'src', 'app'));
const hasPagesDir = existsSync(join(appPackageRoot, 'pages')) || existsSync(join(appPackageRoot, 'src', 'pages'));
const hasShadcn = existsSync(join(appPackageRoot, 'components.json'));
const hasMiddleware =
  existsSync(join(appPackageRoot, 'middleware.ts')) ||
  existsSync(join(appPackageRoot, 'middleware.tsx')) ||
  existsSync(join(appPackageRoot, 'middleware.js')) ||
  existsSync(join(appPackageRoot, 'src', 'middleware.ts'));

// In-house pkg detection — multi-candidate, ranked by import count, STOP on ambiguity.
// (Manual override via --in-house-pkg <name> bypasses ranking.)
const knownScopes = new Set([
  '@types', '@tailwindcss', '@rsbuild', '@radix-ui', '@hookform', '@tanstack',
  '@floating-ui', '@vercel', '@next', '@swc', '@babel', '@eslint', '@typescript-eslint',
  '@testing-library', '@reduxjs', '@react-types', '@lexical', '@formatjs',
]);
let inHousePkg = args.flags['in-house-pkg'] || null;
let inHouseCandidates = []; // populated below for transparency in audit.json

// ── Grep code under appPackageRoot ──────────────────────────────────
const codeDirs = ['app', 'src', 'pages'].map(d => join(appPackageRoot, d)).filter(existsSync);
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

const apiDir = existsSync(join(appPackageRoot, 'app', 'api'))
  ? join(appPackageRoot, 'app', 'api')
  : existsSync(join(appPackageRoot, 'src', 'app', 'api'))
    ? join(appPackageRoot, 'src', 'app', 'api')
    : null;
if (apiDir) {
  apiRouteCount = walk(apiDir, { exts: ['.ts', '.tsx', '.js'] }).filter(p => /\/route\.[jt]sx?$/.test(p)).length;
}

const checkLocale = (d) => {
  if (!existsSync(d)) return;
  for (const e of readdirSync(d, { withFileTypes: true })) {
    if (e.isDirectory() && e.name === '[locale]') { hasLocaleSegment = true; return; }
  }
};
checkLocale(join(appPackageRoot, 'app'));
checkLocale(join(appPackageRoot, 'src', 'app'));

for (const f of codeFiles) {
  let content;
  try { content = readFileSync(f, 'utf8'); } catch { continue; }
  if (useServerRe.test(content)) useServerHits++;
  if (nextImageRe.test(content)) nextImageHits++;
  if (nextFontRe.test(content)) nextFontHits++;
  if (cookiesHeadersRe.test(content)) asyncCookiesHeadersHits++;
  if (serverIntlRe.test(content)) serverIntlHits++;
}

// ── In-house pkg usage check ────────────────────────────────────────
// Build a per-package import-count map by scanning every file once.
// We do this for both the manual-override case and the auto-detect case.
let inHouseImportCount = 0;
function countImports(name) {
  const re = new RegExp(`from\\s+['"]${name.replace(/[/.]/g, '\\$&')}(?:/|['"])`, 'g');
  let count = 0;
  for (const f of codeFiles) {
    let content;
    try { content = readFileSync(f, 'utf8'); } catch { continue; }
    const matches = content.match(re);
    if (matches) count += matches.length;
  }
  return count;
}

if (inHousePkg) {
  // Manual override: trust the user, just count imports.
  inHouseImportCount = countImports(inHousePkg);
  inHouseCandidates = [{ name: inHousePkg, importCount: inHouseImportCount, source: 'manual' }];
  if (inHouseImportCount === 0) {
    // User-specified pkg has no imports — surface as a warning, but keep their choice.
    say(`warning: --in-house-pkg ${inHousePkg} has 0 imports under ${appPackageRel}`);
  }
} else {
  // Auto-detect: collect every @scope/ dep not in the known-scope whitelist,
  // count its imports, and rank.
  const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const candidateNames = Object.keys(allDeps).filter(name => {
    const m = name.match(/^@([^/]+)\//);
    return m && !knownScopes.has(`@${m[1]}`);
  });
  const ranked = candidateNames
    .map(name => ({ name, importCount: countImports(name), source: 'auto' }))
    .filter(c => c.importCount > 0)
    .sort((a, b) => b.importCount - a.importCount);
  inHouseCandidates = ranked;

  if (ranked.length === 0) {
    inHousePkg = null;
  } else if (ranked.length === 1) {
    inHousePkg = ranked[0].name;
    inHouseImportCount = ranked[0].importCount;
  } else {
    // Multiple candidates with real import sites — STOP and let the user disambiguate.
    // This mirrors the workspace multi-match behavior so the agent isn't guessing.
    const list = ranked.map(c => `${c.name} (${c.importCount} imports)`).join(', ');
    stop(`multiple in-house UI candidates detected with imports: [${list}]; re-run audit.mjs with --in-house-pkg <name>`);
  }
}

const hasNextIntl = !!nextIntlVer;
const requiresUiSpec = !!inHousePkg;
const requiresI18nSpec = hasNextIntl;

// ── STOP gates ──────────────────────────────────────────────────────
if (hasPagesDir) stop('out of scope: pages/ router');
if (!hasAppDir) stop(`source has no app/ directory at ${appPackageRoot}; nothing to port`);

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
  appPackageRoot, appPackageRel,
  workspaceMode: resolved.kind, // 'single' | 'workspace' | 'override'
  react: reactVer, reactDom: reactDomVer,
  next: nextVer, nextMajor,
  tailwind: tailwindVer,
  typesReact: typesReactVer,
  hasShadcn,
  inHousePkg, inHouseImportCount, inHouseCandidates,
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
  targetAudit,
};
writeJson(join(twspDir(sourceRoot), 'audit.json'), audit);

writeJson(join(twspDir(sourceRoot), 'migration.json'), {
  sourceRoot, targetRoot,
  appPackageRoot, appPackageRel,
  createdAt: new Date().toISOString(),
});

writeJson(join(twspDir(sourceRoot), 'state.json'), {
  phase: '1', step: 'scaffold', queues: {}, pending: null, lastError: null,
});

say(`audit ok: src=${appPackageRel === '.' ? 'root' : appPackageRel} (${resolved.kind}) react=${reactVer} next=${nextVer}(maj=${nextMajor}) tw=${tailwindVer} intl=${hasNextIntl} inhouse=${inHousePkg || 'none'} api=${apiRouteCount} mw=${hasMiddleware}`);
say(`target: ${targetAudit.exists ? (targetAudit.hasPackageJson ? 'initialized' : 'empty-dir') : 'absent'} (rsbuild=${targetAudit.hasRsbuildConfig} ts=${targetAudit.hasTsconfig} shadcn=${targetAudit.hasComponentsJson} git=${targetAudit.hasGitDir})`);
say(`stop-risks: useServer=${useServerHits} nextImage=${nextImageHits} nextFont=${nextFontHits} serverApis=${asyncCookiesHeadersHits} serverIntl=${serverIntlHits}`);
