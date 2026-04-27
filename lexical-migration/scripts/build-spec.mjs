#!/usr/bin/env node
// Phase 1 — Build editor spec markdown from audit; ASK user to approve/amend.
// Two modes:
//   --emit-prompt : write prompts/editor-spec.md (the draft + review checklist)
//   default       : read answers/editor-spec-answer.md, materialize editor-spec.json + approval prompt

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  say, stop, parseArgs, selfTestGate, readMigration, readAudit, readState, writeState,
  writeFile, writeJson, stateDir, findMigrationRoot,
} from './_lib.mjs';

const SCRIPT = 'build-spec.mjs';
const args = parseArgs(process.argv.slice(2));
selfTestGate(args, SCRIPT);

const repoRoot = findMigrationRoot(process.cwd());
if (!repoRoot) stop('no migration.json found');
const m = readMigration(repoRoot);
const audit = readAudit(repoRoot);
if (!audit) stop('audit not found; run audit.mjs first');
const T = stateDir(repoRoot);

if (args.flags['emit-prompt']) {
  const lines = [];
  lines.push(`# Phase 1 — Editor spec for review\n`);
  lines.push(`Stocktake of \`${m.editorRootRel}\` produced this draft. Confirm or amend before transforms run.\n`);
  lines.push(`## Versions\n`);
  for (const [k, v] of Object.entries(audit.lexicalVersions)) lines.push(`- \`${k}\` → \`${v}\``);
  lines.push(`- react → \`${audit.react || '?'}\`\n`);

  lines.push(`## Custom nodes (${audit.customNodes.length})\n`);
  if (audit.customNodes.length === 0) lines.push(`_(none detected)_\n`);
  else {
    lines.push(`| name | extends | file | methods | clone() |`);
    lines.push(`|---|---|---|---|---|`);
    for (const n of audit.customNodes) {
      lines.push(`| \`${n.name}\` | \`${n.extends}\` | \`${n.file}\` | ${n.methods.join(', ')} | ${n.hasNonTrivialClone ? '⚠ non-trivial' : 'trivial'} |`);
    }
    lines.push('');
  }

  lines.push(`## Plugins (${audit.plugins.length})\n`);
  if (audit.plugins.length === 0) lines.push(`_(none detected)_\n`);
  else {
    for (const p of audit.plugins) lines.push(`- \`${p.name}\` — \`${p.file}\``);
    lines.push('');
  }

  lines.push(`## Commands\n`);
  lines.push(`- created: ${audit.commandsCreated.length} (${audit.commandsCreated.slice(0, 5).map(c => `\`${c.name}\``).join(', ')}${audit.commandsCreated.length > 5 ? ', …' : ''})`);
  lines.push(`- registered call sites: ${audit.commandsRegistered.length}\n`);

  lines.push(`## Themes (${audit.themeFiles.length} file(s))\n`);
  for (const t of audit.themeFiles) lines.push(`- \`${t}\``);
  lines.push('');

  lines.push(`## Composers (${audit.composers.length})\n`);
  for (const c of audit.composers) lines.push(`- \`${c.file}\` — namespace: \`${c.namespace || '∅'}\`, errorBoundary: ${c.hasErrorBoundary ? 'yes' : 'no'}`);
  lines.push('');

  lines.push(`## Serialization\n`);
  lines.push(`Files using exportJSON/importJSON/exportDOM/importDOM: ${audit.serializationFiles.length}\n`);

  lines.push(`## React 19 risks inside editor code\n`);
  const r = audit.react19Hits;
  lines.push(`- forwardRef: ${r.forwardRef}`);
  lines.push(`- propTypes: ${r.propTypes}`);
  lines.push(`- bare useRef(): ${r.useRefBare}`);
  lines.push(`- JSX.* namespace: ${r.jsxNamespace}\n`);

  lines.push(`## Approve, or amend\n`);
  lines.push(`- Reply \`yes\` to accept this spec verbatim.`);
  lines.push(`- Reply \`AMEND:\` followed by lines of the form \`add-node: <Name> extends <Base> in <relpath>\`, \`drop-node: <Name>\`, \`add-plugin: <Name> in <relpath>\`, \`drop-plugin: <Name>\`, \`note: <free text>\`.`);
  lines.push(`- Reply \`no\` to abort the migration.`);

  writeFile(join(T, 'prompts', 'editor-spec.md'), lines.join('\n') + '\n');
  const state = readState(repoRoot);
  state.step = 'ask-spec';
  writeState(repoRoot, state);
  say(`spec prompt emitted: ${join(T, 'prompts', 'editor-spec.md')}`);
  process.exit(0);
}

