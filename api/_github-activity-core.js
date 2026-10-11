// Shared core for /api/github-activity. Files starting with "_" are not
// deployed as their own Vercel functions.
//
// Reads repository activity (commits, workflow runs) from the GitHub REST API
// so the hosted shell can show "last code activity" while the laptop helper
// is offline. Nothing from the operator's machine is involved.
//
// Env (Vercel project settings):
//   MEOW_ACTIVITY_REPOS  comma-separated owner/name list (default merak3i/meow-ops)
//   GITHUB_TOKEN         optional; raises the rate limit and allows private repos
//
// The endpoint is public, so private repositories return timing and status
// only: no commit messages, authors, workflow names or links.

export const DEFAULT_REPOS = ['merak3i/meow-ops'];
const REPO_PATTERN = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const MAX_REPOS = 8;

export function parseRepos(value) {
  const list = String(value || '')
    .split(',')
    .map((repo) => repo.trim())
    .filter((repo) => REPO_PATTERN.test(repo) && !repo.split('/').some((part) => part === '.' || part === '..'));
  return [...new Set(list.length ? list : DEFAULT_REPOS)].slice(0, MAX_REPOS);
}

function iso(value) {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function firstLine(message) {
  return String(message || '').split('\n')[0].slice(0, 140);
}

export function shapeRepo(repo, meta, commits, runs) {
  const isPrivate = meta?.private !== false;
  const commitRows = (Array.isArray(commits) ? commits : []).slice(0, 3).map((item) => ({
    sha: String(item?.sha || '').slice(0, 7),
    committedAt: iso(item?.commit?.committer?.date || item?.commit?.author?.date),
    ...(isPrivate ? {} : {
      message: firstLine(item?.commit?.message),
      author: item?.author?.login || null,
      url: item?.html_url || null,
    }),
  }));
  const runRows = (Array.isArray(runs?.workflow_runs) ? runs.workflow_runs : []).slice(0, 5).map((run) => ({
    status: run?.status || null,
    conclusion: run?.conclusion || null,
    event: run?.event || null,
    updatedAt: iso(run?.updated_at),
    ...(isPrivate ? {} : {
      name: run?.name || null,
      branch: run?.head_branch || null,
      url: run?.html_url || null,
    }),
  }));
  const times = [
    iso(meta?.pushed_at),
    ...commitRows.map((row) => row.committedAt),
    ...runRows.map((row) => row.updatedAt),
  ].filter(Boolean).sort();
  return {
    repo,
    private: isPrivate,
    url: isPrivate ? null : `https://github.com/${repo}`,
    defaultBranch: meta?.default_branch || null,
    lastActivityAt: times.at(-1) || null,
    commits: commitRows,
    runs: runRows,
  };
}

async function ghJson(path, { token, fetchImpl }) {
  const response = await fetchImpl(`https://api.github.com${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'meow-ops-activity',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(8000),
  });
  if (response.status === 404) throw Object.assign(new Error('not_found'), { code: 'not_found' });
  if (response.status === 403 || response.status === 429) throw Object.assign(new Error('rate_limited'), { code: 'rate_limited' });
  if (!response.ok) throw Object.assign(new Error('unavailable'), { code: 'unavailable' });
  return response.json();
}

export async function readGithubActivity({ env = process.env, fetchImpl = fetch, now = Date.now() } = {}) {
  const token = env.GITHUB_TOKEN || env.MEOW_GITHUB_TOKEN || '';
  const repos = parseRepos(env.MEOW_ACTIVITY_REPOS);
  const results = await Promise.all(repos.map(async (repo) => {
    try {
      const [meta, commits, runs] = await Promise.all([
        ghJson(`/repos/${repo}`, { token, fetchImpl }),
        ghJson(`/repos/${repo}/commits?per_page=3`, { token, fetchImpl }),
        ghJson(`/repos/${repo}/actions/runs?per_page=5`, { token, fetchImpl }).catch(() => ({ workflow_runs: [] })),
      ]);
      return shapeRepo(repo, meta, commits, runs);
    } catch (error) {
      return { repo, error: error?.code || 'unavailable' };
    }
  }));
  const lastActivityAt = results
    .map((row) => row.lastActivityAt)
    .filter(Boolean)
    .sort()
    .at(-1) || null;
  return {
    ok: results.some((row) => !row.error),
    generatedAt: new Date(now).toISOString(),
    authenticated: Boolean(token),
    lastActivityAt,
    repos: results,
  };
}
