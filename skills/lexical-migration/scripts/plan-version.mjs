#!/usr/bin/env node
// Phase 2 — Plan the version migration path.
// Two modes:
//   --emit-prompt : ask user for target Lexical version (or "latest")
//   default       : parse answer, build version-plan.json (current → hops → target)

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  say, stop, parseArgs, selfTestGate, readMigration, readAudit, readState, writeState,
  writeFile, writeJson, stateDir, findMigrationRoot, parseSemver,
} from './_lib.mjs';

const SCRIPT = 'plan-version.mjs';
const args = parseArgs(process.argv.slice(2));
selfTestGate(args, SCRIPT);

const repoRoot = findMigrationRoot(process.cwd());
if (!repoRoot) stop('no migration.json found');
const m = readMigration(repoRoot);
const audit = readAudit(repoRoot);
if (!audit) stop('audit not found');
const T = stateDir(repoRoot);

// Known Lexical 0.x minor checkpoints with notable breaking changes
// (subset; full list lives in references/lexical-version-deltas.md).
const KNOWN_HOPS = ['0.12.0', '0.14.0', '0.16.0', '0.17.0', '0.18.0', '0.19.0', '0.20.0', '0.21.0', '0.22.0', '0.23.0'];

if (args.flags['emit-prompt']) {
  const cur = audit.lexicalCurrent;
  const lines = [];
  lines.push(`# Phase 2 — Pick target Lexical version\n`);
  lines.push(`Current: \`${cur}\`. React: \`${audit.react || '?'}\`.\n`);
  lines.push(`Reply with one of:`);
  lines.push(`- a concrete version: \`TARGET: 0.21.0\``);
  lines.push(`- a tag: \`TARGET: latest\` (the script will resolve via \`npm view lexical version\`)`);
  lines.push(`- \`abort\` to stop the migration\n`);
  lines.push(`## Notable hops between minors (you may bisect through these)\n`);
  for (const h of KNOWN_HOPS) lines.push(`- \`${h}\``);
  lines.push('');
  lines.push(`## Why this matters\n`);
  lines.push(`Lexical 0.x is unstable-by-policy: minors carry breaking changes. The scripts apply per-minor codemods, so the chosen target determines which delta packs run in Phase 4 / 5.`);
  writeFile(join(T, 'prompts', 'version-target.md'), lines.join('\n') + '\n');
  const state = readState(repoRoot);
  state.step = 'ask-target';
  writeState(repoRoot, state);
  say(`version-target prompt emitted`);
  process.exit(0);
}

const answerPath = join(T, 'answers', 'version-target-answer.md');
if (!existsSync(answerPath)) stop(`missing user answer at ${answerPath}`);
const answer = readFileSync(answerPath, 'utf8').trim();
if (/^abort\b/i.test(answer)) stop('user aborted at version selection');

const tm = answer.match(/TARGET\s*:\s*(\S+)/i);
if (!tm) stop(`could not parse TARGET line from answer: ${answer.slice(0, 80)}`);
let target = tm[1];

if (target === 'latest') {
  const r = (await import('node:child_process')).spawnSync('npm', ['view', 'lexical', 'version'], { encoding: 'utf8' });
  if (r.status !== 0) stop(`npm view lexical version failed: ${(r.stderr || r.stdout).trim().slice(0, 120)}`);
  target = r.stdout.trim();
}

const cur = parseSemver(audit.lexicalCurrent);
const tgt = parseSemver(target);
if (!cur || !tgt) stop(`could not parse versions cur=${audit.lexicalCurrent} target=${target}`);

if (tgt.major === cur.major && tgt.minor === cur.minor && tgt.patch === cur.patch)
  stop(`target ${target} equals current ${audit.lexicalCurrent} — nothing to migrate`);

// Build hops: all KNOWN_HOPS strictly between current and target (inclusive of target)
function cmp(a, b) {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}
const hops = [];
for (const h of KNOWN_HOPS) {
  const hs = parseSemver(h);
  if (cmp(hs, cur) > 0 && cmp(hs, tgt) <= 0) hops.push(h);
}
if (!hops.length || hops[hops.length - 1] !== target) hops.push(target);

writeJson(join(T, 'version-plan.json'), {
  approvedAt: new Date().toISOString(),
  current: audit.lexicalCurrent,
  target,
  hops,
});

const state = readState(repoRoot);
state.step = 'plan-done';
writeState(repoRoot, state);

say(`plan: ${audit.lexicalCurrent} → ${target} (${hops.length} hop${hops.length === 1 ? '' : 's'})`);
