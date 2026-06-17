#!/usr/bin/env node
// sync/local-api.mjs — local sync API server
//
// Lets the dashboard (local dev or the Vercel-hosted page) trigger local
// work and read fresh local data. The browser calls http://127.0.0.1:7337
// — which runs on YOUR machine, not on Vercel — so it can read
// ~/.claude/projects/, ~/.codex/sessions/, and other local-only exports.
//
// All endpoints are read/local-only: session data is gitignored and no HTTP
// path here ever pushes to git.
//
// Usage:
//   node sync/local-api.mjs
//   MEOW_LOCAL_API_PORT=7437 node sync/local-api.mjs
//   MEOW_SYNC_PORT=7437 node sync/local-api.mjs   # legacy alias

import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { statSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');
const PORT = Number(process.env.MEOW_LOCAL_API_PORT || process.env.MEOW_SYNC_PORT || 7337);
const LOCAL_ACCESS_HEADER = 'x-meow-ops-local';
const LOOP_OPS_DIR = join(ROOT, 'public', 'data', 'loop-ops');
const SUPERADMIN_USAGE_FILE = join(ROOT, 'public', 'data', 'superadmin-usage.json');
const DEFAULT_ALLOWED_ORIGINS = [
  'https://meow-ops.vercel.app',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  `http://localhost:${PORT}`,
  `http://127.0.0.1:${PORT}`,
];
const EXTRA_ALLOWED_ORIGINS = (process.env.MEOW_DASHBOARD_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const ALLOWED_ORIGINS = new Set([...DEFAULT_ALLOWED_ORIGINS, ...EXTRA_ALLOWED_ORIGINS]);

// launchd and background processes don't always inherit a useful PATH.
// Prefer the exact Node binary running this file, then stable install locations.
function resolveNode() {
  const candidates = [
    process.execPath,
    '/opt/homebrew/bin/node',
    '/usr/local/bin/node',
    '/usr/bin/node',
  ];
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  try {
    return execFileSync('/usr/bin/env', ['which', 'node'], { encoding: 'utf8' }).trim();
  } catch {}
  return 'node';
}
const NODE = resolveNode();

// DNS-rebinding defense: a rebound attacker domain resolves to 127.0.0.1 but
// still sends its own Host header. Only accept localhost Host values.
function hostIsLocal(req) {
  const host = (req.headers.host || '').split(':')[0].replace(/[[\]]/g, '');
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (!origin) return { ok: true };
  if (!ALLOWED_ORIGINS.has(origin)) {
    return { ok: false, statusCode: 403, error: 'Forbidden origin' };
  }

  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', `Content-Type, ${LOCAL_ACCESS_HEADER}`);
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  res.setHeader('Access-Control-Max-Age', '600');
  return { ok: true };
}

function requireBrowserHeader(req, res) {
  if (!req.headers.origin) return true;
  if (req.headers[LOCAL_ACCESS_HEADER] === '1') return true;
  res.statusCode = 400;
  res.end(JSON.stringify({ ok: false, error: 'Missing local access header' }));
  return false;
}

const server = createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (!hostIsLocal(req)) {
    res.statusCode = 403;
    res.end(JSON.stringify({ ok: false, error: 'forbidden host' }));
    return;
  }

  const cors = applyCors(req, res);
  if (!cors.ok) {
    res.statusCode = cors.statusCode;
    res.end(JSON.stringify({ ok: false, error: cors.error }));
    return;
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const path = new URL(req.url, `http://localhost:${PORT}`).pathname;
  const needsBrowserHeader =
    path === '/sync'
    || path === '/sync/status'
    || path === '/data/sessions.json'
    || path === '/data/cost-summary.json';

  if (needsBrowserHeader && !requireBrowserHeader(req, res)) return;

  // ── GET /sync/status ──────────────────────────────────────────────────────
  if (path === '/sync/status' && req.method === 'GET') {
    try {
      const st = statSync(join(ROOT, 'public', 'data', 'sessions.json'));
      res.end(JSON.stringify({ ok: true, mtime: st.mtimeMs, size: st.size }));
    } catch {
      res.end(JSON.stringify({ ok: false, error: 'No data file yet' }));
    }
    return;
  }

  // ── GET /data/sessions.json or /data/cost-summary.json ────────────────────
  // Serve local files directly so the browser gets instant fresh data.
  if (req.method === 'GET' && (path === '/data/sessions.json' || path === '/data/cost-summary.json')) {
    const filename = path === '/data/sessions.json' ? 'sessions.json' : 'cost-summary.json';
    const filePath = join(ROOT, 'public', 'data', filename);
    try {
      const data = readFileSync(filePath, 'utf8');
      res.end(data);
    } catch {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'File not found - run a sync first' }));
    }
    return;
  }

  // ── POST /sync ────────────────────────────────────────────────────────────
  if (path === '/sync' && req.method === 'POST') {
    console.log(`\n[${new Date().toLocaleTimeString()}] Sync triggered from browser`);
    // HTTP-triggered sync is export-only. A browser request should never be
    // able to cause a git push, even if export-local supports manual flags.
    const child = spawn(NODE, [join(ROOT, 'sync', 'export-local.mjs')], {
      cwd: ROOT,
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      process.stderr.write(chunk);
    });

    const timer = setTimeout(() => child.kill(), 90_000);

    child.on('close', (code) => {
      clearTimeout(timer);
      let mtime = null;
      try {
        mtime = statSync(join(ROOT, 'public', 'data', 'sessions.json')).mtimeMs;
      } catch {}
      res.end(JSON.stringify({
        ok: code === 0,
        code,
        stdout: stdout.slice(-2000),
        stderr: stderr.slice(-500),
        mtime,
      }));
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      res.statusCode = 500;
      res.end(JSON.stringify({ ok: false, error: err.message }));
    });
    return;
  }

  // ── Loop-Ops endpoints (spec §Phase 4) — read/local-only ─────────────────
  // GET /loop-ops/spec and /loop-ops/runs serve the gitignored local JSON;
  // POST /loop-ops/sync re-runs the workbook importer. No push path exists
  // here by construction — the importer never touches git.

  if (req.method === 'GET' && (path === '/loop-ops/spec' || path === '/loop-ops/runs')) {
    const file = path === '/loop-ops/spec' ? 'spec.json' : 'runs.json';
    try {
      res.end(readFileSync(join(LOOP_OPS_DIR, file), 'utf8'));
    } catch {
      if (path === '/loop-ops/runs') {
        res.end('[]');
      } else {
        res.statusCode = 404;
        res.end(JSON.stringify({ ok: false, error: 'spec.json not found - POST /loop-ops/sync to import a Loop Ops workbook' }));
      }
    }
    return;
  }

  if (path === '/loop-ops/status' && req.method === 'GET') {
    const files = {};
    for (const name of ['spec.json', 'gates.json', 'runs.json']) {
      try {
        const st = statSync(join(LOOP_OPS_DIR, name));
        files[name] = { mtime: st.mtimeMs, size: st.size };
      } catch {
        files[name] = null;
      }
    }
    let entityCount = null;
    try {
      entityCount = JSON.parse(readFileSync(join(LOOP_OPS_DIR, 'spec.json'), 'utf8')).meta?.entityCount ?? null;
    } catch {}
    res.end(JSON.stringify({ ok: files['spec.json'] !== null, files, entityCount, productionWritesEnabled: false }));
    return;
  }

  if (path === '/loop-ops/sync' && req.method === 'POST') {
    console.log(`\n[${new Date().toLocaleTimeString()}] Loop-Ops import triggered from browser`);
    const child = spawn(NODE, [join(ROOT, 'sync', 'loop-ops-import.mjs')], {
      cwd: ROOT,
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += c; process.stdout.write(c); });
    child.stderr.on('data', (c) => { stderr += c; });

    const timer = setTimeout(() => child.kill(), 90_000);

    child.on('close', (code) => {
      clearTimeout(timer);
      let mtime = null;
      try { mtime = statSync(join(LOOP_OPS_DIR, 'spec.json')).mtimeMs; } catch {}
      res.end(JSON.stringify({ ok: code === 0, code, stdout: stdout.slice(-2000), stderr: stderr.slice(-500), mtime }));
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      res.statusCode = 500;
      res.end(JSON.stringify({ ok: false, error: err.message }));
    });
    return;
  }

  // ── SuperAdmin Capacity & Usage endpoints — read/local-only ──────────────
  // GET /superadmin-usage/data serves the sanitized local snapshot. POST
  // /superadmin-usage/sync refreshes it from local operator-owned sources.
  // No endpoint accepts provider credentials and no endpoint writes git.

  if (path === '/superadmin-usage/data' && req.method === 'GET') {
    try {
      res.end(readFileSync(SUPERADMIN_USAGE_FILE, 'utf8'));
    } catch {
      res.statusCode = 404;
      res.end(JSON.stringify({ ok: false, error: 'superadmin-usage.json not found — POST /superadmin-usage/sync first' }));
    }
    return;
  }

  if (path === '/superadmin-usage/status' && req.method === 'GET') {
    try {
      const st = statSync(SUPERADMIN_USAGE_FILE);
      res.end(JSON.stringify({ ok: true, mtime: st.mtimeMs, size: st.size, productionWritesEnabled: false }));
    } catch {
      res.end(JSON.stringify({ ok: false, productionWritesEnabled: false }));
    }
    return;
  }

  if (path === '/superadmin-usage/sync' && req.method === 'POST') {
    console.log(`\n[${new Date().toLocaleTimeString()}] SuperAdmin usage refresh triggered from browser`);
    const child = spawn(NODE, [join(ROOT, 'sync', 'superadmin-usage.mjs')], {
      cwd: ROOT,
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += c; process.stdout.write(c); });
    child.stderr.on('data', (c) => { stderr += c; });

    const timer = setTimeout(() => child.kill(), 120_000);

    child.on('close', (code) => {
      clearTimeout(timer);
      let mtime = null;
      try { mtime = statSync(SUPERADMIN_USAGE_FILE).mtimeMs; } catch {}
      res.end(JSON.stringify({ ok: code === 0, code, stdout: stdout.slice(-2000), stderr: stderr.slice(-500), mtime }));
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      res.statusCode = 500;
      res.end(JSON.stringify({ ok: false, error: err.message }));
    });
    return;
  }

  res.statusCode = 404;
  res.end(JSON.stringify({ ok: false, error: 'Not found' }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('Meow Ops local sync API');
  console.log(`  http://127.0.0.1:${PORT}`);
  console.log('  POST /sync                    - export local sessions only');
  console.log('  GET  /sync/status             - last export timestamp');
  console.log('  GET  /data/sessions.json      - exported session metrics');
  console.log('  GET  /data/cost-summary.json  - exported spend summary');
  console.log('  GET  /loop-ops/spec           - Loop-Ops entities (local import)');
  console.log('  GET  /loop-ops/status         - Loop-Ops file freshness');
  console.log('  GET  /loop-ops/runs           - recorded loop runs');
  console.log('  POST /loop-ops/sync           - re-import the Loop Ops workbook');
  console.log('  GET  /superadmin-usage/data   - sanitized local usage snapshot');
  console.log('  GET  /superadmin-usage/status - usage snapshot freshness');
  console.log('  POST /superadmin-usage/sync   - refresh local usage snapshot');
  console.log(`\n  Allowed browser origins: ${Array.from(ALLOWED_ORIGINS).join(', ')}\n`);
});
