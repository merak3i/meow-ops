// local-api.mjs Loop-Ops endpoints (spec §Phase 4). Boots the real server on
// a test port; data-dependent assertions skip when the local-only files are
// absent (fresh clones) — same convention as the Playwright suite.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { createServer } from 'node:net';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { updateSessionHistory } from '../session-history.mjs';

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
let PORT;
let BASE;
const WORKBOOK = process.env.LOOP_OPS_SPEC || join(ROOT, 'examples', 'loop-ops', 'demo-spec.xlsx');

let server;
let ledgerDir;
let historyDir;
let loopOpsDir;

before(async () => {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  PORT = probe.address().port;
  BASE = `http://127.0.0.1:${PORT}`;
  await new Promise((resolve) => probe.close(resolve));
  ledgerDir = mkdtempSync(join(tmpdir(), 'meow-loop-api-'));
  historyDir = mkdtempSync(join(tmpdir(), 'meow-history-api-'));
  loopOpsDir = mkdtempSync(join(tmpdir(), 'meow-loop-ops-api-'));
  updateSessionHistory([
    {
      session_id: 'history-a', project: 'alpha', source: 'codex', model: 'gpt-5',
      ended_at: '2026-07-16T12:00:00.000Z', total_tokens: 10,
      estimated_cost_usd: 0.1, duration_seconds: 60,
    },
    {
      session_id: 'history-b', project: 'beta', source: 'claude', model: 'opus',
      ended_at: '2026-07-15T12:00:00.000Z', total_tokens: 20,
      estimated_cost_usd: 0.2, duration_seconds: 120,
    },
  ], { dir: historyDir });
  writeFileSync(join(ledgerDir, 'runs.jsonl'), `${JSON.stringify({
    run_id: 'run-api-fixture',
    loop_id: 'meow-ops-dev',
    captured_at: '2026-07-16T12:00:00.000Z',
    sources: ['codex'],
    session_ids: ['session-api'],
    metrics: { sessions: 1, duration_seconds: 2, total_tokens: 150, cost_usd_real: 1.5, message_count: 2, tool_error_count: 0 },
    schema_version: 1,
  })}\n`, 'utf8');
  server = spawn(process.execPath, [join(ROOT, 'sync', 'local-api.mjs')], {
    cwd: ROOT,
    env: {
      ...process.env,
      MEOW_LOCAL_API_PORT: String(PORT),
      MEOW_LOOP_DIR: ledgerDir,
      MEOW_SESSION_HISTORY_DIR: historyDir,
      MEOW_LOOP_OPS_DIR: loopOpsDir,
      LOOP_OPS_SPEC: WORKBOOK,
    },
    stdio: 'pipe',
  });
  // Readiness must come from our child, never an unrelated listener.
  await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('fixture helper startup timed out')), 5000);
    const cleanup = () => { clearTimeout(timer); server.off('exit', failed); server.off('error', failed); server.stdout.off('data', ready); };
    const failed = () => { cleanup(); reject(new Error('fixture helper exited before listening')); };
    const ready = (chunk) => {
      output = (output + chunk).slice(-4000);
      if (output.includes(BASE)) { cleanup(); resolve(); }
    };
    server.once('exit', failed);
    server.once('error', failed);
    server.stdout.on('data', ready);
  });
  assert.equal((await fetch(`${BASE}/loop-ops/status`)).status, 200);
});

after(async () => {
  if (server && server.exitCode === null && server.signalCode === null) {
    await new Promise((resolve) => { server.once('exit', resolve); server.kill(); });
  }
  if (ledgerDir) rmSync(ledgerDir, { recursive: true, force: true });
  if (historyDir) rmSync(historyDir, { recursive: true, force: true });
  if (loopOpsDir) rmSync(loopOpsDir, { recursive: true, force: true });
});

test('GET /session-history/sessions filters before paginating the full archive', async () => {
  const res = await fetch(`${BASE}/session-history/sessions?project=alpha&limit=1`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.archive.total, 2);
  assert.equal(body.total, 1);
  assert.deepEqual(body.items.map((row) => row.session_id), ['history-a']);
  assert.deepEqual(body.facets.projects, ['alpha', 'beta']);
});

test('session history is local-origin-only and still requires the local access header', async () => {
  const missing = await fetch(`${BASE}/session-history/sessions`, {
    headers: { Origin: 'http://localhost:4273' },
  });
  assert.equal(missing.status, 400);

  const hosted = await fetch(`${BASE}/session-history/sessions`, {
    headers: { Origin: 'https://meow-ops.vercel.app', 'x-meow-ops-local': '1' },
  });
  assert.equal(hosted.status, 403);

  const local = await fetch(`${BASE}/session-history/sessions`, {
    headers: { Origin: 'http://localhost:4273', 'x-meow-ops-local': '1' },
  });
  assert.equal(local.status, 200);
});

test('hosted dashboards cannot fetch raw local session or cost summaries', async () => {
  for (const path of ['/data/sessions.json', '/data/cost-summary.json', '/data/snapshot.json', '/storage']) {
    const response = await fetch(`${BASE}${path}`, {
      headers: { Origin: 'https://meow-ops.vercel.app', 'x-meow-ops-local': '1' },
    });
    assert.equal(response.status, 403, path);
  }
});

