import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm, link, symlink, lstat, opendir, truncate } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyStorageFile, detectUnresolvedStorageLocations, registeredStorageRoots, scanStorageInventory } from '../storage-inventory.mjs';

const at = '2026-10-03T08:00:00.000Z';
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'meow-storage-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
const root = (path, extra = {}) => ({ id: 'fixture', source: 'codex', path, category: 'logs', ...extra });

test('known roots honor explicit overrides without scanning home or project trees', () => {
  const roots = registeredStorageRoots({ home: '/fixture-home', env: {
    MEOW_SESSION_HISTORY_DIR: '/private-history', MEOW_DATA_DIR: '/local-exports',
    HERMES_STATE_DB: '/hermes/state.db', AIDER_PROJECTS: '/repo-one:/repo-two',
  } });
  assert.equal(roots.find(item => item.id === 'meow-history').path, '/private-history');
  assert.equal(roots.find(item => item.id === 'meow-exports').path, '/local-exports');
  assert.deepEqual(roots.filter(item => item.id.startsWith('hermes-database')).map(item => item.path), ['/hermes/state.db', '/hermes/state.db-wal', '/hermes/state.db-shm']);
  assert.ok(roots.every(item => !['/fixture-home', '/repo-one', '/repo-two'].includes(item.path)));
  assert.equal(roots.find(item => item.id === 'codex-databases').recursive, false);
});

test('storage categories distinguish operational files and generated copies', () => {
  for (const [file, fallback, expected] of [
    ['rollout.jsonl', 'logs', 'logs'], ['debug/run.log', 'logs', 'diagnostics'],
    ['state.db-wal', 'logs', 'database'], ['state.sqlite3-shm', 'logs', 'database'],
    ['state.vscdb', 'other', 'database'], ['current.json', 'derived', 'derived'],
    ['events.jsonl', 'derived', 'derived'], ['exports/events.jsonl', 'logs', 'exports'],
    ['backups/state.db', 'logs', 'backups'], ['cache/item.json', 'logs', 'cache'],
    ['model.gguf', 'other', 'weights'], ['config.json', 'other', 'other'],
    ['brain/session/.system_generated/logs/transcript.jsonl', 'other', 'logs'],
    ['brain/session/task.md', 'other', 'derived'], ['conversations/one.pb', 'other', 'database'],
  ]) assert.equal(classifyStorageFile(file, fallback), expected, file);
});

test('measures actual logical and allocated bytes using metadata only', async t => {
  const dir = await fixture(t);
  const file = join(dir, 'session.jsonl');
  await writeFile(file, 'a private transcript that must never be read');
  const stat = await lstat(file);
  const report = await scanStorageInventory({ roots: [root(dir)], now: at });
  assert.equal(report.scope, 'local-metadata-only');
  assert.equal(report.coverage.status, 'complete');
  assert.equal(report.totals.logicalBytes, stat.size);
  assert.equal(report.totals.allocatedBytes, stat.blocks * 512);
  assert.equal(report.totals.fileCount, 1);
  assert.equal(report.roots[0].newestModifiedAt, stat.mtime.toISOString());
  assert.equal(report.roots[0].oldestModifiedAt, stat.mtime.toISOString());
  assert.doesNotMatch(JSON.stringify(report), /private transcript|session\.jsonl/);
  assert.equal(report.growth.status, 'unavailable');
});

test('sparse-file logical bytes and allocated blocks remain distinct', async t => {
  const dir = await fixture(t);
  const file = join(dir, 'sparse.jsonl');
  await writeFile(file, '');
  await truncate(file, 1024 * 1024);
  const stats = await lstat(file);
  const report = await scanStorageInventory({ roots: [root(file)], now: at });
  assert.equal(report.totals.logicalBytes, 1024 * 1024);
  assert.equal(report.totals.allocatedBytes, stats.blocks * 512);
});

test('missing roots are explicitly unavailable rather than empty successful scans', async t => {
  const dir = await fixture(t);
  const report = await scanStorageInventory({ roots: [root(join(dir, 'missing'))], now: at });
  assert.equal(report.roots[0].status, 'missing');
  assert.equal(report.coverage.status, 'partial');
  assert.equal(report.coverage.missingRoots, 1);
  assert.equal(report.roots[0].growth.status, 'unavailable');
});

