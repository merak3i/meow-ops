import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStorageService } from '../storage-service.mjs';

test('one measurement at a time persists a baseline; failure retains last good measurement', async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'meow-storage-service-')));
  let release;
  let calls = 0;
  let fail = false;
  const fixture = { schemaVersion: 1, scope: 'local-metadata-only', generatedAt: '2026-10-03T10:00:00Z', roots: [] };
  const service = createStorageService({ home, env: {}, scan: async ({ previous }) => {
    calls++;
    if (fail) { assert.deepEqual(previous, fixture); throw new Error('private path'); }
    await new Promise(resolve => { release = resolve; });
    return fixture;
  } });
  try {
    assert.equal(service.status().snapshot, null);
    const pending = service.refresh();
    assert.equal(service.refresh(), pending);
    assert.equal(service.status().refreshing, true);
    release();
    await pending;
    assert.equal(calls, 1);
    assert.deepEqual(createStorageService({ home, env: {} }).status().snapshot, fixture);
    fail = true;
    await service.refresh();
    assert.deepEqual(service.status().snapshot, fixture);
    assert.match(service.status().error, /last saved/);
    assert.doesNotMatch(service.status().error, /private path/);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('folder actions accept only measured root IDs, never browser paths or symlinks', async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'meow-storage-open-')));
  const path = join(home, '.codex', 'sessions');
  mkdirSync(path, { recursive: true });
  const opened = [];
  const service = createStorageService({ home, env: {}, scan: async () => ({
    schemaVersion: 1, scope: 'local-metadata-only', roots: [{ id: 'codex-sessions', path, status: 'complete' }],
  }), open: (command, args, options, done) => { opened.push({ command, args }); done(); } });
  try {
    await assert.rejects(service.openFolder('codex-sessions'), /Measure/);
    await service.refresh();
    for (const id of ['/etc', '../../etc', 'file:///etc', 'https://example.invalid']) await assert.rejects(service.openFolder(id), /Unknown/);
    await service.openFolder('codex-sessions');
    assert.deepEqual(opened, [{ command: '/usr/bin/open', args: [path] }]);
    rmSync(path, { recursive: true });
    symlinkSync(home, path);
    await assert.rejects(service.openFolder('codex-sessions'), /not a regular/);
    assert.equal(opened.length, 1);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
