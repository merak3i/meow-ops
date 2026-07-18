import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  appendAgentEvents, archiveMessageEvidence, archiveRawTextArtifact, archiveSessionEvidence, normalizeAgentEvent,
  queryAgentEvidence, rebuildEvidenceIndex, searchEvidenceIndex, sessionToAgentEvent,
} from '../project-evidence.mjs';

function fixture(overrides = {}) {
  return {
    source: 'codex',
    project_id: 'meow-ops-4efe35ade3',
    session_id: 'session-1',
    timestamp: '2026-07-19T10:00:00.000Z',
    event_type: 'user_message',
    content: 'Rotate credential sk-abcdefghijklmnopqrstuvwxyz before release.',
    raw_ref: '/private/session.jsonl:12',
    sensitivity: 'private',
    ...overrides,
  };
}

test('evidence normalization redacts secrets and produces a stable content hash', () => {
  const first = normalizeAgentEvent(fixture());
  const second = normalizeAgentEvent(fixture());
  assert.equal(first.content.includes('sk-abcdefghijklmnopqrstuvwxyz'), false);
  assert.match(first.content, /\[redacted\]/);
  assert.equal(first.content_hash, second.content_hash);
  assert.match(first.event_id, /^evt_[a-f0-9]{24}$/);
});

test('append-only evidence partitions by project, source, and month and deduplicates', () => {
  const dir = mkdtempSync(join(tmpdir(), 'meow-evidence-'));
  try {
    const first = appendAgentEvents([fixture(), fixture()], { dir });
    assert.equal(first.appended, 1);
    assert.equal(first.duplicates, 1);

    const second = appendAgentEvents([fixture()], { dir });
    assert.equal(second.appended, 0);
    assert.equal(second.duplicates, 1);

    const partition = join(dir, 'events', 'meow-ops-4efe35ade3', 'codex', '2026-07.jsonl');
    const [stored] = readFileSync(partition, 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(stored.content.includes('sk-abcdefghijklmnopqrstuvwxyz'), false);
    assert.equal(stored.raw_ref, '/private/session.jsonl:12');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('evidence query filters before applying its bounded page size', () => {
  const dir = mkdtempSync(join(tmpdir(), 'meow-evidence-query-'));
  try {
    appendAgentEvents([
      fixture({ session_id: 'one', content: 'Owner approved the constitution.' }),
      fixture({ session_id: 'two', source: 'claude', content: 'Owner corrected the project outcome.' }),
      fixture({ session_id: 'three', project_id: 'other-project', content: 'Unrelated constitution.' }),
    ], { dir });

    const result = queryAgentEvidence({
      dir,
      project_id: 'meow-ops-4efe35ade3',
      search: 'owner',
      limit: 1,
    });
    assert.equal(result.total, 2);
    assert.equal(result.items.length, 1);
    assert.equal(result.limit, 1);
    assert.deepEqual(result.facets.sources, ['claude', 'codex']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('session summaries normalize through the same evidence interface', () => {
  const event = sessionToAgentEvent({
    session_id: 'hermes-1', source: 'hermes', project: 'Meow Ops',
    started_at: '2026-07-19T10:00:00.000Z', model: 'deepseek-v4-pro',
    tools: { Bash: 2 }, total_tokens: 100, session_title: 'Project review',
  }, { project_id: 'meow-ops-4efe35ade3', raw_ref: 'hermes:state.db' });
  assert.equal(event.source, 'hermes');
  assert.equal(event.event_type, 'session_summary');
  assert.equal(event.metadata.tools.Bash, 2);
  assert.equal(event.content, 'Project review');
});

test('derived FTS5 index is rebuildable from canonical evidence', { skip: !process.env.PATH }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'meow-evidence-fts-'));
  try {
    appendAgentEvents([
      fixture({ session_id: 'search-one', content: 'Owner corrected the project constitution.' }),
      fixture({ session_id: 'search-two', source: 'claude', content: 'Unrelated implementation detail.' }),
    ], { dir });
    let index;
    try { index = rebuildEvidenceIndex({ dir }); }
    catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
    assert.equal(index.events, 2);
    const result = searchEvidenceIndex({
      dir, project_id: 'meow-ops-4efe35ade3', search: 'owner constitution', limit: 10,
    });
    assert.equal(result.indexed, true);
    assert.deepEqual(result.items.map((event) => event.session_id), ['search-one']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('evidence vault refuses storage inside a git worktree', () => {
  const dir = mkdtempSync(join(tmpdir(), 'meow-evidence-worktree-'));
  try {
    mkdirSync(join(dir, 'repo', '.git'), { recursive: true });
    assert.throws(
      () => appendAgentEvents([fixture()], { dir: join(dir, 'repo', 'evidence') }),
      /worktree-guard/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('session evidence archives only registered project and supported agent sources', () => {
  const dir = mkdtempSync(join(tmpdir(), 'meow-session-evidence-'));
  try {
    const result = archiveSessionEvidence([
      {
        session_id: 'codex-registered', source: 'codex', project: 'Meow Ops',
        started_at: '2026-07-19T10:00:00.000Z', session_title: 'Registered work',
      },
      {
        session_id: 'aider-unsupported', source: 'aider', project: 'Meow Ops',
        started_at: '2026-07-19T10:00:00.000Z',
      },
      {
        session_id: 'codex-unregistered', source: 'codex', project: 'Another project',
        started_at: '2026-07-19T10:00:00.000Z',
      },
    ], {
      dir,
      catalog: [{ project_id: 'meow-ops-4efe35ade3', name: 'Meow Ops', aliases: ['meow-ops'] }],
    });
    assert.equal(result.considered, 1);
    assert.equal(result.appended, 1);
    assert.equal(result.skipped, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('message evidence maps only registered projects into the private vault', () => {
  const dir = mkdtempSync(join(tmpdir(), 'meow-message-evidence-'));
  try {
    const result = archiveMessageEvidence([
      {
        source: 'hermes', project: 'meow-ops', session_id: 'hermes-1',
        timestamp: '2026-07-19T10:00:00.000Z', event_type: 'message_user',
        actor: 'user', content: 'Retain the owner-approved constitution.',
        raw_ref: '/tmp/hermes.db#messages:1', sensitivity: 'private', metadata: {},
      },
      {
        source: 'hermes', project: 'unregistered', session_id: 'hermes-2',
        timestamp: '2026-07-19T10:01:00.000Z', event_type: 'message_user',
        content: 'Do not attach this to Meow Ops.', raw_ref: '/tmp/hermes.db#messages:2',
      },
    ], {
      dir,
      catalog: [{ project_id: 'meow-ops-4efe35ade3', name: 'Meow Ops', aliases: ['meow-ops'] }],
    });
    assert.equal(result.considered, 1);
    assert.equal(result.appended, 1);
    assert.equal(result.skipped, 1);
    const evidence = queryAgentEvidence({ dir, project_id: 'meow-ops-4efe35ade3' });
    assert.equal(evidence.items[0].source, 'hermes');
    assert.equal(evidence.items[0].event_type, 'message_user');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('raw text artifacts are preserved privately with redaction and a provenance event', () => {
  const dir = mkdtempSync(join(tmpdir(), 'meow-raw-evidence-'));
  try {
    const raw = join(dir, 'source.jsonl');
    writeFileSync(raw, 'owner correction with sk-abcdefghijklmnopqrstuvwxyz\n', 'utf8');
    const result = archiveRawTextArtifact({
      source: 'codex', project_id: 'meow-ops-4efe35ade3', session_id: 'raw-one',
      timestamp: '2026-07-19T10:00:00.000Z', raw_ref: raw,
    }, { dir: join(dir, 'vault') });
    assert.equal(result.archived, true);
    const stored = readFileSync(join(dir, 'vault', result.blob_ref), 'utf8');
    assert.equal(stored.includes('sk-abcdefghijklmnopqrstuvwxyz'), false);
    assert.match(stored, /\[redacted\]/);
    const evidence = queryAgentEvidence({
      dir: join(dir, 'vault'), project_id: 'meow-ops-4efe35ade3', event_type: 'raw_artifact',
    });
    assert.equal(evidence.total, 1);
    assert.equal(evidence.items[0].metadata.blob_ref, result.blob_ref);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