test('nested roots and hardlinks count once, with most-specific root ownership', async t => {
  const dir = await fixture(t);
  const nested = join(dir, 'backups');
  await mkdir(nested);
  await writeFile(join(nested, 'copy.jsonl'), 'abc');
  await link(join(nested, 'copy.jsonl'), join(dir, 'linked.jsonl'));
  await writeFile(join(dir, 'independent.jsonl'), 'hello');
  const report = await scanStorageInventory({ roots: [root(dir), root(nested, { id: 'backup', category: 'backups' })], now: at });
  assert.equal(report.totals.fileCount, 2);
  assert.equal(report.totals.logicalBytes, 8);
  const parent = report.roots.find(item => item.id === 'fixture');
  assert.equal(parent.skipped.overlappingRoots, 1);
  assert.equal(parent.skipped.hardlinks, 1);
  assert.equal(report.roots.find(item => item.id === 'backup').logicalBytes, 3);
  assert.equal(report.categories.find(item => item.category === 'backups').logicalBytes, 3);
});

test('equal roots are deduplicated deterministically regardless of input order', async t => {
  const dir = await fixture(t);
  await writeFile(join(dir, 'one.jsonl'), 'a');
  const roots = [root(dir, { id: 'second' }), root(dir, { id: 'first' })];
  const a = await scanStorageInventory({ roots, now: at });
  const b = await scanStorageInventory({ roots: roots.toReversed(), now: at });
  assert.equal(a.totals.fileCount, 1);
  assert.equal(a.scopeKey, b.scopeKey);
  assert.equal(a.roots.find(item => item.id === 'first').fileCount, 1);
});

test('does not follow file, directory, root, or looping symlinks', async t => {
  const dir = await fixture(t);
  const data = join(dir, 'data');
  await mkdir(data);
  await writeFile(join(dir, 'outside.jsonl'), 'outside');
  await writeFile(join(data, 'inside.jsonl'), 'in');
  await symlink(join(dir, 'outside.jsonl'), join(data, 'file-link'));
  await symlink(data, join(data, 'loop'));
  await symlink(dir, join(data, 'outside-dir'));
  await symlink(data, join(dir, 'root-link'));
  const report = await scanStorageInventory({ roots: [root(data), root(join(dir, 'root-link'), { id: 'linked-root' })], now: at });
  assert.equal(report.totals.fileCount, 1);
  assert.equal(report.totals.logicalBytes, 2);
  assert.equal(report.roots.find(item => item.id === 'fixture').skipped.symlinks, 3);
  assert.equal(report.roots.find(item => item.id === 'linked-root').status, 'partial');
  assert.ok(report.errors.some(error => error.code === 'SYMLINK_ROOT'));
});

test('non-recursive roots only measure selected top-level database files', async t => {
  const dir = await fixture(t);
  await mkdir(join(dir, 'sessions'));
  await writeFile(join(dir, 'sessions', 'rollout.jsonl'), 'not counted');
  await writeFile(join(dir, 'auth.json'), 'not counted');
  await writeFile(join(dir, 'state.sqlite'), 'db');
  await writeFile(join(dir, 'state.sqlite-wal'), 'wal');
  const report = await scanStorageInventory({ roots: [root(dir, { category: 'database', recursive: false, filePattern: '\\.sqlite(?:-wal|-shm)?$' })], now: at });
  assert.equal(report.totals.fileCount, 2);
  assert.equal(report.totals.logicalBytes, 5);
  assert.equal(report.roots[0].skipped.excluded, 2);
});

test('permission failures preserve observed bytes and report partial coverage without error text', async t => {
  const dir = await fixture(t);
  await writeFile(join(dir, 'visible.jsonl'), 'good');
  const locked = join(dir, 'locked');
  await mkdir(locked);
  const fs = { lstat, opendir: async path => {
    if (path === locked) throw Object.assign(new Error('private path and content'), { code: 'EACCES' });
    return opendir(path);
  } };
  const report = await scanStorageInventory({ roots: [root(dir)], fs, now: at });
  assert.equal(report.totals.logicalBytes, 4);
  assert.equal(report.coverage.status, 'partial');
  assert.equal(report.errors[0].code, 'EACCES');
  assert.doesNotMatch(JSON.stringify(report), /private path and content/);
});

