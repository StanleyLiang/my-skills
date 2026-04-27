#!/usr/bin/env node
// Phase 3a — Build shadcn UI mapping from user-supplied spec markdown.
//
// Modes:
//   --emit-prompt              write .twsp/prompts/ui-spec.md and exit (agent will ASK user)
//   (no flag, default)         read .twsp/answers/ui-spec-answer.md, parse, emit ui-mapping.json
//                              + emit ui-approval prompt
//
// The agent flow per next.mjs:
//   1. RUN build-shadcn-mapping.mjs --emit-prompt  → writes spec prompt
//   2. ASK ui-spec.md ui-spec-answer.md            → user pastes spec
//   3. RUN build-shadcn-mapping.mjs                → parses answer, writes mapping + approval prompt
//   4. ASK ui-approval.md ui-approval-answer.md    → user types yes/no/edit
//
// Spec format expected:
//   ## ComponentName
//   | Prop | Type | Default | Notes |
//   | ... |
//   <usage example block>

import { existsSync, readFileSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  say, stop, parseArgs, selfTestGate, readMigration, readAudit, readState, writeState,
  writeFile, readJson, writeJson, twspDir,
} from './_lib.mjs';

const SCRIPT = 'build-shadcn-mapping.mjs';
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

if (args.flags['emit-prompt']) {
  const prompt = `# Phase 3a — In-house UI spec needed\n\nThe migration detected the in-house UI package: \`${audit.inHousePkg}\` (used in ${audit.inHouseImportCount} import sites).\n\nPlease provide the package's component spec markdown. Either:\n\n1. Paste the full markdown below, **OR**\n2. Provide an absolute path on a single line starting with \`PATH:\` — e.g. \`PATH: /Users/me/repo/docs/ui-spec.md\`\n\n## Expected shape\n\nFor each component:\n\n\`\`\`md\n## ComponentName\n\n| Prop | Type | Default | Notes |\n|---|---|---|---|\n| variant | 'primary' \\| 'secondary' | primary | |\n| size | 'sm' \\| 'md' \\| 'lg' | md | |\n\n\`\`\`tsx\n<ComponentName variant=\"primary\" size=\"md\">Click</ComponentName>\n\`\`\`\n\`\`\`\n\nLoose variants are accepted — the parser will ask follow-ups for underspecified entries.\n`;
  const promptPath = join(T, 'prompts', 'ui-spec.md');
  writeFile(promptPath, prompt);

  // Advance state hint: the agent runs --advance after this; transition is to ask-ui-spec.
  const state = readState(sourceRoot);
  state.step = 'enter-3a';
  writeState(sourceRoot, state);

  say(`prompt written: ${promptPath}`);
  process.exit(0);
}

// ── Read user's spec answer ─────────────────────────────────────────
const answerPath = join(T, 'answers', 'ui-spec-answer.md');
if (!existsSync(answerPath)) stop(`missing user answer at ${answerPath}; run --emit-prompt first and have the user respond`);

let specText = readFileSync(answerPath, 'utf8').trim();

// PATH: redirect
if (specText.startsWith('PATH:')) {
  const p = specText.slice(5).trim();
  if (!existsSync(p)) stop(`user-supplied PATH not found: ${p}`);
  specText = readFileSync(p, 'utf8');
}

