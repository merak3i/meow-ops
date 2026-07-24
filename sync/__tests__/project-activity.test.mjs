import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildProjectActivity, isProjectActivityQuestion } from '../project-activity.mjs';

function withRepo(fn) {
  const root = mkdtempSync(join(tmpdir(), 'meow-project-activity-'));
  try {
    execFileSync('git', ['init', '-q', root]);
    execFileSync('git', ['-C', root, 'config', 'user.email', 'test@example.com']);
    execFileSync('git', ['-C', root, 'config', 'user.name', 'Test']);
    writeFileSync(join(root, 'feature.txt'), 'release\n');
    execFileSync('git', ['-C', root, 'add', 'feature.txt']);
    execFileSync('git', ['-C', root, 'commit', '-qm', 'feat: complete customer release path'], {
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: '2026-07-23T10:00:00.000Z',
        GIT_COMMITTER_DATE: '2026-07-23T10:00:00.000Z',
      },
    });
    writeFileSync(join(root, 'feature.txt'), 'release\nsquash\n');
    execFileSync('git', ['-C', root, 'add', 'feature.txt']);
    execFileSync('git', ['-C', root, 'commit', '-qm', 'feat: audited release (#29)'], {
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: '2026-07-24T10:00:00.000Z',
        GIT_COMMITTER_DATE: '2026-07-24T10:00:00.000Z',
      },
    });
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('recognizes bounded project feature and PR questions', () => {
  assert.equal(isProjectActivityQuestion('what happened in LCWI project in the last 3 days?'), true);
  assert.equal(isProjectActivityQuestion('what features were worked on according to the GitHub PR?'), true);
  assert.equal(isProjectActivityQuestion('what changed in lcwi?', [{
    name: 'One Click Website India', aliases: ['lcwi'],
  }]), true);
  assert.equal(isProjectActivityQuestion('recent activity in lcwi project', [{
    name: 'One Click Website India', aliases: ['lcwi'],
  }]), true);
  assert.equal(isProjectActivityQuestion('what should I eat?'), false);
});

test('resolves a catalog alias and filters evidence before answering', () => withRepo((root) => {
  let evidenceQuery;
  const activity = buildProjectActivity(
    'what happened in LCWI project in the last 3 days according to GitHub PRs?',
    {
      now: new Date('2026-07-25T10:00:00.000Z'),
      catalog: [{
        project_id: 'oneclick-1',
        name: 'One Click Website India',
        aliases: ['LCWI', '1CWI'],
        root,
      }],
      queryEvidence: (query) => {
        evidenceQuery = query;
        return { total: 1, items: [{ event_id: 'evt-1', source: 'codex', content: 'Release work' }] };
      },
    },
  );

  assert.equal(activity.project.project_id, 'oneclick-1');
  assert.equal(activity.period.label, 'the last 3 days');
  assert.equal(activity.git.available, true);
  assert.ok(activity.git.commits.some((commit) => commit.subject === 'feat: complete customer release path'));
  assert.equal(activity.git.commits.find((commit) => commit.subject.includes('audited release'))?.pr_number, 29);
  assert.equal(activity.events.length, 1);
  assert.deepEqual(
    { project_id: evidenceQuery.project_id, from: evidenceQuery.from, to: evidenceQuery.to },
    {
      project_id: 'oneclick-1',
      from: '2026-07-22T10:00:00.000Z',
      to: '2026-07-25T10:00:00.000Z',
    },
  );
}));

test('keeps an explicit unknown project unresolved even with one catalog entry', () => {
  const activity = buildProjectActivity('what happened in LCWI project in the last 3 days?', {
    now: new Date('2026-07-25T10:00:00.000Z'),
    catalog: [{ project_id: 'meow-ops-1', name: 'Meow Ops', aliases: ['meow-ops'], root: '/missing' }],
    queryEvidence: () => {
      throw new Error('must not query evidence for an unresolved project');
    },
  });
  assert.equal(activity.project, null);
  assert.equal(activity.requested_project, 'LCWI');
});