test('files changing during metadata collection are excluded and mark the scan partial', async t => {
  const dir = await fixture(t);
  const file = join(dir, 'changing.jsonl');
  await writeFile(file, 'a');
  let reads = 0;
  const fs = { opendir, lstat: async path => {
    if (path === file && ++reads === 2) await writeFile(file, 'changed size');
    return lstat(path);
  } };
  const report = await scanStorageInventory({ roots: [root(dir)], fs, now: at });
  assert.equal(report.totals.fileCount, 0);
  assert.equal(report.coverage.status, 'partial');
  assert.equal(report.errors[0].code, 'FILE_CHANGED');
});

test('entry, depth, and time bounds explicitly report incomplete scans', async t => {
  const dir = await fixture(t);
  await mkdir(join(dir, 'deep', 'deeper'), { recursive: true });
  await writeFile(join(dir, 'deep', 'deeper', 'one.jsonl'), 'a');
  const entries = await scanStorageInventory({ roots: [root(dir)], limits: { maxEntries: 1 }, now: at });
  assert.equal(entries.coverage.status, 'partial');
  assert.ok(entries.errors.some(error => error.code === 'ENTRY_LIMIT'));
  const depth = await scanStorageInventory({ roots: [root(dir)], limits: { maxDepth: 1 }, now: at });
  assert.equal(depth.coverage.status, 'partial');
  assert.ok(depth.errors.some(error => error.code === 'DEPTH_LIMIT'));
  let tick = 0;
  const time = await scanStorageInventory({ roots: [root(dir)], limits: { maxDurationMs: 1 }, monotonicNow: () => tick++, now: at });
  assert.equal(time.coverage.status, 'partial');
  assert.ok(time.errors.some(error => error.code === 'TIME_LIMIT'));
});

test('growth compares only matching complete scans and detects file growth and removal', async t => {
  const dir = await fixture(t);
  const file = join(dir, 'one.jsonl');
  await writeFile(file, 'abc');
  const roots = [root(dir)];
  const first = await scanStorageInventory({ roots, now: at });
  await writeFile(file, 'abcde');
  const second = await scanStorageInventory({ roots, previous: first, now: '2026-10-03T09:00:00Z' });
  assert.equal(second.growth.logicalBytes, 2);
  assert.equal(second.growth.fileCount, 0);
  assert.equal(second.roots[0].growth.logicalBytes, 2);
  assert.equal(second.previousGeneratedAt, at);
  await rm(file);
  const third = await scanStorageInventory({ roots, previous: second, now: '2026-10-03T10:00:00Z' });
  assert.equal(third.growth.logicalBytes, -5);
  assert.equal(third.growth.fileCount, -1);
  const incompatible = await scanStorageInventory({ roots: [root(dir, { source: 'other' })], previous: first, now: '2026-10-03T11:00:00Z' });
  assert.equal(incompatible.growth.status, 'unavailable');
  await writeFile(file, 'present again');
  const partial = await scanStorageInventory({ roots, previous: first, limits: { maxEntries: 1 }, now: '2026-10-03T12:00:00Z' });
  assert.equal(partial.coverage.status, 'partial');
  assert.equal(partial.growth.status, 'unavailable');
  assert.equal(partial.roots[0].growth.status, 'unavailable');
});

test('directory changes during a scan prevent a complete snapshot claim', async t => {
  const dir = await fixture(t);
  await writeFile(join(dir, 'one.jsonl'), 'one');
  let calls = 0;
  const fs = { opendir, lstat: async path => {
    const stat = await lstat(path);
    if (path === dir && ++calls === 2) stat.mtimeMs += 1;
    return stat;
  } };
  const report = await scanStorageInventory({ roots: [root(dir)], fs, now: at });
  assert.equal(report.totals.fileCount, 1);
  assert.equal(report.coverage.status, 'partial');
  assert.ok(report.errors.some(error => error.code === 'DIRECTORY_CHANGED'));
});

