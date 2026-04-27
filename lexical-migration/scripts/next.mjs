#!/usr/bin/env node
// State-machine dispatcher. Reads .lexm/state.json, prints exactly one directive.
//
// Usage:
//   node next.mjs              — print directive for current state
//   node next.mjs --advance    — mark current step done, transition, print next directive
//   node next.mjs --reset      — reset state to phase 0 (rare; user-driven)
//   node next.mjs --self-test  — sanity check; exit 0
//
// Directive grammar (one line each):
//   RUN <command...>
//   ASK <prompt-file> <answer-file>
//   COMMIT <message>
//   DONE

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  say, parseArgs, selfTestGate, readState, writeState, readMigration, readAudit,
  stateDir, findMigrationRoot,
} from './_lib.mjs';

const SCRIPT = 'next.mjs';

function ScriptPath(name) {
  return join(import.meta.url.replace(/^file:\/\//, '').replace(/\/scripts\/.*$/, '/scripts'), name);
}

function nextDirective(state, audit, migration) {
  const sk = audit?.skips || {};
  const sc = (n) => ScriptPath(n);
  const pp = (rel) => join(stateDir(migration.repoRoot), 'prompts', rel);
  const ap = (rel) => join(stateDir(migration.repoRoot), 'answers', rel);

  switch (state.phase) {
    case '0':
      // audit just ran; commit the audit artifact and advance
      if (state.step === 'audit-done')
        return `COMMIT chore(lexm): audit editor (lexical=${audit?.lexicalVersions?.lexical || '?'})`;
      return `RUN node ${sc('audit.mjs')}`;
    case '1':
      if (state.step === 'enter') return `RUN node ${sc('build-spec.mjs')} --emit-prompt`;
      if (state.step === 'ask-spec') return `ASK ${pp('editor-spec.md')} ${ap('editor-spec-answer.md')}`;
      if (state.step === 'parse-spec') return `RUN node ${sc('build-spec.mjs')}`;
      if (state.step === 'ask-approval') return `ASK ${pp('spec-approval.md')} ${ap('spec-approval-answer.md')}`;
      if (state.step === 'spec-done') return `COMMIT chore(lexm): record approved editor spec`;
      return `RUN node ${sc('build-spec.mjs')} --emit-prompt`;
    case '2':
      if (state.step === 'enter') return `RUN node ${sc('plan-version.mjs')} --emit-prompt`;
      if (state.step === 'ask-target') return `ASK ${pp('version-target.md')} ${ap('version-target-answer.md')}`;
      if (state.step === 'parse-target') return `RUN node ${sc('plan-version.mjs')}`;
      if (state.step === 'plan-done') return `COMMIT chore(lexm): record version migration plan`;
      return `RUN node ${sc('plan-version.mjs')} --emit-prompt`;
    case '3':
      if (state.step === 'upgrade-done')
        return `COMMIT chore(lexm): bump lexical and @lexical/* to target`;
      return `RUN node ${sc('upgrade-deps.mjs')}`;
    case '4':
      if (state.step === 'nodes-done')
        return `COMMIT feat(lexm): port custom Lexical nodes batch ${state.queues?.nodes?.doneCount || 0}`;
      return `RUN node ${sc('port-nodes.mjs')} --batch`;
    case '5':
      if (state.step === 'plugins-done')
        return `COMMIT feat(lexm): port Lexical plugins and command sites batch ${state.queues?.plugins?.doneCount || 0}`;
      return `RUN node ${sc('port-plugins.mjs')} --batch`;
    case '6':
      if (sk.react19) return null;
      if (state.step === 'react19-done')
        return `COMMIT feat(lexm): align editor code with React 19 (forwardRef, useRef, JSX) batch ${state.queues?.react19?.doneCount || 0}`;
      return `RUN node ${sc('port-react-19.mjs')} --batch`;
    case '7':
      if (state.step === 'verified')
        return `COMMIT chore(lexm): finalize lexical migration`;
      return `RUN bash ${sc('verify.sh')} tsc+build`;
    case 'done':
      return 'DONE';
    default:
      return null;
  }
}

function transition(state, audit) {
  const sk = audit?.skips || {};
  switch (state.phase) {
    case '0':
      if (state.step === 'audit') { state.step = 'audit-done'; break; }
      state.phase = '1'; state.step = 'enter';
      break;
    case '1':
      if (state.step === 'enter') { state.step = 'ask-spec'; break; }
      if (state.step === 'ask-spec') { state.step = 'parse-spec'; break; }
      if (state.step === 'parse-spec') { state.step = 'ask-approval'; break; }
      if (state.step === 'ask-approval') { state.step = 'spec-done'; break; }
      if (state.step === 'spec-done') { state.phase = '2'; state.step = 'enter'; break; }
      break;
    case '2':
      if (state.step === 'enter') { state.step = 'ask-target'; break; }
      if (state.step === 'ask-target') { state.step = 'parse-target'; break; }
      if (state.step === 'parse-target') { state.step = 'plan-done'; break; }
      if (state.step === 'plan-done') { state.phase = '3'; state.step = 'upgrade'; break; }
      break;
    case '3':
      if (state.step === 'upgrade') { state.step = 'upgrade-done'; break; }
      if (state.step === 'upgrade-done') { state.phase = '4'; state.step = 'nodes'; break; }
      break;
    case '4': {
      const q = state.queues?.nodes;
      if (state.step === 'nodes') {
        if (q && q.cursor >= q.items.length) { state.step = 'nodes-done-final'; break; }
        state.step = 'nodes-batch-committed';
        break;
      }
      if (state.step === 'nodes-batch-committed') {
        if (q && q.cursor >= q.items.length) { state.phase = '5'; state.step = 'plugins'; break; }
        state.step = 'nodes';
        break;
      }
      if (state.step === 'nodes-done') { state.step = 'nodes'; break; }
      if (state.step === 'nodes-done-final') { state.phase = '5'; state.step = 'plugins'; break; }
      break;
    }
    case '5': {
      const q = state.queues?.plugins;
      if (state.step === 'plugins') {
        if (q && q.cursor >= q.items.length) { state.step = 'plugins-done-final'; break; }
        state.step = 'plugins-batch-committed';
        break;
      }
      if (state.step === 'plugins-batch-committed') {
        if (q && q.cursor >= q.items.length) { state.phase = '6'; state.step = 'react19'; break; }
        state.step = 'plugins';
        break;
      }
      if (state.step === 'plugins-done-final') { state.phase = '6'; state.step = 'react19'; break; }
      break;
    }
    case '6': {
      if (sk.react19) { state.phase = '7'; state.step = 'verify'; break; }
      const q = state.queues?.react19;
      if (state.step === 'react19') {
        if (q && q.cursor >= q.items.length) { state.step = 'react19-done-final'; break; }
        state.step = 'react19-batch-committed';
        break;
      }
      if (state.step === 'react19-batch-committed') {
        if (q && q.cursor >= q.items.length) { state.phase = '7'; state.step = 'verify'; break; }
        state.step = 'react19';
        break;
      }
      if (state.step === 'react19-done-final') { state.phase = '7'; state.step = 'verify'; break; }
      break;
    }
    case '7':
      if (state.step === 'verify') { state.step = 'verified'; break; }
      if (state.step === 'verified') { state.phase = 'done'; state.step = 'final'; break; }
      break;
  }
  return state;
}

const args = parseArgs(process.argv.slice(2));
selfTestGate(args, SCRIPT);

const here = process.cwd();
const repoRoot = findMigrationRoot(here);
if (!repoRoot) {
  say('RUN audit-bootstrap');
  say('# No .lexm/migration.json found. Ask the user for repoRoot and editorRoot, then run:');
  say('#   node <SKILL>/scripts/audit.mjs --repo <repoRoot> --editor <editorRoot>');
  process.exit(0);
}

const migration = readMigration(repoRoot);
const audit = readAudit(repoRoot);
let state = readState(repoRoot);

if (!state) {
  state = { phase: '0', step: 'audit-done', queues: {}, pending: null, lastError: null };
  writeState(repoRoot, state);
}

if (args.flags.reset) {
  state = { phase: '0', step: 'audit', queues: {}, pending: null, lastError: null };
  writeState(repoRoot, state);
  say('state reset to phase 0');
  process.exit(0);
}

if (args.flags.advance) {
  state = transition(state, audit || {});
  writeState(repoRoot, state);
}

const directive = nextDirective(state, audit || {}, migration || {});
if (directive == null) {
  state = transition(state, audit || {});
  writeState(repoRoot, state);
  const d2 = nextDirective(state, audit || {}, migration || {});
  if (d2) say(d2);
  else say('DONE');
} else {
  say(directive);
}
