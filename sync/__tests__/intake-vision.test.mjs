import test from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  MAX_IMAGE_BYTES, hashImage, runVisionIntake, screenshotSessionId,
} from '../intake-vision.mjs';

const NOW = new Date('2026-07-10T00:00:00.000Z');
// Any bytes work — the module hashes and base64-encodes, never inspects PNG structure.
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02, 0x03]);
const PNG_HASH = hashImage(PNG_BYTES);
const PNG_SESSION_ID = screenshotSessionId(PNG_HASH);

function withTempDirs(fn) {
  const root = mkdtempSync(join(tmpdir(), 'meow-vision-test-'));
  const inboxDir = join(root, 'screenshots-inbox');
  const intakeDir = join(root, 'intake');
  mkdirSync(inboxDir, { recursive: true });
  try {
    return fn({ root, inboxDir, intakeDir });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writeImage(inboxDir, name, bytes = PNG_BYTES) {
  writeFileSync(join(inboxDir, name), bytes);
}

function summary(sessionId = PNG_SESSION_ID, overrides = {}) {
  return {
    intake_id: 'intake_fixture',
    session_id: sessionId,
    source: 'screenshot',
    summarized_at: NOW.toISOString(),
    task_kind: 'ops',
    outcome: 'unknown',
    failure_signatures: ['deploy-error-state'],
    waste_indicators: ['repeated-retry'],
    friction_score: 3,
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

test('vision intake stores a clean screenshot summary and advances the cursor', async () => {
  await withTempDirs(async ({ inboxDir, intakeDir }) => {
    writeImage(inboxDir, 'shot.png');
    const calls = [];
    const stats = await runVisionIntake({
      inboxDir,
      intakeDir,
      now: NOW,
      env: { MEOW_LOCAL_LLM_URL: 'http://127.0.0.1:1234/v1' },
      transport: transportFor(summary(), calls),
    });
    assert.equal(calls.length, 1);
    assert.equal(stats.stored, 1);
    assert.equal(stats.dropped, 0);
    const body = JSON.parse(calls[0].options.body);
    const parts = body.messages[0].content;
    assert.equal(parts[1].type, 'image_url');
    assert.ok(parts[1].image_url.url.startsWith('data:image/png;base64,'));

    const stored = readSummaries(intakeDir);
    assert.equal(stored.length, 1);
    assert.equal(stored[0].source, 'screenshot');
    assert.equal(stored[0].session_id, PNG_SESSION_ID);
    assert.deepEqual(Object.keys(stored[0]).sort(), [
      'failure_signatures', 'friction_score', 'intake_id', 'model_calls',
      'outcome', 'session_id', 'source', 'summarized_at', 'task_kind',
      'waste_indicators',
    ].sort());

    const cursor = JSON.parse(readFileSync(join(intakeDir, 'vision-cursor.json'), 'utf8'));
    assert.ok(cursor.processed_image_hashes.includes(PNG_HASH));
  });
});

test('a summary carrying transcribed content is dropped and never stored', async () => {
  await withTempDirs(async ({ inboxDir, intakeDir }) => {
    writeImage(inboxDir, 'shot.png');
    const fakeKey = ['sk', 'a'.repeat(24)].join('-');
    const homePath = ['', 'Users', 'fixture', 'project'].join('/');
    const stats = await runVisionIntake({
      inboxDir,
      intakeDir,
      now: NOW,
      env: { MEOW_LOCAL_LLM_URL: 'http://127.0.0.1:1234/v1' },
      transport: transportFor(summary(PNG_SESSION_ID, {
        failure_signatures: [fakeKey],
        waste_indicators: [homePath],
      }), []),
    });
    assert.equal(stats.dropped, 1);
    assert.equal(stats.stored, 0);
    assert.equal(readSummaries(intakeDir).length, 0);
    assert.equal(JSON.stringify(stats).includes(fakeKey), false);
    assert.equal(JSON.stringify(stats).includes(homePath), false);
  });
});

test('no vision model returns an honest skip and leaves no cursor', async () => {
  await withTempDirs(async ({ inboxDir, intakeDir }) => {
    writeImage(inboxDir, 'shot.png');
    const notes = [];
    const stats = await runVisionIntake({
      inboxDir,
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
    assert.equal(existsSync(join(intakeDir, 'vision-cursor.json')), false);
  });
});

test('cursor prevents a second run from reprocessing the same screenshot', async () => {
  await withTempDirs(async ({ inboxDir, intakeDir }) => {
    writeImage(inboxDir, 'shot.png');
    const calls = [];
    await runVisionIntake({
      inboxDir,
      intakeDir,
      now: NOW,
      env: { MEOW_LOCAL_LLM_URL: 'http://127.0.0.1:1234/v1' },
      transport: transportFor(summary(), calls),
    });
    const second = await runVisionIntake({
      inboxDir,
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

test('oversized and wrong-extension files are skipped, never sent to the model', async () => {
  await withTempDirs(async ({ inboxDir, intakeDir }) => {
    writeImage(inboxDir, 'shot.png');
    writeImage(inboxDir, 'big.png', Buffer.alloc(MAX_IMAGE_BYTES + 1, 0x89));
    writeFileSync(join(inboxDir, 'notes.txt'), 'not an image');
    const calls = [];
    const stats = await runVisionIntake({
      inboxDir,
      intakeDir,
      now: NOW,
      env: { MEOW_LOCAL_LLM_URL: 'http://127.0.0.1:1234/v1' },
      transport: transportFor(summary(), calls),
    });
    assert.equal(calls.length, 1);
    assert.equal(stats.stored, 1);
    assert.equal(stats.skipped, 2);
  });
});
