import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('rate-limit refresh is non-interactive, clamps values, and never pushes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'meow-limits-'));
  const out = join(dir, 'rate-limits.json');
  try {
    const result = spawnSync(process.execPath, [join(ROOT, 'sync', 'fetch-claude-limits.mjs'), '--push'], {
      cwd: ROOT,
      timeout: 3_000,
      encoding: 'utf8',
      env: {
        ...process.env,
        MEOW_RATE_LIMITS_OUT: out,
        CLAUDE_SESSION_PCT: '140',
        CLAUDE_WEEKLY_ALL_PCT: '-8',
      },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.signal, null);
    assert.match(result.stdout, /--push is retired/);
    const snapshot = JSON.parse(readFileSync(out, 'utf8'));
    assert.equal(snapshot.claude.session.used_pct, 100);
    assert.equal(snapshot.claude.weekly.all_models_used_pct, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
