#!/usr/bin/env node
// State-machine dispatcher. Reads .twsp/state.json, prints exactly one directive.
//
// Usage:
//   node next.mjs                 — print directive for current state
//   node next.mjs --advance       — mark current step done, transition to next, print next directive
//   node next.mjs --reset         — reset state to phase 0 (rare; user-driven)
//   node next.mjs --self-test     — sanity check; exit 0
//
// Directive grammar (one line each):
//   RUN <command...>
//   ASK <prompt-file> <answer-file>
//   COMMIT <message>
//   DONE
//
// State file lives at <sourceRoot>/.twsp/state.json. sourceRoot is read from
// migration.json which is the only "anchor" we have. Migration.json itself is
// written by audit.mjs and can be read either via cwd or by walking up.

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { say, stop, parseArgs, selfTestGate, readState, writeState, readMigration, readAudit, twspDir } from './_lib.mjs';

const SCRIPT = 'next.mjs';

function findMigrationRoot(start) {
  let d = resolve(start);
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(d, '.twsp', 'migration.json'))) return d;
    const parent = resolve(d, '..');
    if (parent === d) break;
    d = parent;
  }
  return null;
}

function ScriptPath(name) {
  // Used to print absolute paths to the agent so the agent can run them.
  return join(import.meta.url.replace(/^file:\/\//, '').replace(/\/scripts\/.*$/, '/scripts'), name);
}

function nextDirective(state, audit, migration) {
  const t = migration.targetRoot;
  const sk = audit.skips || {};
  const sc = (n) => ScriptPath(n);

  switch (state.phase) {
    case '0':
      if (!audit) return null; // shouldn't happen
      return `RUN node ${sc('scaffold-target.mjs')}`;
    case '1':
      // After scaffold completes, commit then advance to 2a
      if (state.step === 'scaffold-done')
        return `COMMIT chore(twsp): scaffold rsbuild + React 19 + Tailwind 4 + shadcn baseline`;
      return `RUN node ${sc('scaffold-target.mjs')}`;
    case '2a':
      if (state.step === 'styles-done')
        return `COMMIT feat(twsp): port styles to Tailwind v4 CSS-first config`;
      return `RUN node ${sc('port-styles.mjs')}`;
    case '2b':
      if (state.step === 'tsconfig-done')
        return `COMMIT feat(twsp): port tsconfig (strip Next plugin, preserve paths and strict flags)`;
      return `RUN node ${sc('port-tsconfig.mjs')}`;
    case '2c':
      if (state.step === 'eslint-done')
        return `COMMIT feat(twsp): port eslint (flat config, drop next/*, preserve custom rules)`;
      return `RUN node ${sc('port-eslint.mjs')}`;
    case '3a':
      if (sk.uiMapping) return null; // skip handled by --advance
      if (state.step === 'ask-ui-spec')
        return `ASK ${join(twspDir(migration.sourceRoot), 'prompts', 'ui-spec.md')} ${join(twspDir(migration.sourceRoot), 'answers', 'ui-spec-answer.md')}`;
      if (state.step === 'parse-ui-spec')
        return `RUN node ${sc('build-shadcn-mapping.mjs')}`;
      if (state.step === 'ask-ui-approval')
        return `ASK ${join(twspDir(migration.sourceRoot), 'prompts', 'ui-approval.md')} ${join(twspDir(migration.sourceRoot), 'answers', 'ui-approval-answer.md')}`;
      // Initial entry: emit prompt, advance to ask state
      return `RUN node ${sc('build-shadcn-mapping.mjs')} --emit-prompt`;
    case '3b':
      if (sk.i18nMapping) return null;
      if (state.step === 'ask-i18n-spec')
        return `ASK ${join(twspDir(migration.sourceRoot), 'prompts', 'i18n-spec.md')} ${join(twspDir(migration.sourceRoot), 'answers', 'i18n-spec-answer.md')}`;
      if (state.step === 'parse-i18n-spec')
        return `RUN node ${sc('build-i18n-mapping.mjs')}`;
      if (state.step === 'ask-i18n-approval')
        return `ASK ${join(twspDir(migration.sourceRoot), 'prompts', 'i18n-approval.md')} ${join(twspDir(migration.sourceRoot), 'answers', 'i18n-approval-answer.md')}`;
      if (state.step === 'mappings-done')
        return `COMMIT chore(twsp): record approved UI and i18n mappings`;
      return `RUN node ${sc('build-i18n-mapping.mjs')} --emit-prompt`;
    case '4a': {
      if (state.step === 'components-done')
        return `COMMIT feat(twsp): port components batch ${(state.queues?.components?.doneCount || 0)}`;
      return `RUN node ${sc('port-components.mjs')} --batch`;
    }
    case '4b': {
      if (state.step === 'routes-done')
        return `COMMIT feat(twsp): port routes batch ${(state.queues?.routes?.doneCount || 0)}`;
      return `RUN node ${sc('port-routes.mjs')} --batch`;
    }
    case '4c': {
      if (state.step === 'rest-done')
        return `COMMIT feat(twsp): port lib/hooks/store/types and locale messages`;
      return `RUN node ${sc('port-rest.mjs')} --batch`;
    }
    case '5':
      if (state.step === 'wired-done')
        return `COMMIT feat(twsp): wire entrypoint and finalize SPA build`;
      return `RUN node ${sc('wire-entrypoint.mjs')}`;
    case 'done':
      return 'DONE';
    default:
      return null;
  }
}

function transition(state, audit) {
  const sk = audit.skips || {};
  // When step ends with '-done' we've just committed; now move to next phase.
  switch (state.phase) {
    case '0':
      state.phase = '1';
      state.step = 'scaffold';
      break;
    case '1':
      if (state.step === 'scaffold') { state.step = 'scaffold-done'; break; }
      state.phase = '2a'; state.step = 'styles';
      break;
    case '2a':
      if (state.step === 'styles') { state.step = 'styles-done'; break; }
      state.phase = '2b'; state.step = 'tsconfig';
      break;
    case '2b':
      if (state.step === 'tsconfig') { state.step = 'tsconfig-done'; break; }
      state.phase = '2c'; state.step = 'eslint';
      break;
    case '2c':
      if (state.step === 'eslint') { state.step = 'eslint-done'; break; }
      state.phase = '3a'; state.step = 'enter-3a';
      break;
    case '3a':
      if (sk.uiMapping) { state.phase = '3b'; state.step = 'enter-3b'; break; }
      if (state.step === 'enter-3a') { state.step = 'ask-ui-spec'; break; }
      if (state.step === 'ask-ui-spec') { state.step = 'parse-ui-spec'; break; }
      if (state.step === 'parse-ui-spec') { state.step = 'ask-ui-approval'; break; }
      if (state.step === 'ask-ui-approval') { state.phase = '3b'; state.step = 'enter-3b'; break; }
      break;
    case '3b':
      if (sk.i18nMapping) { state.step = 'mappings-done'; break; }
      if (state.step === 'enter-3b') { state.step = 'ask-i18n-spec'; break; }
      if (state.step === 'ask-i18n-spec') { state.step = 'parse-i18n-spec'; break; }
      if (state.step === 'parse-i18n-spec') { state.step = 'ask-i18n-approval'; break; }
      if (state.step === 'ask-i18n-approval') { state.step = 'mappings-done'; break; }
      if (state.step === 'mappings-done') { state.phase = '4a'; state.step = 'components'; break; }
      break;
    case '4a': {
      // Cycle batch → batch-done → commit → next batch, until queue empty.
      const q = state.queues?.components;
      if (state.step === 'components') {
        if (q && q.cursor >= q.items.length) { state.step = 'components-done-final'; break; }
        state.step = 'components-batch-committed';
        break;
      }
      if (state.step === 'components-batch-committed') {
        if (q && q.cursor >= q.items.length) { state.phase = '4b'; state.step = 'routes'; break; }
        state.step = 'components';
        break;
      }
      if (state.step === 'components-done') { state.step = 'components'; break; }
      if (state.step === 'components-done-final') { state.phase = '4b'; state.step = 'routes'; break; }
      break;
    }
    case '4b': {
      const q = state.queues?.routes;
      if (state.step === 'routes') {
        if (q && q.cursor >= q.items.length) { state.step = 'routes-done-final'; break; }
        state.step = 'routes-batch-committed';
        break;
      }
      if (state.step === 'routes-batch-committed') {
        if (q && q.cursor >= q.items.length) { state.phase = '4c'; state.step = 'rest'; break; }
        state.step = 'routes';
        break;
      }
      if (state.step === 'routes-done-final') { state.phase = '4c'; state.step = 'rest'; break; }
      break;
    }
    case '4c': {
      if (state.step === 'rest') { state.step = 'rest-done'; break; }
      if (state.step === 'rest-done') { state.phase = '5'; state.step = 'wire'; break; }
      break;
    }
    case '5':
      if (state.step === 'wire') { state.step = 'wired-done'; break; }
      if (state.step === 'wired-done') { state.phase = 'done'; state.step = 'final'; break; }
      break;
  }
  return state;
}

const args = parseArgs(process.argv.slice(2));
selfTestGate(args, SCRIPT);

// Find the source root (the dir whose .twsp/migration.json exists).
const here = process.cwd();
const sourceRoot = findMigrationRoot(here);
if (!sourceRoot) {
  // Bootstrap: no audit yet. Tell the agent to ask for sourceRoot/targetRoot and run audit.
  say('RUN audit-bootstrap');
  say('# No .twsp/migration.json found. Ask the user for sourceRoot and targetRoot, then run:');
  say('#   node <SKILL>/scripts/audit.mjs --source <sourceRoot> --target <targetRoot>');
  process.exit(0);
}

const migration = readMigration(sourceRoot);
const audit = readAudit(sourceRoot);
let state = readState(sourceRoot);

if (!state) {
  // First-time after audit: initialize.
  state = { phase: '1', step: 'scaffold', queues: {}, pending: null, lastError: null };
  writeState(sourceRoot, state);
}

if (args.flags.reset) {
  state = { phase: '1', step: 'scaffold', queues: {}, pending: null, lastError: null };
  writeState(sourceRoot, state);
  say('state reset to phase 1');
  process.exit(0);
}

if (args.flags.advance) {
  state = transition(state, audit);
  writeState(sourceRoot, state);
}

const directive = nextDirective(state, audit, migration);
if (directive == null) {
  // Skip occurred — auto-advance and try again, once.
  state = transition(state, audit);
  writeState(sourceRoot, state);
  const d2 = nextDirective(state, audit, migration);
  if (d2) say(d2);
  else say('DONE');
} else {
  say(directive);
}