test('error details are bounded while all failed paths remain counted', async t => {
  const dir = await fixture(t);
  for (const name of ['one', 'two', 'three']) await mkdir(join(dir, name));
  const fs = { lstat, opendir: async path => {
    if (path !== dir) throw Object.assign(new Error('blocked'), { code: 'EPERM' });
    return opendir(path);
  } };
  const report = await scanStorageInventory({ roots: [root(dir)], fs, limits: { maxErrors: 1 }, now: at });
  assert.equal(report.errors.length, 1);
  assert.equal(report.coverage.errorCount, 3);
  assert.equal(report.coverage.errorsTruncated, true);
});

test('missing allocated blocks remain unavailable and never substitute logical bytes', async t => {
  const dir = await fixture(t);
  await writeFile(join(dir, 'one.jsonl'), 'abc');
  const fs = { opendir, lstat: async path => {
    const stat = await lstat(path);
    if (stat.isFile()) stat.blocks = undefined;
    return stat;
  } };
  const report = await scanStorageInventory({ roots: [root(dir)], fs, now: at });
  assert.equal(report.totals.logicalBytes, 3);
  assert.equal(report.totals.allocatedBytes, null);
  assert.equal(report.totals.allocatedFileCount, 0);
});

test('model bytes require confirmed metadata and mixed files are never split by tokens', async t => {
  const dir = await fixture(t);
  for (const [name, content] of [['named-qwen.jsonl', 'one'], ['single.jsonl', 'four'], ['mixed.jsonl', 'seven77']]) await writeFile(join(dir, name), content);
  const report = await scanStorageInventory({ roots: [root(dir)], now: at, modelAttributionForFile: path => {
    if (path.endsWith('/single.jsonl')) return { confirmed: true, models: ['model-a'] };
    if (path.endsWith('/mixed.jsonl')) return { confirmed: true, models: ['model-b', 'model-a'], tokens: { 'model-a': 100, 'model-b': 1 } };
    return { confirmed: false, models: ['qwen'] };
  } });
  assert.equal(report.modelBuckets.find(item => item.kind === 'unknown').logicalBytes, 3);
  assert.equal(report.modelBuckets.find(item => item.kind === 'single').logicalBytes, 4);
  assert.equal(report.modelBuckets.find(item => item.kind === 'mixed').logicalBytes, 7);
  assert.deepEqual(report.modelBuckets.find(item => item.kind === 'mixed').models, ['model-a', 'model-b']);
  assert.equal(report.modelBuckets.reduce((sum, item) => sum + item.logicalBytes, 0), report.totals.logicalBytes);
});

test('invalid configuration fails before filesystem traversal', async () => {
  const fs = { lstat: () => assert.fail('must not scan'), opendir: () => assert.fail('must not scan') };
  await assert.rejects(scanStorageInventory({ roots: [root('relative')], fs }), /absolute paths/);
  await assert.rejects(scanStorageInventory({ roots: [root('/one'), root('/two')], fs }), /unique IDs/);
});

test('detected tools with unresolved storage locations report incomplete coverage without fake paths', async () => {
  const report = await scanStorageInventory({ roots: [], now: at, unresolvedLocations: [
    { source: 'fixture-tool', detected: true, reason: 'Installed tool, storage location not verified.', path: '/invented/path' },
    { source: 'not-detected', detected: false },
  ] });
  assert.equal(report.coverage.status, 'partial');
  assert.equal(report.unresolvedLocations.length, 1);
  assert.equal(report.unresolvedLocations[0].source, 'fixture-tool');
  assert.doesNotMatch(JSON.stringify(report), /invented\/path|not-detected/);
});

test('unresolved-tool detection only stats explicit installation evidence', async t => {
  const dir = await fixture(t);
  await mkdir(join(dir, '.copilot'));
  const locations = await detectUnresolvedStorageLocations({ home: dir });
  assert.deepEqual(locations.map(item => item.source), ['copilot']);
  assert.equal(locations[0].detected, true);
  assert.doesNotMatch(JSON.stringify(locations), /\.copilot|meow-storage-/);
});
