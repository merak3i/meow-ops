import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../../src/lib/storage-api.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { createStorageClient, formatStorageBytes, isStorageSnapshot, isLocalStorageSurface } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const counts = { fileCount: 1, logicalBytes: 12, allocatedBytes: 4096, allocatedFileCount: 1 };
const unavailableGrowth = { status: 'unavailable', logicalBytes: null, allocatedBytes: null, fileCount: null };
const snapshot = {
  schemaVersion: 1, scope: 'local-metadata-only', generatedAt: '2026-10-03T08:00:00Z', previousGeneratedAt: null,
  measurement: 'Filesystem metadata', totals: counts, growth: unavailableGrowth,
  coverage: { status: 'complete', registeredRoots: 1, completeRoots: 1, missingRoots: 0, partialRoots: 0, errorCount: 0, errorsTruncated: false },
  categories: [{ category: 'logs', ...counts }], modelBuckets: [{ kind: 'unknown', models: [], ...counts }],
  roots: [{ id: 'codex-sessions', source: 'codex', path: '/private-fixture/sessions', category: 'logs', status: 'complete', ...counts,
    oldestModifiedAt: null, newestModifiedAt: null, errorCount: 0, categories: [], modelBuckets: [], growth: unavailableGrowth }], errors: [],
};

test('hosted pages make no local storage, refresh, or folder requests', async () => {
  let calls = 0;
  const client = createStorageClient({ hostname: 'meow-ops.vercel.app', fetcher: async () => { calls++; assert.fail('must not fetch'); } });
  await assert.rejects(client.read(), /local dashboard only/);
  await assert.rejects(client.refresh(), /local dashboard only/);
  await assert.rejects(client.openFolder('codex-sessions'), /local dashboard only/);
  assert.equal(calls, 0);
  assert.equal(isLocalStorageSurface('[::1]'), true);
  assert.equal(isLocalStorageSurface('localhost.evil.test'), false);
});

test('remote, credentialed, and non-root helper addresses cannot receive local data', async () => {
  for (const baseUrl of ['https://127.0.0.1:7337', 'http://remote.test', 'http://user:password@127.0.0.1:7337', 'http://localhost:7337/private', 'http://localhost:7337/?token=private']) {
    const client = createStorageClient({ hostname: 'localhost', baseUrl, fetcher: async () => assert.fail('must not fetch') });
    await assert.rejects(client.read(), /loopback local helper/);
  }
});

test('verified reads use the local header, no-store, redirect rejection and cache busting', async () => {
  const client = createStorageClient({ hostname: '127.0.0.1', fetcher: async (url, init) => {
    assert.equal(url.origin, 'http://127.0.0.1:7337');
    assert.equal(url.pathname, '/storage');
    assert.ok(url.searchParams.has('t'));
    assert.equal(init.method, 'GET');
    assert.equal(init.headers['x-meow-ops-local'], '1');
    assert.equal(init.redirect, 'error');
    assert.equal(init.cache, 'no-store');
    return Response.json({ ok: true, snapshot, refreshing: false });
  } });
  assert.deepEqual(await client.read(), { snapshot, refreshing: false });
});

test('not-yet-measured and refreshing states retain unknown measurements', async () => {
  const client = createStorageClient({ hostname: 'localhost', fetcher: async () => Response.json({ ok: true, snapshot: null, refreshing: true }, { status: 202 }) });
  assert.deepEqual(await client.refresh(), { snapshot: null, refreshing: true });
});

test('folder actions send only a registered root ID and reject arbitrary paths', async () => {
  let calls = 0;
  const client = createStorageClient({ hostname: 'localhost', fetcher: async (url, init) => {
    calls++;
    assert.equal(url.pathname, '/storage/open-folder');
    assert.equal(init.method, 'POST');
    assert.deepEqual(JSON.parse(init.body), { rootId: 'codex-sessions' });
    assert.equal(init.headers['Content-Type'], 'application/json');
    return Response.json({ ok: true });
  } });
  await client.openFolder('codex-sessions');
  for (const value of ['/private/other', '../other', 'file:///private/other', '', 'root; open elsewhere']) await assert.rejects(client.openFolder(value), /registered storage/);
  assert.equal(calls, 1);
});

test('malformed values cannot silently become zero or valid measurements', async () => {
  assert.equal(isStorageSnapshot(snapshot), true);
  for (const totals of [{ ...counts, logicalBytes: '12' }, { ...counts, logicalBytes: -1 }, { ...counts, allocatedBytes: Infinity }, { ...counts, fileCount: NaN }]) {
    assert.equal(isStorageSnapshot({ ...snapshot, totals }), false);
  }
  assert.equal(isStorageSnapshot({ ...snapshot, roots: [{ ...snapshot.roots[0], status: 'healthy' }] }), false);
  assert.equal(isStorageSnapshot({ ...snapshot, generatedAt: 'not-a-date' }), false);
  const client = createStorageClient({ hostname: 'localhost', fetcher: async () => Response.json({ ok: true, snapshot: { totals: {} } }) });
  await assert.rejects(client.read(), /could not be verified/);
});

test('helper failures use safe errors and never expose server path details', async () => {
  const unavailable = createStorageClient({ hostname: 'localhost', fetcher: async () => { throw new Error('/private/secret'); } });
  await assert.rejects(unavailable.read(), error => error.message.includes('local helper') && !error.message.includes('private'));
  const rejected = createStorageClient({ hostname: 'localhost', fetcher: async () => Response.json({ ok: false, error: '/private/secret' }, { status: 403 }) });
  await assert.rejects(rejected.openFolder('codex-sessions'), error => !error.message.includes('private'));
  const oldHelper = createStorageClient({ hostname: 'localhost', fetcher: async () => Response.json({}, { status: 404 }) });
  await assert.rejects(oldHelper.read(), /does not support storage yet/);
  const failedMeasurement = createStorageClient({ hostname: 'localhost', fetcher: async () => Response.json({ ok: true, snapshot, refreshing: false, error: '/private/failed-scan' }) });
  const retained = await failedMeasurement.read();
  assert.deepEqual(retained.snapshot, snapshot);
  assert.match(retained.error, /measurement failed/);
  assert.doesNotMatch(retained.error, /private/);
});

test('abort is forwarded and file sizes preserve unknown, zero and signed growth', async () => {
  const controller = new AbortController();
  controller.abort();
  const client = createStorageClient({ hostname: 'localhost', fetcher: async (_url, init) => { assert.equal(init.signal.aborted, true); throw new Error('aborted'); } });
  await assert.rejects(client.read(controller.signal), /cancelled/);
  assert.equal(formatStorageBytes(null), 'Unavailable');
  assert.equal(formatStorageBytes(0), '0 B');
  assert.equal(formatStorageBytes(1024), '1 KiB');
  assert.equal(formatStorageBytes(-1024), '-1 KiB');
});
