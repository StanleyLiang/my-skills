#!/usr/bin/env node
// Phase 3 — Bump lexical + @lexical/* dependencies in package.json to target version.
// Then `npm install` and run a baseline build to confirm install integrity
// BEFORE any code transforms run (so later failures attribute cleanly to transforms).

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  say, stop, parseArgs, selfTestGate, readMigration, readAudit, readPlan, readState, writeState,
  readPkg, writePkg, run, logSidecar, stateDir, findMigrationRoot,
} from './_lib.mjs';

const SCRIPT = 'upgrade-deps.mjs';
const args = parseArgs(process.argv.slice(2));
selfTestGate(args, SCRIPT);

const repoRoot = findMigrationRoot(process.cwd());
if (!repoRoot) stop('no migration.json found');
const m = readMigration(repoRoot);
const audit = readAudit(repoRoot);
const plan = readPlan(repoRoot);
if (!plan) stop('version-plan.json missing; run plan-version.mjs first');

const target = plan.target;
const pkg = readPkg(repoRoot);
if (!pkg) stop(`no package.json at ${repoRoot}`);

const bumped = [];
function bumpIn(section) {
  if (!pkg[section]) return;
  for (const k of Object.keys(pkg[section])) {
    if (k === 'lexical' || k.startsWith('@lexical/')) {
      const before = pkg[section][k];
      pkg[section][k] = `^${target}`;
      bumped.push({ name: k, from: before, to: pkg[section][k], section });
    }
  }
}
bumpIn('dependencies');
bumpIn('devDependencies');

if (!bumped.length) stop('no lexical or @lexical/* entries found to bump');

writePkg(repoRoot, pkg);

// Install
const ins = run('npm', ['install'], { cwd: repoRoot });
if (ins.code !== 0) {
  const log = logSidecar(repoRoot, SCRIPT, ins.stderr || ins.stdout);
  stop(`npm install failed`, log);
}

// Baseline verify — tsc only (build comes after transforms in phase 7)
const tsc = run('npx', ['tsc', '--noEmit'], { cwd: repoRoot });
if (tsc.code !== 0) {
  // Don't STOP — type errors are expected at this stage; record them.
  const log = logSidecar(repoRoot, SCRIPT, tsc.stderr || tsc.stdout);
  say(`tsc has errors after dep bump (expected); log: ${log}`);
}

const state = readState(repoRoot);
state.step = 'upgrade-done';
writeState(repoRoot, state);

say(`upgraded ${bumped.length} packages to ^${target}`);
for (const b of bumped.slice(0, 4)) say(`  ${b.name}: ${b.from} → ${b.to}`);
