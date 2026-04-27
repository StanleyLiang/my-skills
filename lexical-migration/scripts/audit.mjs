#!/usr/bin/env node
// Phase 0 — Stocktake the in-house Lexical editor.
// Walks <editorRoot> and (a fallback subset of) <repoRoot> to inventory
// custom nodes, plugins, commands, themes, serialization methods, and React 19 risks.
// Writes:
//   <repoRoot>/.lexm/migration.json
//   <repoRoot>/.lexm/audit.json
//   <repoRoot>/.lexm/state.json (initial)

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, relative, basename, isAbsolute } from 'node:path';
import {
  say, stop, parseArgs, selfTestGate, walk, writeJson, writeState,
  readPkg, depVersion, parseSemver, ensureStateDir, stateDir,
} from './_lib.mjs';

const SCRIPT = 'audit.mjs';
const args = parseArgs(process.argv.slice(2));
selfTestGate(args, SCRIPT);

const repoArg = args.flags.repo;
const editorArg = args.flags.editor;
if (!repoArg) stop('--repo <repoRoot> required');
if (!editorArg) stop('--editor <editorRoot> required');

const repoRoot = resolve(repoArg);
const editorRoot = isAbsolute(editorArg) ? resolve(editorArg) : resolve(repoRoot, editorArg);

if (!existsSync(repoRoot)) stop(`repoRoot not found: ${repoRoot}`);
if (!existsSync(editorRoot)) stop(`editorRoot not found: ${editorRoot}`);
if (!editorRoot.startsWith(repoRoot)) stop(`editorRoot must be inside repoRoot`);

ensureStateDir(repoRoot);

// ── Detect Lexical & React versions from package.json (root or any workspace) ──
const pkg = readPkg(repoRoot);
if (!pkg) stop(`no package.json at ${repoRoot}`);

const lexicalVer = depVersion(pkg, 'lexical');
const reactVer = depVersion(pkg, 'react');
if (!lexicalVer) stop('lexical not found in package.json (root)');

const lexicalVersions = {};
for (const k of Object.keys(pkg.dependencies || {})) {
  if (k === 'lexical' || k.startsWith('@lexical/')) lexicalVersions[k] = pkg.dependencies[k];
}
for (const k of Object.keys(pkg.devDependencies || {})) {
  if (k === 'lexical' || k.startsWith('@lexical/')) lexicalVersions[k] = pkg.devDependencies[k];
}

