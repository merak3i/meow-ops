// local-api.mjs Loop-Ops endpoints (spec §Phase 4). Boots the real server on
// a test port; data-dependent assertions skip when the local-only files are
// absent (fresh clones) — same convention as the Playwright suite.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

// Raw GET so we can spoof the Host header (fetch forbids overriding it).
function rawGet(path, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: PORT, path, method: 'GET', headers },
      (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve({ status: res.statusCode, body: d })); },
    );
    req.on('error', reject);
    req.end();
  });
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = 7437;
const BASE = `http://127.0.0.1:${PORT}`;
const SPEC_PRESENT = existsSync(join(ROOT, 'public', 'data', 'loop-ops', 'spec.json'));
const WORKBOOK = process.env.LOOP_OPS_SPEC || '';

let server;

before(async () => {
  server = spawn('node', [join(ROOT, 'sync', 'local-api.mjs')], {
    cwd: ROOT,
    env: { ...process.env, MEOW_LOCAL_API_PORT: String(PORT) },
    stdio: 'pipe',
  });
  // Wait for the listener — poll instead of trusting startup logs.
  for (let i = 0; i < 40; i++) {
    try {
      await fetch(`${BASE}/loop-ops/status`);
      return;
    } catch {
      await sleep(100);
    }
  }
  throw new Error('local-api did not start on test port');
});

after(() => { server?.kill(); });

test('GET /loop-ops/status reports files and the writes-disabled invariant', async () => {
  const res = await fetch(`${BASE}/loop-ops/status`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.productionWritesEnabled, false);
  assert.ok('spec.json' in body.files && 'gates.json' in body.files && 'runs.json' in body.files);
  assert.equal(body.ok, SPEC_PRESENT);
});

test('GET /loop-ops/spec serves the local spec', { skip: !SPEC_PRESENT }, async () => {
  const res = await fetch(`${BASE}/loop-ops/spec`);
  assert.equal(res.status, 200);
  const spec = await res.json();
  assert.ok(spec.meta.entityCount > 0);
  assert.equal(spec.meta.productionWritesEnabled, false);
});

test('GET /loop-ops/spec 404s with guidance when the file is absent', { skip: SPEC_PRESENT }, async () => {
  const res = await fetch(`${BASE}/loop-ops/spec`);
  assert.equal(res.status, 404);
  assert.match((await res.json()).error, /loop-ops\/sync/);
});

test('GET /loop-ops/runs returns [] when no runs are recorded', async () => {
  const res = await fetch(`${BASE}/loop-ops/runs`);
  assert.equal(res.status, 200);
  const runs = await res.json();
  assert.ok(Array.isArray(runs));
});

test('unknown loop-ops path still 404s', async () => {
  const res = await fetch(`${BASE}/loop-ops/deploy`);
  assert.equal(res.status, 404);
});

// ── Security: the localhost server must not be drivable cross-origin or via a
// rebound (non-localhost) Host header. Locks SEC-1/SEC-2 from the audit.
test('rejects a cross-origin request (foreign Origin → 403)', async () => {
  const res = await fetch(`${BASE}/loop-ops/status`, { headers: { Origin: 'https://evil.example.com' } });
  assert.equal(res.status, 403);
});

test('rejects a non-localhost Host header (DNS-rebinding → 403)', async () => {
  const res = await rawGet('/loop-ops/status', { Host: 'attacker.example.com' });
  assert.equal(res.status, 403);
});

test('allows a same-origin / no-Origin request', async () => {
  const res = await fetch(`${BASE}/loop-ops/status`); // no Origin header
  assert.equal(res.status, 200);
});

test('POST /loop-ops/sync runs the importer end-to-end', { skip: !WORKBOOK || !existsSync(WORKBOOK) }, async () => {
  const res = await fetch(`${BASE}/loop-ops/sync`, { method: 'POST' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true, body.stderr);
  assert.match(body.stdout, /entities \(\d+ surfaces\)/);
  assert.ok(typeof body.mtime === 'number');
});
