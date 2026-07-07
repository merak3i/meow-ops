import test from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { callLmStudioJson, resolveLmStudioEndpoint } from '../lmstudio-client.mjs';
import { cleanIntakeSummary, resolveIntakeDir, runIntake } from '../intake-local.mjs';

const NOW = new Date('2026-07-07T00:00:00.000Z');

function withTempDirs(fn) {
  const root = mkdtempSync(join(tmpdir(), 'meow-intake-test-'));
  const sourceDir = join(root, 'claude-projects');
  const intakeDir = join(root, 'intake');
  mkdirSync(sourceDir, { recursive: true });
  try {
    return fn({ root, sourceDir, intakeDir });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writeSession(sourceDir, sessionId = 'session-demo-1') {
  const projectDir = join(sourceDir, 'demo-project');
  mkdirSync(projectDir, { recursive: true });
  const path = join(projectDir, `${sessionId}.jsonl`);
  writeFileSync(path, [
    JSON.stringify({
      type: 'user',
      sessionId,
      message: { content: [{ type: 'text', text: 'Synthetic request to adjust a demo parser.' }] },
    }),
    JSON.stringify({
      type: 'assistant',
      sessionId,
      message: { content: [{ type: 'text', text: 'Synthetic response mentioning only fixture behavior.' }] },
    }),
  ].join('\n'));
  return path;
}

function summary(overrides = {}) {
  return {
    intake_id: 'intake_fixture',
    session_id: 'session-demo-1',
    source: 'claude',
    summarized_at: NOW.toISOString(),
    task_kind: 'debug',
    outcome: 'completed',
    failure_signatures: ['edit-before-read'],
    waste_indicators: ['context-compaction'],
    friction_score: 2,
    model_calls: 1,
    ...overrides,
  };
}

function responseWith(content) {
  return {
    ok: true,
    async json() {
      return { choices: [{ message: { content } }] };
    },
  };
}

function transportFor(payload, calls) {
  return async (url, options) => {
    calls.push({ url, options });
    return responseWith(JSON.stringify(payload));
  };
}

function readSummaries(intakeDir) {
  const path = join(intakeDir, 'summaries.jsonl');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

test('lmstudio client posts only to localhost and parses OpenAI-compatible JSON', async () => {
  const calls = [];
  const value = await callLmStudioJson({
    env: { MEOW_LOCAL_LLM_URL: 'http://localhost:1234/v1', MEOW_LOCAL_LLM_MODEL: 'demo-model' },
    messages: [{ role: 'user', content: 'return json' }],
    transport: async (url, options) => {
      calls.push({ url, options });
      return responseWith(JSON.stringify({ ok: true }));
    },
  });
  assert.deepEqual(value, { ok: true });
  assert.equal(calls[0].url, 'http://localhost:1234/v1/chat/completions');
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.model, 'demo-model');
  assert.deepEqual(body.response_format, { type: 'json_object' });
});

test('lmstudio client retries malformed JSON once', async () => {
  let calls = 0;
  const value = await callLmStudioJson({
    env: { MEOW_LOCAL_LLM_URL: 'http://127.0.0.1:1234/v1' },
    messages: [{ role: 'user', content: 'return json' }],
    transport: async () => {
      calls += 1;
      return responseWith(calls === 1 ? 'not-json' : JSON.stringify({ ok: true }));
    },
  });
  assert.equal(calls, 2);
  assert.deepEqual(value, { ok: true });
});

test('non-localhost LM Studio URL throws local-only', () => {
  assert.throws(
    () => resolveLmStudioEndpoint({ MEOW_LOCAL_LLM_URL: 'https://example.com/v1' }),
    /\[local-only\]/,
  );
});

test('intake happy path stores a clean summary and advances cursor', async () => {
  await withTempDirs(async ({ sourceDir, intakeDir }) => {
    writeSession(sourceDir);
    const calls = [];
    const stats = await runIntake({
      sourceDir,
      intakeDir,
      now: NOW,
      env: { MEOW_LOCAL_LLM_URL: 'http://127.0.0.1:1234/v1' },
      transport: transportFor(summary(), calls),
    });
    assert.equal(calls.length, 1);
    assert.equal(stats.stored, 1);
    assert.equal(stats.dropped, 0);
    const stored = readSummaries(intakeDir);
    assert.equal(stored.length, 1);
    assert.deepEqual(Object.keys(stored[0]).sort(), [
      'failure_signatures', 'friction_score', 'intake_id', 'model_calls',
      'outcome', 'session_id', 'source', 'summarized_at', 'task_kind',
      'waste_indicators',
    ].sort());
    const cursor = JSON.parse(readFileSync(join(intakeDir, 'cursor.json'), 'utf8'));
    assert.deepEqual(cursor.processed_session_ids, ['session-demo-1']);
  });
});

test('malicious stub summary is dropped and never stored', async () => {
  await withTempDirs(async ({ sourceDir, intakeDir }) => {
    writeSession(sourceDir);
    const fakeKey = ['sk', 'a'.repeat(24)].join('-');
    const homePath = ['', 'Users', 'fixture', 'project'].join('/');
    const stats = await runIntake({
      sourceDir,
      intakeDir,
      now: NOW,
      env: { MEOW_LOCAL_LLM_URL: 'http://127.0.0.1:1234/v1' },
      transport: transportFor(summary({
        failure_signatures: [fakeKey],
        waste_indicators: [homePath],
      }), []),
    });
    assert.equal(stats.dropped, 1);
    assert.equal(readSummaries(intakeDir).length, 0);
    assert.equal(JSON.stringify(stats).includes(fakeKey), false);
    assert.equal(JSON.stringify(stats).includes(homePath), false);
  });
});

test('schema drift drops extra keys but rejects missing required keys', async () => {
  const clean = cleanIntakeSummary(summary({ extra_note: 'dropped' }), {
    expectedSessionId: 'session-demo-1',
    now: NOW,
    modelCalls: 1,
  });
  assert.equal(clean.extra_note, undefined);

  assert.throws(
    () => cleanIntakeSummary({
      ...summary(),
      task_kind: undefined,
    }, { expectedSessionId: 'session-demo-1', now: NOW, modelCalls: 1 }),
    /\[missing-field\]/,
  );
});

test('server absent returns honest skip and leaves cursor unchanged', async () => {
  await withTempDirs(async ({ sourceDir, intakeDir }) => {
    writeSession(sourceDir);
    const notes = [];
    const stats = await runIntake({
      sourceDir,
      intakeDir,
      now: NOW,
      notes,
      env: { MEOW_LOCAL_LLM_URL: 'http://127.0.0.1:1234/v1' },
      transport: async () => {
        throw new Error('connection refused');
      },
    });
    assert.equal(stats.stored, 0);
    assert.equal(stats.skipped, 1);
    assert.deepEqual(notes, ['intake skipped: no local model']);
    assert.equal(existsSync(join(intakeDir, 'cursor.json')), false);
  });
});

test('cursor prevents a second run from reprocessing the same session', async () => {
  await withTempDirs(async ({ sourceDir, intakeDir }) => {
    writeSession(sourceDir);
    const calls = [];
    await runIntake({
      sourceDir,
      intakeDir,
      now: NOW,
      env: { MEOW_LOCAL_LLM_URL: 'http://127.0.0.1:1234/v1' },
      transport: transportFor(summary(), calls),
    });
    const second = await runIntake({
      sourceDir,
      intakeDir,
      now: NOW,
      env: { MEOW_LOCAL_LLM_URL: 'http://127.0.0.1:1234/v1' },
      transport: transportFor(summary(), calls),
    });
    assert.equal(calls.length, 1);
    assert.equal(second.scanned, 0);
    assert.equal(second.processed, 0);
  });
});

test('intake store guard refuses a path inside a git worktree', () => {
  const prev = process.env.MEOW_INTAKE_DIR;
  process.env.MEOW_INTAKE_DIR = join(process.cwd(), 'sync');
  try {
    assert.throws(() => resolveIntakeDir(), /\[worktree-guard\]/);
  } finally {
    if (prev === undefined) delete process.env.MEOW_INTAKE_DIR;
    else process.env.MEOW_INTAKE_DIR = prev;
  }
});