// ── Walk editor source ───────────────────────────────────────────────
const codeFiles = walk(editorRoot, { exts: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'] });

const customNodes = [];
const plugins = [];
const commandsCreated = [];
const commandsRegistered = [];
const themeFiles = [];
const composers = [];
const serializationFiles = [];
const react19Hits = { forwardRef: 0, propTypes: 0, useRefBare: 0, jsxNamespace: 0 };

const NODE_BASES = ['ElementNode', 'TextNode', 'DecoratorNode', 'LineBreakNode', 'RootNode', 'ParagraphNode', 'LineBreakNode'];
const NODE_LIFECYCLE = ['getType', 'clone', 'createDOM', 'updateDOM', 'exportJSON', 'importJSON', 'exportDOM', 'importDOM', 'isInline', 'isParentRequired', 'getDecorator', 'decorate'];

for (const f of codeFiles) {
  let content;
  try { content = readFileSync(f, 'utf8'); } catch { continue; }

  const rel = relative(repoRoot, f);

  // Custom nodes: `extends ElementNode|TextNode|DecoratorNode|...`
  const extendsRe = new RegExp(`(?:export\\s+(?:default\\s+)?)?class\\s+([A-Za-z_$][\\w$]*)\\s+extends\\s+(${NODE_BASES.join('|')})`, 'g');
  let m;
  while ((m = extendsRe.exec(content)) !== null) {
    const methods = NODE_LIFECYCLE.filter(name =>
      new RegExp(`(?:^|\\s)(?:static\\s+)?${name}\\s*\\(`, 'm').test(content)
    );
    customNodes.push({
      name: m[1],
      extends: m[2],
      file: rel,
      methods,
      hasNonTrivialClone: /\bclone\s*\([\s\S]*?\)\s*\{[\s\S]*?(?:JSON\.stringify|setFormat|setStyle|markDirty|new\s+\w+Node\([^)]+,\s*[^)]+,)/m.test(content),
    });
  }

  // Plugins: `useLexicalComposerContext()` is the key signal
  if (/useLexicalComposerContext\s*\(/.test(content)) {
    const exportRe = /export\s+(?:default\s+)?(?:function|const)\s+([A-Za-z_$][\w$]*)/g;
    const exports = [];
    let em;
    while ((em = exportRe.exec(content)) !== null) exports.push(em[1]);
    plugins.push({ name: exports[0] || basename(f), file: rel, exports });
  }

  // createCommand
  const ccRe = /\b(?:export\s+)?(?:const|let|var)\s+([A-Z][\w$]*)\s*(?::[^=]+)?=\s*createCommand\s*[<(]/g;
  let cm;
  while ((cm = ccRe.exec(content)) !== null) {
    commandsCreated.push({ name: cm[1], file: rel });
  }

  // registerCommand
  const rcRe = /registerCommand\s*\(\s*([A-Z][\w$.]*)/g;
  let rm;
  while ((rm = rcRe.exec(content)) !== null) {
    commandsRegistered.push({ command: rm[1], file: rel });
  }

  // Theme: object literal passed to LexicalComposer config or exported as `theme`
  if (/\btheme\s*[:=]\s*\{[\s\S]*?\b(paragraph|heading|text|list|link|code|quote)\b/.test(content)) {
    themeFiles.push(rel);
  }

  // Composer: <LexicalComposer initialConfig={...}>
  if (/<LexicalComposer\b/.test(content) || /LexicalComposer\s*\(\s*\{/.test(content)) {
    const nsM = content.match(/namespace\s*:\s*['"]([^'"]+)['"]/);
    const errBoundary = /<ErrorBoundary\b|errorBoundary\s*:/.test(content);
    composers.push({ file: rel, namespace: nsM ? nsM[1] : null, hasErrorBoundary: errBoundary });
  }

  // Serialization
  if (/\b(?:exportJSON|importJSON|exportDOM|importDOM)\s*\(/.test(content)) {
    serializationFiles.push(rel);
  }

  // React 19 risk signals (only inside editor code)
  react19Hits.forwardRef += (content.match(/\bforwardRef\s*[<(]/g) || []).length;
  react19Hits.propTypes += (content.match(/\.propTypes\s*=/g) || []).length;
  // useRef without initial arg: `useRef()` or `useRef<T>()`
  react19Hits.useRefBare += (content.match(/\buseRef\s*<[^>]*>\s*\(\s*\)|\buseRef\s*\(\s*\)/g) || []).length;
  react19Hits.jsxNamespace += (content.match(/\bJSX\.(?:Element|IntrinsicElements|LibraryManagedAttributes)\b/g) || []).length;
}

// ── Detect skippability ─────────────────────────────────────────────
const reactSemver = parseSemver(reactVer);
const editorHasReact19Risks =
  react19Hits.forwardRef + react19Hits.propTypes + react19Hits.useRefBare + react19Hits.jsxNamespace > 0;

const skips = {
  react19: !editorHasReact19Risks, // skip Phase 6 if editor code has no React-19-risky surface
};

// ── STOP guards ─────────────────────────────────────────────────────
if (codeFiles.length === 0) stop('editorRoot has no code files');

const lexicalImportHits = codeFiles.some(f => {
  try { return /from\s+['"](?:lexical|@lexical\/[^'"]+)['"]/.test(readFileSync(f, 'utf8')); } catch { return false; }
});
if (!lexicalImportHits) stop('no lexical or @lexical/* imports detected under editorRoot');

const semver = parseSemver(lexicalVer);
if (!semver) stop(`could not parse lexical version: ${lexicalVer}`);

// ── Persist artifacts ───────────────────────────────────────────────
const T = stateDir(repoRoot);

writeJson(join(T, 'migration.json'), {
  repoRoot,
  editorRoot,
  editorRootRel: relative(repoRoot, editorRoot),
  startedAt: new Date().toISOString(),
});

writeJson(join(T, 'audit.json'), {
  generatedAt: new Date().toISOString(),
  lexicalVersions,
  lexicalCurrent: lexicalVer,
  lexicalCurrentSemver: semver,
  react: reactVer,
  reactSemver,
  customNodes,
  plugins,
  commandsCreated,
  commandsRegistered,
  themeFiles,
  composers,
  serializationFiles,
  react19Hits,
  filesScanned: codeFiles.length,
  skips,
});

writeState(repoRoot, {
  phase: '0',
  step: 'audit-done',
  queues: {},
  pending: null,
  lastError: null,
});

say(`audit ok: lexical=${lexicalVer} react=${reactVer || '?'} files=${codeFiles.length}`);
say(`  nodes=${customNodes.length} plugins=${plugins.length} commands=${commandsCreated.length} composers=${composers.length}`);
say(`  react19Risks=${editorHasReact19Risks ? 'yes' : 'no'} (skip6=${skips.react19})`);