// ── Parse spec ──────────────────────────────────────────────────────
// Each ## H2 heading starts a component. Capture its body until the next ## or EOF.
const sections = [];
const lines = specText.split('\n');
let cur = null;
for (const ln of lines) {
  const h2 = ln.match(/^##\s+(.+)$/);
  if (h2) {
    if (cur) sections.push(cur);
    cur = { name: h2[1].trim(), body: '' };
  } else if (cur) {
    cur.body += ln + '\n';
  }
}
if (cur) sections.push(cur);

if (sections.length === 0) stop('no ## ComponentName headings found in spec');

// ── Map each component to a shadcn primitive (heuristics) ──────────
const heuristics = [
  [/^(btn|button|primarybutton|actionbutton|iconbutton)$/i, 'Button'],
  [/^(textfield|textinput|input|searchbox)$/i, 'Input'],
  [/^(textarea|multilineinput)$/i, 'Textarea'],
  [/^(label)$/i, 'Label'],
  [/^(checkbox)$/i, 'Checkbox'],
  [/^(radio|radiogroup|radiobutton)$/i, 'RadioGroup'],
  [/^(switch|toggle(?!group))$/i, 'Switch'],
  [/^(togglegroup|buttongroup)$/i, 'ToggleGroup'],
  [/^(select|combobox|dropdownselect)$/i, 'Select'],
  [/^(modal|dialog)$/i, 'Dialog'],
  [/^(alert|alertdialog|confirmdialog)$/i, 'AlertDialog'],
  [/^(drawer|sheet|sidepanel)$/i, 'Sheet'],
  [/^(popover|popout)$/i, 'Popover'],
  [/^(tooltip|hint)$/i, 'Tooltip'],
  [/^(hovercard)$/i, 'HoverCard'],
  [/^(dropdown|menu|dropdownmenu|kebabmenu)$/i, 'DropdownMenu'],
  [/^(contextmenu|rightclickmenu)$/i, 'ContextMenu'],
  [/^(menubar)$/i, 'Menubar'],
  [/^(toast|notification|snackbar)$/i, 'Sonner'],
  [/^(card|panel|tile)$/i, 'Card'],
  [/^(separator|divider)$/i, 'Separator'],
  [/^(scrollarea)$/i, 'ScrollArea'],
  [/^(tabs|tabbar|tablist)$/i, 'Tabs'],
  [/^(accordion|expander)$/i, 'Accordion'],
  [/^(collapsible)$/i, 'Collapsible'],
  [/^(resizable|splitter)$/i, 'Resizable'],
  [/^(aspectratio)$/i, 'AspectRatio'],
  [/^(avatar|profilepic)$/i, 'Avatar'],
  [/^(badge|tag|chip)$/i, 'Badge'],
  [/^(skeleton|loadingplaceholder)$/i, 'Skeleton'],
  [/^(progress|progressbar)$/i, 'Progress'],
  [/^(slider)$/i, 'Slider'],
  [/^(calendar)$/i, 'Calendar'],
  [/^(table|datatable)$/i, 'Table'],
  [/^(pagination)$/i, 'Pagination'],
  [/^(command|commandpalette)$/i, 'Command'],
  [/^(navigationmenu|navmenu)$/i, 'NavigationMenu'],
  [/^(breadcrumb|breadcrumbs)$/i, 'Breadcrumb'],
  [/^(sidebar|navrail)$/i, 'Sidebar'],
];

function pickShadcn(name) {
  for (const [re, target] of heuristics) if (re.test(name)) return target;
  return null;
}

function parsePropTable(body) {
  // Find first markdown table; capture rows.
  const re = /\|\s*Prop[^\n]*\n\|[-:\s|]+\|\n((?:\|[^\n]+\n)+)/i;
  const m = body.match(re);
  if (!m) return [];
  const rows = m[1].trim().split('\n');
  return rows.map(r => {
    const cells = r.split('|').slice(1, -1).map(c => c.trim());
    return { prop: cells[0], type: cells[1] || '', default: cells[2] || '', notes: cells[3] || '' };
  });
}

const mapping = [];
const stops = [];
for (const sec of sections) {
  const target = pickShadcn(sec.name);
  if (!target) {
    stops.push({ name: sec.name, reason: 'no plausible shadcn primitive' });
    continue;
  }
  const props = parsePropTable(sec.body);
  mapping.push({
    inHouseName: sec.name,
    shadcnPrimitive: target,
    propRenames: {}, // user may amend in approval
    propDrops: [],
    propAdds: {},
    notes: '',
    sourceProps: props,
  });
}

writeJson(join(T, 'ui-mapping.json'), {
  generatedAt: new Date().toISOString(),
  inHousePkg: audit.inHousePkg,
  primitivesNeeded: [...new Set(mapping.map(e => e.shadcnPrimitive))],
  mappings: mapping,
  stops,
});

// ── Emit approval prompt ────────────────────────────────────────────
const approvalLines = [];
approvalLines.push('# Phase 3a — UI mapping for review\n');
approvalLines.push(`Source package: \`${audit.inHousePkg}\` — ${sections.length} components in spec.\n`);
approvalLines.push('## Proposed mapping\n');
approvalLines.push('| In-house | shadcn primitive | Props in spec |');
approvalLines.push('|---|---|---|');
for (const e of mapping) {
  approvalLines.push(`| ${e.inHouseName} | ${e.shadcnPrimitive} | ${e.sourceProps.map(p => p.prop).join(', ')} |`);
}
if (stops.length > 0) {
  approvalLines.push('\n## Components with no clean shadcn primitive (will STOP without your guidance)\n');
  for (const s of stops) approvalLines.push(`- ${s.name} — ${s.reason}`);
}
approvalLines.push('\n## Approve this mapping?\n');
approvalLines.push('Reply with one of:\n');
approvalLines.push('- `yes` to proceed');
approvalLines.push('- `no` to abort');
approvalLines.push('- A markdown block starting with `EDITS:` and listing per-component prop overrides, e.g.:\n');
approvalLines.push('  ```');
approvalLines.push('  EDITS:');
approvalLines.push('  - InHouseButton: rename `kind` → `variant`, drop `legacy`, add `size: default`');
approvalLines.push('  ```');
writeFile(join(T, 'prompts', 'ui-approval.md'), approvalLines.join('\n') + '\n');

// ── State advance ──────────────────────────────────────────────────
const state = readState(sourceRoot);
state.step = 'parse-ui-spec';
writeState(sourceRoot, state);

say(`ui-mapping: components=${sections.length} mapped=${mapping.length} stops=${stops.length} primitives=${[...new Set(mapping.map(e => e.shadcnPrimitive))].length}`);
