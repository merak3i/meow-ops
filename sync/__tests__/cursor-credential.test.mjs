import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCursorAdminApiKey, CURSOR_ADMIN_KEYCHAIN_SERVICE, CURSOR_ADMIN_KEYCHAIN_ACCOUNT } from '../cursor-credential.mjs';
import { loadEnv } from '../load-env.mjs';

test('credential lookup reads a bounded Keychain item without putting its value in process arguments', () => {
  const credential = 'fixture-only-value';
  const result = readCursorAdminApiKey({ env: {}, run(file, args, options) {
    assert.equal(file, '/usr/bin/security');
    assert.deepEqual(args, ['find-generic-password', '-s', CURSOR_ADMIN_KEYCHAIN_SERVICE, '-a', CURSOR_ADMIN_KEYCHAIN_ACCOUNT, '-w']);
    assert.equal(args.includes(credential), false);
    assert.deepEqual(options.stdio, ['ignore', 'pipe', 'ignore']);
    assert.ok(options.timeout <= 2000);
    assert.ok(options.maxBuffer <= 4096);
    return `${credential}\n`;
  } });
  assert.equal(result, credential);
});

test('explicit process injection wins and an empty value disables Keychain for offline runs', () => {
  const run = () => { throw new Error('Keychain must not run'); };
  assert.equal(readCursorAdminApiKey({ env: { CURSOR_ADMIN_API_KEY: ' process-fixture ' }, run }), 'process-fixture');
  assert.equal(readCursorAdminApiKey({ env: { CURSOR_ADMIN_API_KEY: '' }, run }), null);
  assert.equal(readCursorAdminApiKey({ env: {}, run: () => { throw new Error('locked or missing'); } }), null);
});

test('owner and checkout config files cannot load a Cursor credential into the helper environment', () => {
  const root = mkdtempSync(join(tmpdir(), 'meow-cursor-secret-'));
  try {
    const configFile = join(root, 'owner.env');
    writeFileSync(configFile, 'CURSOR_ADMIN_API_KEY=owner-file-fixture\nMEOW_SKIP_CURSOR=0\n');
    writeFileSync(join(root, '.env'), 'CURSOR_ADMIN_API_KEY=checkout-file-fixture\n');
    const env = {};
    loadEnv(root, { env, configFile });
    assert.deepEqual(env, { MEOW_SKIP_CURSOR: '0' });
    const injected = { CURSOR_ADMIN_API_KEY: 'process-fixture' };
    loadEnv(root, { env: injected, configFile });
    assert.equal(injected.CURSOR_ADMIN_API_KEY, 'process-fixture');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