test('hosted dashboards cannot read or trigger local operational APIs', async () => {
  const hostedHeaders = { Origin: 'https://meow-ops.vercel.app', 'x-meow-ops-local': '1' };
  const requests = [
    ['/sync/status', 'GET'],
    ['/sync', 'POST'],
    ['/storage/refresh', 'POST'],
    ['/storage/open-folder', 'POST'],
    ['/sync/runs/example', 'GET'],
    ['/loop-eng/summary', 'GET'],
    ['/loop-eng/decisions', 'GET'],
    ['/loop-ops/spec', 'GET'],
    ['/loop-ops/status', 'GET'],
    ['/loop-ops/sync', 'POST'],
    ['/superadmin-usage/data', 'GET'],
    ['/superadmin-usage/status', 'GET'],
    ['/superadmin-usage/sync', 'POST'],
  ];

  for (const [path, method] of requests) {
    const response = await fetch(`${BASE}${path}`, { method, headers: hostedHeaders });
    assert.equal(response.status, 403, `${method} ${path}`);
  }
});

test('hosted preflights cannot request private API access', async () => {
  const origin = 'https://meow-ops.vercel.app';
  for (const [path, method] of [
    ['/session-history/sessions', 'GET'],
    ['/data/sessions.json', 'GET'],
    ['/data/cost-summary.json', 'GET'],
    ['/sync', 'POST'],
    ['/loop-eng/summary', 'GET'],
    ['/loop-ops/status', 'GET'],
    ['/superadmin-usage/status', 'GET'],
    ['/projects', 'GET'],
    ['/project-intelligence/snapshot', 'POST'],
    ['/companion/preferences', 'GET'],
    ['/learning-quest/snapshot', 'POST'],
  ]) {
    const response = await fetch(`${BASE}${path}`, {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': method,
        'Access-Control-Request-Headers': 'x-meow-ops-local',
      },
    });
    assert.equal(response.status, 403, `${method} ${path}`);
    assert.equal(response.headers.get('access-control-allow-origin'), null, `${method} ${path}`);
    assert.equal(response.headers.get('access-control-allow-private-network'), null, `${method} ${path}`);
  }

  const publicSnapshot = await fetch(`${BASE}/learning-quest/snapshot`, {
    method: 'OPTIONS',
    headers: { Origin: origin, 'Access-Control-Request-Method': 'GET' },
  });
  assert.equal(publicSnapshot.status, 204);
  assert.equal(publicSnapshot.headers.get('access-control-allow-origin'), origin);
});

test('private local API rejects untrusted localhost ports and accepts the current preview port', async () => {
  const untrusted = await fetch(`${BASE}/session-history/sessions`, {
    headers: { Origin: 'http://localhost:65530', 'x-meow-ops-local': '1' },
  });
  assert.equal(untrusted.status, 403);

  const preview = await fetch(`${BASE}/session-history/sessions`, {
    headers: { Origin: 'http://localhost:4273', 'x-meow-ops-local': '1' },
  });
  assert.equal(preview.status, 200);
});

test('GET /loop-ops/status reports files and the writes-disabled invariant', async () => {
  const res = await fetch(`${BASE}/loop-ops/status`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.productionWritesEnabled, false);
  assert.ok('spec.json' in body.files && 'gates.json' in body.files && 'runs.json' in body.files);
  assert.equal(body.ok, false);
  assert.equal(body.files['spec.json'], null);
});

test('GET /loop-ops/spec reports a missing spec before import', async () => {
  const res = await fetch(`${BASE}/loop-ops/spec`);
  assert.equal(res.status, 404);
  assert.match((await res.json()).error, /loop-ops\/sync/);
});

test('GET /loop-ops/runs serves transformed local ledger runs when runs.json is absent', async () => {
  const res = await fetch(`${BASE}/loop-ops/runs`);
  assert.equal(res.status, 200);
  const runs = await res.json();
  assert.equal(runs.length, 1);
  assert.equal(runs[0].id, 'run-api-fixture');
  assert.equal(runs[0].cost.usd, 1.5);
});

test('GET /loop-ops/gates is GET-only and returns local gate evidence or an empty fallback', async () => {
  const res = await fetch(`${BASE}/loop-ops/gates`);
  assert.equal(res.status, 200);
  const gates = await res.json();
  assert.ok(Array.isArray(gates));
  for (const gate of gates) {
    assert.equal(typeof gate.id, 'string');
    assert.equal(typeof gate.entityId, 'string');
  }

  const writeAttempt = await fetch(`${BASE}/loop-ops/gates`, { method: 'POST' });
  assert.equal(writeAttempt.status, 404);
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

test('failed Loop Ops sync does not expose workbook paths or importer output', { skip: existsSync(WORKBOOK) }, async () => {
  const output = [];
  const capture = (chunk) => output.push(String(chunk));
  server.stdout.on('data', capture);
  server.stderr.on('data', capture);
  try {
    const response = await fetch(`${BASE}/loop-ops/sync`, { method: 'POST' });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body, { ok: false, code: 1, mtime: null });
    assert.equal(JSON.stringify(body).includes(WORKBOOK), false);
  } finally {
    server.stdout.off('data', capture);
    server.stderr.off('data', capture);
  }
  assert.equal(output.join('').includes(WORKBOOK), false);
});

test('POST /loop-ops/sync runs the bundled demo importer end-to-end', { skip: !existsSync(WORKBOOK) }, async () => {
  const res = await fetch(`${BASE}/loop-ops/sync`, { method: 'POST' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.code, 0);
  assert.equal('stdout' in body, false);
  assert.equal('stderr' in body, false);
  assert.ok(typeof body.mtime === 'number');
  const specResponse = await fetch(`${BASE}/loop-ops/spec`);
  assert.equal(specResponse.status, 200);
  const spec = await specResponse.json();
  assert.ok(spec.meta.entityCount > 0);
  assert.equal(spec.meta.productionWritesEnabled, false);
});
