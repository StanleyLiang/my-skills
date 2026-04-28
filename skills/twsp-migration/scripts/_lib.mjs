// Shared helpers for all twsp-migration scripts.
// Plain Node, no external deps.

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, readdirSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve, relative, basename, extname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const SKILL_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');

// ── Token-aware stdout ───────────────────────────────────────────────
// Crude: assume ~4 chars/token. Cap at 200 tokens (~800 chars).
const STDOUT_CAP_CHARS = 800;
let stdoutBytes = 0;
export function say(line) {
  const s = String(line);
  if (stdoutBytes + s.length + 1 > STDOUT_CAP_CHARS) {
    if (stdoutBytes < STDOUT_CAP_CHARS) {
      const remaining = STDOUT_CAP_CHARS - stdoutBytes - 4;
      if (remaining > 0) process.stdout.write(s.slice(0, remaining) + '\n…\n');
      stdoutBytes = STDOUT_CAP_CHARS;
    }
    return;
  }
  process.stdout.write(s + '\n');
  stdoutBytes += s.length + 1;
}

export function stop(reason, logPath) {
  const detail = logPath ? `; details: ${logPath}` : '';
  process.stderr.write(`STOP ${reason}${detail}\n`);
  process.exit(2);
}

// ── State paths ──────────────────────────────────────────────────────
export function twspDir(rootDir) {
  return join(rootDir, '.twsp');
}
export function ensureTwspDir(rootDir) {
  const d = twspDir(rootDir);
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  if (!existsSync(join(d, 'logs'))) mkdirSync(join(d, 'logs'), { recursive: true });
  return d;
}

export function readJson(path, fallback = null) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function writeJson(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
}

export function readMigration(sourceRoot) {
  return readJson(join(twspDir(sourceRoot), 'migration.json'));
}

export function readAudit(sourceRoot) {
  return readJson(join(twspDir(sourceRoot), 'audit.json'));
}

export function readState(sourceRoot) {
  return readJson(join(twspDir(sourceRoot), 'state.json'));
}

export function writeState(sourceRoot, state) {
  writeJson(join(twspDir(sourceRoot), 'state.json'), state);
}

// ── Args ─────────────────────────────────────────────────────────────
export function parseArgs(argv) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq >= 0) out.flags[a.slice(2, eq)] = a.slice(eq + 1);
      else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        out.flags[a.slice(2)] = argv[++i];
      } else out.flags[a.slice(2)] = true;
    } else {
      out._.push(a);
    }
  }
  return out;
}

// ── Self-test gate ───────────────────────────────────────────────────
// Every script supports --self-test which exits 0 on a no-op repo.
export function selfTestGate(args, scriptName) {
  if (args.flags['self-test']) {
    say(`${scriptName}: self-test ok`);
    process.exit(0);
  }
}

// ── File walking ─────────────────────────────────────────────────────
export function walk(dir, opts = {}) {
  const { exts = null, ignore = ['node_modules', '.git', '.next', 'dist', '.twsp'], absolute = true } = opts;
  const out = [];
  function rec(d) {
    if (!existsSync(d)) return;
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (ignore.includes(e.name)) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) rec(p);
      else if (e.isFile()) {
        if (exts && !exts.includes(extname(e.name))) continue;
        out.push(absolute ? p : relative(dir, p));
      }
    }
  }
  rec(dir);
  return out;
}

// ── Shell helpers ────────────────────────────────────────────────────
export function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: opts.inherit ? 'inherit' : 'pipe', cwd: opts.cwd, env: { ...process.env, ...opts.env }, encoding: 'utf8' });
  return { code: r.status ?? 1, stdout: r.stdout || '', stderr: r.stderr || '' };
}

export function logSidecar(rootDir, scriptName, content) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const p = join(twspDir(rootDir), 'logs', `${scriptName}-${ts}.log`);
  ensureTwspDir(rootDir);
  writeFileSync(p, content);
  return p;
}

// ── Package.json helpers ─────────────────────────────────────────────
export function readPkg(rootDir) {
  const p = join(rootDir, 'package.json');
  return readJson(p, null);
}

export function writePkg(rootDir, pkg) {
  writeJson(join(rootDir, 'package.json'), pkg);
}

export function depVersion(pkg, name) {
  return pkg?.dependencies?.[name] || pkg?.devDependencies?.[name] || pkg?.peerDependencies?.[name] || null;
}

export function detectMajor(versionRange) {
  if (!versionRange) return null;
  const m = String(versionRange).match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

// ── Template helpers ─────────────────────────────────────────────────
export function readTemplate(name) {
  return readFileSync(join(SKILL_ROOT, 'templates', name), 'utf8');
}

// ── Recursive copy with optional transform ───────────────────────────
export function copyDir(src, dst, opts = {}) {
  const { transform = null, ignore = ['node_modules', '.git', '.next', 'dist', '.twsp'] } = opts;
  if (!existsSync(src)) return 0;
  let n = 0;
  function rec(s, d) {
    mkdirSync(d, { recursive: true });
    for (const e of readdirSync(s, { withFileTypes: true })) {
      if (ignore.includes(e.name)) continue;
      const sp = join(s, e.name);
      const dp = join(d, e.name);
      if (e.isDirectory()) rec(sp, dp);
      else if (e.isFile()) {
        if (transform) {
          const content = readFileSync(sp, 'utf8');
          const out = transform(content, sp);
          writeFileSync(dp, out);
        } else {
          copyFileSync(sp, dp);
        }
        n++;
      }
    }
  }
  rec(src, dst);
  return n;
}

export function fileExists(p) {
  return existsSync(p);
}

export function isDir(p) {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

export function ensureDir(p) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

export function readFile(p) {
  return readFileSync(p, 'utf8');
}

export function writeFile(p, content) {
  ensureDir(dirname(p));
  writeFileSync(p, content);
}
