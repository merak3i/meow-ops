#!/usr/bin/env node
// sync/local-api.mjs — local sync API server
//
// Lets the Vercel-hosted dashboard trigger a local export + push.
// The browser calls http://localhost:7337/sync — which runs on YOUR machine,
// not on Vercel — so it can read ~/.claude/projects/ and push to GitHub.
//
// Usage:
//   node sync/local-api.mjs           # export + push (default)
//   node sync/local-api.mjs --no-push # export only, skip git push

import { createServer }   from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { statSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname }  from 'node:path';
import { fileURLToPath }  from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT  = join(__dir, '..');
const PORT  = 7337;
const NO_PUSH = process.argv.includes('--no-push');

// launchd doesn't inherit shell PATH — resolve node's full path explicitly
function resolveNode() {
  const candidates = [
    process.execPath,                  // the node that's running THIS script
    '/opt/homebrew/bin/node',
    '/usr/local/bin/node',
    '/usr/bin/node',
  ];
  for (const p of candidates) {
    if (p && existsSync(p)) return p;
  }
  // last resort: ask the shell
  try { return execFileSync('/usr/bin/env', ['which', 'node'], { encoding: 'utf8' }).trim(); } catch {}
  return 'node';
}
const NODE = resolveNode();

function cors(res, origin) {
  res.setHeader('Access-Control-Allow-Origin',  origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  // Required for Chrome Private Network Access (HTTPS page → http://localhost)
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
}

const server = createServer((req, res) => {
  cors(res, req.headers.origin);
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const path = new URL(req.url, `http://localhost:${PORT}`).pathname;

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
  // Serve local files directly so the browser gets instant fresh data
  // without waiting for Vercel to redeploy after a push.
  if (req.method === 'GET' && (path === '/data/sessions.json' || path === '/data/cost-summary.json')) {
    const filename = path === '/data/sessions.json' ? 'sessions.json' : 'cost-summary.json';
    const filePath = join(ROOT, 'public', 'data', filename);
    try {
      const data = readFileSync(filePath, 'utf8');
      res.end(data);
    } catch {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'File not found — run a sync first' }));
    }
    return;
  }

  // ── POST /sync ────────────────────────────────────────────────────────────
  if (path === '/sync' && req.method === 'POST') {
    console.log(`\n[${new Date().toLocaleTimeString()}] Sync triggered from browser`);
    const args = NO_PUSH ? [] : ['--push'];
    const child = spawn(NODE, [join(ROOT, 'sync', 'export-local.mjs'), ...args], {
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
      try { mtime = statSync(join(ROOT, 'public', 'data', 'sessions.json')).mtimeMs; } catch {}
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
  console.log(`🐱 Meow Ops local sync API`);
  console.log(`   http://localhost:${PORT}`);
  console.log(`   POST /sync        — export + ${NO_PUSH ? 'skip push' : 'push to GitHub'}`);
  console.log(`   GET  /sync/status — last sync timestamp`);
  console.log(`\n   Keep this running while using the dashboard.\n`);
});
