#!/usr/bin/env node
// sync/local-api.mjs - local sync API server
//
// Lets a deployed dashboard fetch sessions directly from this machine.
// The browser calls http://127.0.0.1:7337/*, which runs on YOUR machine,
// not on Vercel, so it can read ~/.claude/projects/ and ~/.codex/sessions/.
//
// Usage:
//   node sync/local-api.mjs
//   MEOW_SYNC_PORT=7338 node sync/local-api.mjs

import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { statSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');
const PORT = Number(process.env.MEOW_SYNC_PORT || 7337);
const LOCAL_ACCESS_HEADER = 'x-meow-ops-local';
const DEFAULT_ALLOWED_ORIGINS = [
  'https://meow-ops.vercel.app',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
];
const EXTRA_ALLOWED_ORIGINS = (process.env.MEOW_ALLOWED_ORIGINS || '')
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

  res.statusCode = 404;
  res.end(JSON.stringify({ ok: false, error: 'Not found' }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('Meow Ops local sync API');
  console.log(`  http://127.0.0.1:${PORT}`);
  console.log('  POST /sync                  - export local sessions');
  console.log('  GET  /sync/status           - last export timestamp');
  console.log('  GET  /data/sessions.json    - exported session metrics');
  console.log('  GET  /data/cost-summary.json - exported spend summary');
  console.log(`\n  Allowed browser origins: ${Array.from(ALLOWED_ORIGINS).join(', ')}\n`);
});
