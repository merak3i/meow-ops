// Today · Swarm client: the page-side contract with sync/swarm-status.mjs.
// Transpiles src/lib/swarm-api.ts on its own (it has no imports) and checks
// that the reader's real output passes the page's validator, that the hosted
// shell never calls the helper, and that the commands it hands out are exact.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';

import { readSwarmSnapshot } from '../swarm-status.mjs';

const source = readFileSync(new URL('../../src/lib/swarm-api.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const api = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('the hosted shell never calls the local helper', async () => {
  let calls = 0;
  const client = api.createSwarmClient({ hostname: 'meow-ops.vercel.app', fetcher: async () => { calls++; assert.fail('must not fetch'); } });
  await assert.rejects(client.read(), /local dashboard only/);
  assert.equal(calls, 0);
  assert.equal(api.isLocalSwarmSurface('127.0.0.1'), true);
  assert.equal(api.isLocalSwarmSurface('localhost.evil.test'), false);
});

test('local reads send the access header to loopback only and verify the shape', async () => {
  const seen = [];
  const sample = api.SAMPLE_SWARM;
  const client = api.createSwarmClient({
    hostname: 'localhost',
    fetcher: async (url, init) => { seen.push({ url: String(url), init }); return new Response(JSON.stringify({ ...sample, scope: 'local-only' }), { status: 200 }); },
  });
  const snap = await client.read();
  assert.equal(snap.scope, 'local-only');
  assert.match(seen[0].url, /^http:\/\/127\.0\.0\.1:7337\/swarm\/status\?t=\d+$/);
  assert.equal(seen[0].init.headers['x-meow-ops-local'], '1');

  const remote = api.createSwarmClient({ hostname: 'localhost', baseUrl: 'http://evil.test/', fetcher: async () => assert.fail('must not fetch') });
  await assert.rejects(remote.read(), /loopback/);

  const garbage = api.createSwarmClient({ hostname: 'localhost', fetcher: async () => new Response(JSON.stringify({ ok: true, providers: 'x' }), { status: 200 }) });
  await assert.rejects(garbage.read(), /could not be verified/);

  const old = api.createSwarmClient({ hostname: 'localhost', fetcher: async () => new Response('{"ok":false}', { status: 404 }) });
  await assert.rejects(old.read(), /Restart it with the updated app/);
});

test('the reader output and the sample both pass the page validator', () => {
  const root = mkdtempSync(join(tmpdir(), 'meow-swarm-contract-'));
  try {
    const home = join(root, 'autoswarm');
    const dir = join(home, 'calls', 'call_ab12');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'task.json'), JSON.stringify({ call_id: 'call_ab12', provider: 'codex', prompt: 'Review the diff', workspace: '/tmp/x', created_at: '2026-11-03T05:00:00Z' }));
    writeFileSync(join(dir, 'result.json'), JSON.stringify({ outcome: 'completed', content: 'ok', native_session_id: 's1', finished_at: '2026-11-03T05:00:30Z' }));
    const snap = readSwarmSnapshot({ env: { PATH: '' }, homeDir: root, platform: 'darwin', autoswarmHome: home, now: Date.parse('2026-11-03T06:00:00Z'), isAlive: () => false });
    assert.equal(api.isSwarmSnapshot(snap), true);
    assert.equal(api.isSwarmSnapshot(api.SAMPLE_SWARM), true);
    assert.equal(api.isSwarmSnapshot({ ...snap, schemaVersion: 2 }), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('commands are exact and safely quoted', () => {
  assert.equal(api.probeCommand(['codex', 'claude-code'], '~/Repos/demo app'), "autoswarm doctor --agent codex --agent claude-code --probe --cwd '~/Repos/demo app'");
  assert.equal(api.probeCommand(['dsh'], '~/Repos/demo'), 'autoswarm doctor --agent dsh --probe --cwd ~/Repos/demo');
  assert.equal(api.probeCommand(['hermes'], null), 'autoswarm doctor --agent hermes --probe --cwd .');
  assert.equal(api.checkCommand(['cursor']), 'autoswarm doctor --agent cursor');
  assert.equal(api.inspectCommand('call_ab12'), 'autoswarm inspect call_ab12');
  assert.equal(api.decisionCommand('call_ab12', `approval_${'0'.repeat(32)}`, true), `autoswarm approve call_ab12 approval_${'0'.repeat(32)} --by user`);
  assert.equal(api.decisionCommand('call_ab12', "x'; rm -rf ~", false), "autoswarm deny call_ab12 'x'\\''; rm -rf ~' --by user");
});

test('the orbit keeps you above the ring and spreads the team evenly', () => {
  for (const [agents, extras] of [[1, 0], [5, 0], [12, 0], [5, 3], [7, 1]]) {
    const layout = api.orbitLayout(agents, extras);
    assert.equal(layout.agents.length, agents);
    assert.equal(layout.extras.length, extras);
    const top = Math.min(...layout.agents.map((point) => point.y - point.r));
    assert.ok(layout.owner.y + layout.owner.r < top, `owner clears the ring for ${agents}/${extras}`);
    const all = [...layout.agents, ...layout.extras];
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const gap = Math.hypot(all[i].x - all[j].x, all[i].y - all[j].y);
        assert.ok(gap > all[i].r + all[j].r, `nodes ${i} and ${j} do not overlap for ${agents}/${extras}`);
      }
    }
    for (const point of all) {
      assert.ok(point.x - point.r >= 0 && point.x + point.r <= layout.width, 'inside horizontally');
      assert.ok(point.y + point.r + 34 <= layout.height, 'labels inside vertically');
    }
  }
  assert.equal(api.wireWidth(0), 1.25);
  assert.ok(api.wireWidth(1000) <= 4.25);
});

test('labels never invent a state', () => {
  const sample = api.SAMPLE_SWARM;
  assert.deepEqual(api.visibleProviders(sample, false).map((p) => p.id), ['codex', 'claude-code', 'cursor', 'hermes', 'dsh']);
  assert.equal(api.visibleProviders(sample, true).length, 12);
  assert.equal(api.statusLine({ state: 'waiting', pendingApprovals: 2, lastErrorCode: null, model: null }), '2 waiting on you');
  assert.equal(api.statusLine({ state: 'failing', pendingApprovals: 0, lastErrorCode: 'resume_failed', model: null }), 'failed: resume_failed');
  assert.equal(api.ago(null, Date.now()), 'Unavailable');
  assert.equal(api.duration(null), 'Unavailable');
  assert.equal(api.duration(65_000), '1m 5s');
});
