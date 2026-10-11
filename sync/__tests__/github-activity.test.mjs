import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRepos, readGithubActivity, shapeRepo } from '../../api/_github-activity-core.js';

test('repo list is validated and capped', () => {
  assert.deepEqual(parseRepos(''), ['merak3i/meow-ops']);
  assert.deepEqual(parseRepos('a/b, bad, ../x, a/b, c/d'), ['a/b', 'c/d']);
});

test('private repositories expose timing and status only', () => {
  const out = shapeRepo('me/secret', { private: true, pushed_at: '2026-10-10T00:00:00Z' },
    [{ sha: 'abcdef123', html_url: 'u', author: { login: 'me' }, commit: { message: 'client name\nbody', committer: { date: '2026-10-11T00:00:00Z' } } }],
    { workflow_runs: [{ name: 'Deploy client', status: 'completed', conclusion: 'success', event: 'push', updated_at: '2026-10-11T01:00:00Z', html_url: 'u' }] });
  const text = JSON.stringify(out);
  assert.equal(text.includes('client'), false);
  assert.equal(out.url, null);
  assert.equal(out.commits[0].sha, 'abcdef1');
  assert.equal(out.lastActivityAt, '2026-10-11T01:00:00.000Z');
});

test('public repositories include messages and links; failures stay per repo', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('/repos/x/missing')) return { status: 404, ok: false, json: async () => ({}) };
    const body = url.endsWith('/repos/x/pub') ? { private: false, pushed_at: '2026-10-09T00:00:00Z', default_branch: 'main' }
      : url.includes('/commits') ? [{ sha: '1234567890', html_url: 'https://github.com/x/pub/commit/1', author: { login: 'x' }, commit: { message: 'fix: thing\n\nmore', committer: { date: '2026-10-10T00:00:00Z' } } }]
        : { workflow_runs: [] };
    return { status: 200, ok: true, json: async () => body };
  };
  const result = await readGithubActivity({ env: { MEOW_ACTIVITY_REPOS: 'x/pub,x/missing' }, fetchImpl, now: 0 });
  assert.equal(result.ok, true);
  assert.equal(result.repos[0].commits[0].message, 'fix: thing');
  assert.deepEqual(result.repos[1], { repo: 'x/missing', error: 'not_found' });
  assert.equal(result.lastActivityAt, '2026-10-10T00:00:00.000Z');
});
