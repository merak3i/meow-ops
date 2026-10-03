import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireProcessLock } from '../process-lock.mjs';

test('live locks resist stale timestamps; only the owning token releases', () => {
  const dir = mkdtempSync(join(tmpdir(), 'meow-lock-'));
  const path = join(dir, 'sync.lock');
  try {
    const owner = acquireProcessLock(path);
    assert.equal(acquireProcessLock(path), null);
    const child = acquireProcessLock(path, { inheritedToken: owner.token });
    assert.equal(child.inherited, true);
    child.release();
    assert.equal(acquireProcessLock(path), null);
    owner.release();
    const legacy = join(dir, 'legacy.lock');
    writeFileSync(legacy, JSON.stringify({ pid: process.pid, token: 'active', createdAt: '2000-01-01' }));
    assert.equal(acquireProcessLock(legacy), null);
    const replacement = acquireProcessLock(path);
    owner.release(); // Cannot delete a replacement owner.
    assert.equal(acquireProcessLock(path), null);
    replacement.release();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

function childClaim(path, inheritedToken) {
  const script = `const { acquireProcessLock } = await import(${JSON.stringify(new URL('../process-lock.mjs', import.meta.url).href)});
    const lock = acquireProcessLock(${JSON.stringify(path)}, ${JSON.stringify({ inheritedToken })});
    process.send({ acquired: Boolean(lock), inherited: lock?.inherited });
    if (!lock) process.exit(0);
    setInterval(() => {}, 1000);`;
  return spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
}

test('an inherited child keeps ownership after its parent releases, and process death frees it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'meow-lock-child-'));
  const path = join(dir, 'sync.lock');
  const owner = acquireProcessLock(path);
  const child = childClaim(path, owner.token);
  try {
    const [message] = await once(child, 'message');
    assert.equal(message.inherited, true);
    owner.release();
    assert.equal(acquireProcessLock(path), null);
    const closed = once(child, 'close');
    child.kill('SIGKILL');
    await closed;
    const recovered = acquireProcessLock(path);
    assert.ok(recovered);
    recovered.release();
  } finally {
    child.kill('SIGKILL'); owner.release(); rmSync(dir, { recursive: true, force: true });
  }
});

test('legacy dead file locks require explicit migration and are never blindly removed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'meow-lock-legacy-'));
  const path = join(dir, 'sync.lock');
  try {
    writeFileSync(path, JSON.stringify({ pid: 2147483647, token: 'dead' }));
    writeFileSync(`${path}.recovery`, '');
    assert.throws(() => acquireProcessLock(path), error => error.code === 'legacy_lock_migration_required');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('prior collector decimal-PID locks are recognized and require explicit migration', () => {
  const dir = mkdtempSync(join(tmpdir(), 'meow-lock-legacy-pid-'));
  const path = join(dir, 'sync.lock');
  try {
    writeFileSync(path, '2147483647\n');
    assert.throws(() => acquireProcessLock(path), error => error.code === 'legacy_lock_migration_required');
    assert.equal(readFileSync(path, 'utf8'), '2147483647\n');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
