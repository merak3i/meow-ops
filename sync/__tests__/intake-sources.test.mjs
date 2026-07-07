import test from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runAutomationHealth } from '../automation-health.mjs';
import { runAntigravityIntake } from '../intake-antigravity.mjs';
import { runCodexIntake } from '../intake-codex.mjs';

const NOW = new Date('2026-07-07T00:00:00.000Z');

async function withTempDirs(fn) {
  const root = mkdtempSync(join(tmpdir(), 'meow-intake-sources-'));
  const intakeDir = join(root, 'intake');
  try {
    return await fn({ root, intakeDir });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function readSummaries(intakeDir) {
  const path = join(intakeDir, 'summaries.jsonl');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

test('codex intake aggregates deterministically by level and target, then cursor-throttles', async () => {
  await withTempDirs(async ({ intakeDir }) => {
    const secretTarget = ['sk', 'a'.repeat(24)].join('-');
    const pathTarget = ['', 'Users', 'fixture', 'project'].join('/');
    const rows = [
      { level: 'WARN', target: 'submission_dispatch', count: 12 },
      { level: 'ERROR', target: 'rmcp_client', count: 3 },
      { level: 'ERROR', target: 'submission_dispatch', count: 1 },
      { level: 'WARN', target: pathTarget, count: 99 },
      { level: 'ERROR', target: secretTarget, count: 100 },
    ];

    const first = await runCodexIntake({
      rows,
      intakeDir,
      now: NOW,
      limit: 5,
      codexContext: 'codex-sessions-indexed',
    });
    assert.equal(first.processed, 5);
    assert.equal(first.stored, 3);
    assert.equal(first.dropped, 2);
    assert.equal(JSON.stringify(first).includes(secretTarget), false);
    assert.equal(JSON.stringify(first).includes(pathTarget), false);

    const stored = readSummaries(intakeDir);
    assert.deepEqual(
      stored.map((record) => record.failure_signatures[0]),
      ['rmcp_client', 'submission_dispatch', 'submission_dispatch'],
    );
    assert.equal(stored.every((record) => record.source === 'codex'), true);
    assert.equal(stored.every((record) => record.task_kind === 'ops'), true);
    assert.equal(stored.every((record) => record.model_calls === 0), true);

    const second = await runCodexIntake({
      rows,
      intakeDir,
      now: NOW,
      limit: 5,
      codexContext: 'codex-sessions-indexed',
    });
    assert.equal(second.processed, 0);
    assert.equal(readSummaries(intakeDir).length, 3);
  });
});

test('antigravity intake reuses parser metadata and stores no transcript content', async () => {
  await withTempDirs(async ({ root, intakeDir }) => {
    const antigravityDir = join(root, 'antigravity');
    const uuid = '00000000-0000-4000-8000-000000000001';
    const transcriptDir = join(antigravityDir, 'brain', uuid, '.system_generated', 'logs');
    mkdirSync(transcriptDir, { recursive: true });
    writeFileSync(join(transcriptDir, 'transcript.jsonl'), [
      JSON.stringify({
        source: 'USER_EXPLICIT',
        type: 'USER_INPUT',
        created_at: '2026-07-07T00:00:00.000Z',
        content: '<USER_REQUEST>Synthetic private request text</USER_REQUEST>',
      }),
      JSON.stringify({
        source: 'MODEL',
        type: 'VIEW_FILE',
        created_at: '2026-07-07T00:02:00.000Z',
        tool_calls: [
          { name: 'view_file', args: { AbsolutePath: join(root, 'demo-project', 'src', 'file.js') } },
          { name: 'run_command', args: {} },
        ],
      }),
    ].join('\n'));

    const stats = await runAntigravityIntake({
      antigravityDir,
      intakeDir,
      now: NOW,
      limit: 10,
    });
    assert.equal(stats.stored, 1);
    const [stored] = readSummaries(intakeDir);
    assert.equal(stored.source, 'antigravity');
    assert.equal(stored.outcome, 'unknown');
    assert.equal(stored.model_calls, 0);
    assert.deepEqual(stored.failure_signatures, ['tool-bash', 'tool-read']);
    assert.equal(JSON.stringify(stored).includes('Synthetic private request text'), false);
  });
});

test('antigravity intake skips honestly when the data dir is absent', async () => {
  await withTempDirs(async ({ root, intakeDir }) => {
    const stats = await runAntigravityIntake({
      antigravityDir: join(root, 'missing-antigravity'),
      intakeDir,
      now: NOW,
    });
    assert.equal(stats.skipped, 1);
    assert.equal(stats.stored, 0);
    assert.equal(existsSync(join(intakeDir, 'cursor.json')), false);
  });
});

test('automation health scrubs planted path and token-shaped values before storing', async () => {
  await withTempDirs(async ({ root, intakeDir }) => {
    const launchAgentsDir = join(root, 'LaunchAgents');
    const logsDir = join(root, 'Logs');
    mkdirSync(launchAgentsDir, { recursive: true });
    mkdirSync(logsDir, { recursive: true });
    const logPath = join(logsDir, 'demo.err.log');
    const plantedPath = ['', 'Users', 'fixture', 'demo-app', 'sync.js'].join('/');
    const plantedSecret = ['sk', 'b'.repeat(24)].join('-');
    writeFileSync(logPath, `INFO ok\nERROR failed at ${plantedPath} with ${plantedSecret}\n`);
    writeFileSync(join(launchAgentsDir, 'com.demo.agent.plist'), [
      '<plist><dict>',
      '<key>Label</key><string>com.demo.agent</string>',
      `<key>StandardErrorPath</key><string>${logPath}</string>`,
      '</dict></plist>',
    ].join('\n'));

    const snapshot = await runAutomationHealth({
      intakeDir,
      launchAgentsDir,
      logsDir,
      now: NOW,
      launchctlText: 'PID\tStatus\tLabel\n-\t1\tcom.demo.agent\n',
    });
    assert.equal(snapshot.agents.length, 1);
    assert.equal(snapshot.agents[0].last_exit_status, 1);
    assert.deepEqual(snapshot.agents[0].flags, ['failed']);
    assert.equal(snapshot.agents[0].last_error_signature.includes(plantedSecret), false);
    assert.equal(snapshot.agents[0].last_error_signature.includes(plantedPath), false);
    assert.equal(snapshot.agents[0].last_error_signature.includes(['', 'Users', ''].join('/')), false);

    const stored = JSON.parse(readFileSync(join(intakeDir, 'automation-health.json'), 'utf8'));
    assert.deepEqual(stored, snapshot);
  });
});
