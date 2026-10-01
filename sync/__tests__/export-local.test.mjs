import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('local export keeps data outside the checkout and explicitly skips Cursor collection', () => {
  const root = mkdtempSync(join(tmpdir(), 'meow-export-'));
  const home = join(root, 'home');
  const data = join(root, 'data');
  const claude = join(home, '.claude', 'projects', 'example');
  mkdirSync(claude, { recursive: true });
  writeFileSync(join(claude, 'session.jsonl'), JSON.stringify({
    sessionId: 'fixture', type: 'user', timestamp: '2026-09-30T00:00:00.000Z',
    message: { content: 'Private fixture question' },
  }) + '\n');
  try {
    execFileSync(process.execPath, ['sync/export-local.mjs'], {
      cwd: new URL('../..', import.meta.url), stdio: 'pipe', timeout: 10_000,
      env: {
        ...process.env, HOME: home, MEOW_DATA_DIR: data, MEOW_SKIP_CURSOR: '1',
        MEOW_SESSION_HISTORY_DIR: join(root, 'history'), MEOW_EVIDENCE_DIR: join(root, 'evidence'),
        MEOW_PROJECT_CONTROL_DIR: join(root, 'control'), MEOW_NO_SNIPPETS: '1',
        HERMES_STATE_DB: join(root, 'absent.db'), ANTIGRAVITY_DIR: join(root, 'absent'),
        AIDER_PROJECTS: '', CURSOR_ADMIN_API_KEY: '',
        CURSOR_PROJECTS_DIR: new URL('../__fixtures__/cursor/projects', import.meta.url).pathname,
      },
    });
    const sessions = JSON.parse(readFileSync(join(data, 'sessions.json')));
    const summary = JSON.parse(readFileSync(join(data, 'cost-summary.json')));
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].source, 'claude');
    assert.equal(summary.sourceHealth.claude.state, 'collected');
    assert.equal(summary.sourceHealth.cursor.state, 'excluded');
    assert.equal(summary.sourceHealth.aider.state, 'not-configured');
    assert.equal(summary.cursorUsage.status, 'skipped');
    assert.doesNotMatch(JSON.stringify(summary.sourceHealth), /Private fixture|\/home\//);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
