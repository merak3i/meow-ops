import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

test('Cursor request HTTP report is local-only, read-only, memory-cached and content-free', async () => {
  const root = mkdtempSync(join(tmpdir(), 'meow-cursor-http-'));
  const projects = join(root, 'projects');
  const transcripts = join(projects, 'demo', 'agent-transcripts');
  mkdirSync(transcripts, { recursive: true });
  writeFileSync(join(transcripts, 'session-a.jsonl'), '{}\n');
  const db = join(root, 'state.vscdb');
  const quote = value => `'${JSON.stringify(value).replaceAll("'", "''")}'`;
  const composer = { fullConversationHeadersOnly: [{ bubbleId: 'first', type: 1, createdAt: '2026-09-13T01:00:00Z' }, { bubbleId: 'second', type: 1, createdAt: '2026-09-13T01:01:00Z' }], text: 'PRIVATE_FIXTURE_DO_NOT_EXPORT', modelConfig: { modelName: 'wrong-current-selection' } };
  execFileSync('sqlite3', [db, `CREATE TABLE cursorDiskKV(key TEXT UNIQUE, value BLOB);
    INSERT INTO cursorDiskKV VALUES ('composerData:session-a',${quote(composer)});
    INSERT INTO cursorDiskKV VALUES ('bubbleId:session-a:first',${quote({ type: 1, modelInfo: { modelName: 'grok-4.6' }, tokenCount: { inputTokens: 0, outputTokens: 0 }, text: 'PRIVATE_FIXTURE_DO_NOT_EXPORT' })});
    INSERT INTO cursorDiskKV VALUES ('bubbleId:session-a:second',${quote({ type: 1, modelInfo: { modelName: 'composer-2.5' } })});`]);
  const before = readFileSync(db);
  const probe = createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const env = { ...process.env, MEOW_LOCAL_API_PORT: String(port), CURSOR_STATE_DB: db, CURSOR_PROJECTS_DIR: projects, DEEPSEEK_API_KEY: '', CURSOR_ADMIN_API_KEY: '', MEOW_LLM_CALLS_PER_CYCLE: '0' };
  for (const key of ['MEOW_SESSION_HISTORY_DIR', 'MEOW_LOOP_DIR', 'MEOW_EVIDENCE_DIR', 'MEOW_PROJECT_CONTROL_DIR', 'MEOW_RUNTIME_DIR', 'MEOW_COMPANION_SOUL_DIR', 'MEOW_COMPANION_PREFERENCE_DIR', 'MEOW_LEARNING_QUEST_DIR']) env[key] = join(root, key);
  const child = spawn(process.execPath, ['sync/local-api.mjs'], { cwd: join(import.meta.dirname, '../..'), env, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  const headers = { Origin: base, 'x-meow-ops-local': '1' };
  try {
    let ready = false;
    for (let i = 0; i < 50; i++) {
      try { await fetch(`${base}/sync/status`, { headers }); ready = true; break; } catch { await sleep(100); }
    }
    assert.ok(ready);
    const url = `${base}/loop-eng/cursor-request-usage`;
    assert.equal((await fetch(url, { headers: { ...headers, Origin: 'https://meow-ops.vercel.app' } })).status, 403);
    assert.equal((await fetch(url, { headers: { Origin: base } })).status, 400);
    const response = await fetch(url, { headers });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const payload = await response.text();
    const result = JSON.parse(payload);
    assert.equal(result.report.requests_with_model, 2);
    assert.deepEqual(result.report.by_model.map(row => row.model).sort(), ['composer-2.5', 'grok-4.6']);
    assert.ok(!payload.includes('PRIVATE_FIXTURE') && !payload.includes('wrong-current-selection') && !payload.includes('session-a'));
    const cached = await (await fetch(url, { headers })).json();
    assert.equal(cached.report.checked_at, result.report.checked_at);
    assert.deepEqual(readFileSync(db), before);
  } finally {
    const stopped = new Promise(resolve => child.once('exit', resolve));
    child.kill('SIGTERM');
    await stopped;
    rmSync(root, { recursive: true, force: true });
  }
});
