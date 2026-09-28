import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { summarizeIngestionAudit } from '../ingestion-audit.mjs';

test('summarizes freshness and registered-source coverage without returning session data', () => {
  const report = summarizeIngestionAudit({
    now: new Date('2026-09-27T00:00:00.000Z'),
    scanned: [
      { source: 'codex', session_id: 'private-session', project: 'Meow Ops' },
      { source: 'cursor', session_id: 'new-private-session', project: 'Meow Ops' },
      { source: 'cursor', session_id: 'other-private-session', project: 'Other Project' },
    ],
    archived: Object.assign([
      { source: 'codex', session_id: 'private-session', project: 'Meow Ops' },
      { source: 'cursor', session_id: 'old-private-session', project: 'Meow Ops' },
    ], { updatedAt: '2026-09-11T00:00:00.000Z' }),
    catalog: [{ name: 'Meow Ops', aliases: ['meow-ops'] }],
    evidenceCounts: {
      codex: { events: 2, sessionSummaries: 1 },
      cursor: { events: 3, sessionSummaries: 2 },
    },
  });

  assert.equal(report.archive.ageDays, 16);
  assert.equal(report.archive.totalSessions, 2);
  assert.equal(report.cursorAdminApiQueried, false);
  assert.deepEqual(report.sources.find((row) => row.source === 'codex'), {
    source: 'codex', scannedSessions: 1, scannedRegisteredSessions: 1,
    archivedSessions: 1, archivedRegisteredSessions: 1,
    registeredSessionsMissingFromArchive: 0, archivedSessionsNotSeenInCurrentScan: 0,
    evidenceEvents: 2, sessionSummaryEvents: 1,
  });
  const cursor = report.sources.find((row) => row.source === 'cursor');
  assert.equal(cursor.scannedRegisteredSessions, 1);
  assert.equal(cursor.registeredSessionsMissingFromArchive, 1);
  assert.equal(cursor.archivedSessionsNotSeenInCurrentScan, 1);
  assert.equal(JSON.stringify(report).includes('private-session'), false);
  assert.equal(JSON.stringify(report).includes('Other Project'), false);
});

test('counts sessions under the registered repository root without returning paths or IDs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'meow-ingestion-root-'));
  const projectRoot = join(dir, 'registered-project');
  const nestedWorkdir = join(projectRoot, 'packages', 'app');
  const siblingWorkdir = join(dir, 'registered-project-copy');
  mkdirSync(nestedWorkdir, { recursive: true });
  mkdirSync(siblingWorkdir);
  try {
    const report = summarizeIngestionAudit({
      scanned: [
        { source: 'claude', session_id: 'private-session-id', project: 'app', cwd: nestedWorkdir },
        { source: 'claude', session_id: 'sibling-session-id', project: 'project-copy', cwd: siblingWorkdir },
      ],
      archived: [],
      catalog: [{ name: 'Meow Ops', root: projectRoot }],
    });
    const claude = report.sources.find((row) => row.source === 'claude');
    assert.equal(claude.scannedRegisteredSessions, 1);
    assert.equal(claude.registeredSessionsMissingFromArchive, 1);
    assert.equal(JSON.stringify(report).includes('private-session-id'), false);
    assert.equal(JSON.stringify(report).includes(projectRoot), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
