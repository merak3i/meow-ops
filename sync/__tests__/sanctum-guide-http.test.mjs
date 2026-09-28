import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { updateSessionHistory } from '../session-history.mjs';
import { appendAgentEvents } from '../project-evidence.mjs';

test('guide HTTP boundary stays local, scoped, read-only and provider-free', async () => {
  const root = mkdtempSync(join(tmpdir(), 'meow-guide-http-'));
  const history = join(root, 'session-history');
  const session = { session_id: 'fixture-session', project: 'fixture-project', source: 'codex', total_tokens: 100, estimated_cost_usd: 0, pricing_source: 'fixture', usage_available: true };
  updateSessionHistory([session], { dir: history });
  const before = readFileSync(join(history, 'sessions.jsonl'), 'utf8');
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const env = { ...process.env, MEOW_LOCAL_API_PORT: String(port), MEOW_SESSION_HISTORY_DIR: history, MEOW_LLM_CALLS_PER_CYCLE: '0', MEOW_GUIDE_VOICEBOX_PROFILE: '', DEEPSEEK_API_KEY: '', CURSOR_ADMIN_API_KEY: '' };
  for (const key of ['MEOW_LOOP_DIR', 'MEOW_EVIDENCE_DIR', 'MEOW_PROJECT_CONTROL_DIR', 'MEOW_RUNTIME_DIR', 'MEOW_COMPANION_SOUL_DIR', 'MEOW_COMPANION_PREFERENCE_DIR', 'MEOW_LEARNING_QUEST_DIR']) env[key] = join(root, key);
  appendAgentEvents([{ source: session.source, session_id: session.session_id, project_id: 'fixture', metadata: { project: session.project }, timestamp: new Date().toISOString(), event_type: 'tool_result', content: 'Fixture event; password=not-a-real-credential', raw_ref: '/private/fixture-only' }], { dir: env.MEOW_EVIDENCE_DIR });
  const child = spawn(process.execPath, ['sync/local-api.mjs'], { cwd: join(import.meta.dirname, '../..'), env, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  const headers = { Origin: base, 'Content-Type': 'application/json', 'x-meow-ops-local': '1' };
  try {
    let ready = false;
    for (let i = 0; i < 40; i++) {
      try { await fetch(`${base}/sync/status`, { headers }); ready = true; break; } catch { await sleep(100); }
    }
    assert.ok(ready, 'isolated helper started');
    const eternalResponse = await fetch(`${base}/loop-eng/eternal-stats`, { headers });
    assert.equal(eternalResponse.status, 200);
    assert.equal(eternalResponse.headers.get('cache-control'), 'no-store');
    const eternal = await eternalResponse.json();
    assert.equal(eternal.stats.totalSessions, 1);
    assert.equal(eternal.stats.totalTokens, 100);
    assert.equal(eternal.stats.scope, 'archive');
    assert.equal(JSON.stringify(eternal).includes('fixture-session'), false);
    for (const origin of ['http://127.0.0.1:4275', 'http://localhost:4275', 'http://127.0.0.1:5176', 'http://localhost:5176']) {
      const previewResponse = await fetch(`${base}/loop-eng/eternal-stats`, { headers: { ...headers, Origin: origin } });
      assert.equal(previewResponse.status, 200, `${origin} should access the explicitly allowed local preview`);
      assert.equal(previewResponse.headers.get('access-control-allow-origin'), origin);
    }
    const previewPreflight = await fetch(`${base}/loop-eng/guide-voice`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://127.0.0.1:4275',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'x-meow-ops-local',
      },
    });
    assert.equal(previewPreflight.status, 204);
    assert.equal(previewPreflight.headers.get('access-control-allow-origin'), 'http://127.0.0.1:4275');
    assert.match(previewPreflight.headers.get('access-control-allow-headers') || '', /x-meow-ops-local/i);
    assert.equal((await fetch(`${base}/loop-eng/eternal-stats`, { headers: { Origin: base } })).status, 400);
    assert.equal((await fetch(`${base}/loop-eng/eternal-stats`, { headers: { ...headers, Origin: 'https://meow-ops.vercel.app' } })).status, 403);
    const voiceStatus = await fetch(`${base}/loop-eng/guide-voice`, { headers });
    assert.equal(voiceStatus.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await voiceStatus.json(), { available: false, status: 'not-configured' });
    assert.equal((await fetch(`${base}/loop-eng/guide-voice`, { headers: { Origin: base } })).status, 400);
    assert.equal((await fetch(`${base}/loop-eng/guide-voice`, { headers: { ...headers, Origin: 'https://meow-ops.vercel.app' } })).status, 403);
    const invalidVoice = await fetch(`${base}/loop-eng/guide-voice`, { method: 'POST', headers, body: JSON.stringify({ text: 'x'.repeat(1501) }) });
    assert.equal(invalidVoice.status, 400);
    const post = (body, requestHeaders = headers) => fetch(`${base}/loop-eng/sanctum-guide`, { method: 'POST', headers: requestHeaders, body: JSON.stringify(body) });
    const body = { question: 'session cost', session_id: session.session_id, project: session.project };
    const response = await post(body);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.evidence[0].record_id, session.session_id);
    assert.equal(result.source, 'local-deterministic');
    const events = await post({ ...body, question: 'Read session logs' });
    assert.equal(events.headers.get('cache-control'), 'no-store');
    const eventAnswer = await events.json();
    assert.equal(eventAnswer.kind, 'observed-events');
    assert.equal(eventAnswer.evidence.length, 1);
    assert.match(eventAnswer.evidence[0].fields.excerpt, /\[redacted\]/);
    assert.doesNotMatch(JSON.stringify(eventAnswer), /not-a-real-credential|fixture-only/);
    assert.equal((await post({ ...body, project: 'another-project' })).status, 404);
    assert.equal((await post(body, { Origin: base, 'Content-Type': 'application/json' })).status, 400);
    assert.equal((await post(body, { ...headers, Origin: 'https://meow-ops.vercel.app' })).status, 403);
    assert.equal((await post(body, { ...headers, Origin: 'https://example.com' })).status, 403);
    const hostedHeaders = { ...headers, Origin: 'https://meow-ops.vercel.app' };
    assert.equal((await fetch(`${base}/loop-eng/ask`, {
      method: 'POST', headers: hostedHeaders, body: JSON.stringify({ question: 'Summarize recent project evidence' }),
    })).status, 403);
    assert.equal((await fetch(`${base}/loop-eng/nonce`, { headers: hostedHeaders })).status, 403);
    assert.equal((await fetch(`${base}/companion/soul`, { headers: hostedHeaders })).status, 403);
    assert.equal((await fetch(`${base}/learning-quest/events`, {
      method: 'POST', headers: hostedHeaders, body: JSON.stringify({ action: 'lesson_opened' }),
    })).status, 403);
    assert.equal((await fetch(`${base}/loop-eng/digest`, { method: 'POST', headers: hostedHeaders, body: '{}' })).status, 403);
    assert.equal((await post({ question: 'x'.repeat(501) })).status, 400);
    assert.equal((await post({ question: 'Explain tokens' })).status, 200);
    assert.equal(readFileSync(join(history, 'sessions.jsonl'), 'utf8'), before);
    writeFileSync(join(history, 'sessions.jsonl'), '{invalid json\n', 'utf8');
    writeFileSync(join(history, 'current.json'), '{invalid json\n', 'utf8');
    const unavailable = await fetch(`${base}/session-history/sessions`);
    assert.equal(unavailable.status, 500);
    const unavailableBody = await unavailable.json();
    assert.equal(unavailableBody.error, 'Local session history is unavailable.');
    assert.doesNotMatch(JSON.stringify(unavailableBody), /meow-guide-http-/);
  } finally {
    const stopped = new Promise((resolve) => child.once('exit', resolve));
    child.kill('SIGTERM');
    await stopped;
    rmSync(root, { recursive: true, force: true });
  }
});