// Default mode: parse answer
const answerPath = join(T, 'answers', 'editor-spec-answer.md');
if (!existsSync(answerPath)) stop(`missing user answer at ${answerPath}; run --emit-prompt first`);

const answer = readFileSync(answerPath, 'utf8').trim();
const verdict = /^yes\b/i.test(answer) ? 'accept'
  : /^no\b/i.test(answer) ? 'abort'
  : /^amend:/i.test(answer) ? 'amend'
  : 'unknown';

if (verdict === 'abort') stop('user aborted at spec confirmation');
if (verdict === 'unknown') stop(`could not parse answer (expected yes/no/AMEND:): ${answer.slice(0, 80)}`);

// Build the spec snapshot from audit + amendments
const spec = {
  approvedAt: new Date().toISOString(),
  lexicalVersions: audit.lexicalVersions,
  customNodes: [...audit.customNodes],
  plugins: [...audit.plugins],
  commandsCreated: audit.commandsCreated,
  themeFiles: audit.themeFiles,
  composers: audit.composers,
  serializationFiles: audit.serializationFiles,
  amendments: [],
};

if (verdict === 'amend') {
  const lines = answer.replace(/^amend:\s*/i, '').split('\n').map(l => l.trim()).filter(Boolean);
  for (const line of lines) {
    const addNode = line.match(/^add-node:\s*(\S+)\s+extends\s+(\S+)\s+in\s+(\S+)/);
    if (addNode) {
      spec.customNodes.push({ name: addNode[1], extends: addNode[2], file: addNode[3], methods: [], hasNonTrivialClone: false, addedManually: true });
      spec.amendments.push({ kind: 'add-node', name: addNode[1] });
      continue;
    }
    const dropNode = line.match(/^drop-node:\s*(\S+)/);
    if (dropNode) {
      spec.customNodes = spec.customNodes.filter(n => n.name !== dropNode[1]);
      spec.amendments.push({ kind: 'drop-node', name: dropNode[1] });
      continue;
    }
    const addPlugin = line.match(/^add-plugin:\s*(\S+)\s+in\s+(\S+)/);
    if (addPlugin) {
      spec.plugins.push({ name: addPlugin[1], file: addPlugin[2], exports: [addPlugin[1]], addedManually: true });
      spec.amendments.push({ kind: 'add-plugin', name: addPlugin[1] });
      continue;
    }
    const dropPlugin = line.match(/^drop-plugin:\s*(\S+)/);
    if (dropPlugin) {
      spec.plugins = spec.plugins.filter(p => p.name !== dropPlugin[1]);
      spec.amendments.push({ kind: 'drop-plugin', name: dropPlugin[1] });
      continue;
    }
    const note = line.match(/^note:\s*(.+)/);
    if (note) spec.amendments.push({ kind: 'note', text: note[1] });
  }
}

writeJson(join(T, 'editor-spec.json'), spec);

// Approval prompt is mostly informational since the user just amended.
const approvalLines = [
  `# Phase 1 — Spec recorded`,
  ``,
  `Verdict: **${verdict}**.`,
  `Nodes: ${spec.customNodes.length}, plugins: ${spec.plugins.length}, amendments: ${spec.amendments.length}.`,
  ``,
  `Reply \`ok\` to proceed to Phase 2 (version planning), or \`redo\` to re-run the spec prompt.`,
];
writeFile(join(T, 'prompts', 'spec-approval.md'), approvalLines.join('\n') + '\n');

const state = readState(repoRoot);
state.step = 'ask-approval';
writeState(repoRoot, state);

say(`spec parsed: nodes=${spec.customNodes.length} plugins=${spec.plugins.length} amendments=${spec.amendments.length}`);
