import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = 7449;

async function waitForServer(deadlineMs = 10_000) {
  const until = Date.now() + deadlineMs;
  while (Date.now() < until) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/sync/status`, { headers: { host: `127.0.0.1:${PORT}` } });
      if (res.status < 500) return;
    } catch {
      // not up yet
    }
    await sleep(100);
  }
  throw new Error('local api did not start');
}

// SHIP-GATE check 13: launchd stops the agent with SIGTERM. The server must exit 0 on its own,
// quickly, instead of being SIGKILLed with requests in flight.
test('local api drains and exits 0 on SIGTERM', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'meow-shutdown-'));
  const server = spawn(process.execPath, [join(ROOT, 'sync', 'local-api.mjs')], {
    cwd: ROOT,
    env: {
      ...process.env,
      MEOW_LOCAL_API_PORT: String(PORT),
      MEOW_LOOP_DIR: join(scratch, 'loop'),
      MEOW_SESSIONS_FILE: join(scratch, 'sessions.json'),
      MEOW_PROJECT_INTELLIGENCE_DIR: join(scratch, 'pi'),
      MEOW_COMPANION_SOUL_DIR: join(scratch, 'soul'),
      MEOW_COMPANION_PREFERENCE_DIR: join(scratch, 'pref'),
      MEOW_SESSION_HISTORY_DIR: join(scratch, 'history'),
      MEOW_SHUTDOWN_GRACE_MS: '3000',
    },
    stdio: 'pipe',
  });
  let stdout = '';
  server.stdout.on('data', (chunk) => { stdout += chunk; });
  server.stderr.on('data', (chunk) => { stdout += chunk; });
  const exited = new Promise((resolve) => server.on('exit', (code, signal) => resolve({ code, signal })));

  try {
    await waitForServer();
    const sentAt = Date.now();
    server.kill('SIGTERM');
    const result = await Promise.race([exited, sleep(6_000).then(() => ({ code: null, signal: 'timeout' }))]);
    const elapsed = Date.now() - sentAt;
    assert.deepEqual(result, { code: 0, signal: null }, `expected clean exit, got ${JSON.stringify(result)}\n${stdout.slice(-800)}`);
    assert.ok(elapsed < 5_000, `shutdown took ${elapsed}ms`);
    assert.match(stdout, /SIGTERM: draining in-flight requests/);
  } finally {
    if (server.exitCode === null) server.kill('SIGKILL');
    rmSync(scratch, { recursive: true, force: true });
  }
});
