import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const MAX_GIT_COMMITS = 100;
const MAX_EVIDENCE_EVENTS = 100;
const DAY_MS = 24 * 60 * 60 * 1_000;

const activityTerms = [
  'what happened', 'what changed', 'features', 'feature work', 'worked on',
  'pull request', 'github pr', 'commits', 'recent work', 'recent activity', 'project activity',
];

export function isProjectActivityQuestion(question, catalog = []) {
  const value = String(question || '').toLowerCase();
  const hasActivity = activityTerms.some((term) => value.includes(term))
    || /\bpr\s*#?\s*\d+\b.*\bchanged\b|\bchanged\b.*\bpr\s*#?\s*\d+\b/i.test(value);
  const hasKnownProject = catalog.some((project) => names(project).some(
    (name) => matchesName(value, name),
  ));
  const hasProjectContext = value.includes('project')
    || value.includes('github')
    || value.includes('pull request')
    || /\bpr(?:s)?\b/.test(value)
    || hasKnownProject
    || Boolean(requestedProjectName(question));
  return hasActivity && hasProjectContext;
}

function periodFor(question, now) {
  const q = String(question || '').toLowerCase();
  const to = new Date(now);
  const rolling = q.match(/\blast\s+(\d{1,4})\s+days?\b/);
  if (rolling) {
    const days = Math.min(3_650, Math.max(1, Number.parseInt(rolling[1], 10)));
    return {
      label: `the last ${days} day${days === 1 ? '' : 's'}`,
      from: new Date(to.getTime() - days * DAY_MS).toISOString(),
      to: to.toISOString(),
    };
  }
  if (q.includes('today')) {
    const from = new Date(to);
    from.setHours(0, 0, 0, 0);
    return { label: 'today', from: from.toISOString(), to: to.toISOString() };
  }
  if (q.includes('this month')) {
    const from = new Date(to.getFullYear(), to.getMonth(), 1);
    return { label: 'this month', from: from.toISOString(), to: to.toISOString() };
  }
  if (q.includes('this week')) {
    const from = new Date(to);
    const daysSinceMonday = from.getDay() === 0 ? 6 : from.getDay() - 1;
    from.setDate(from.getDate() - daysSinceMonday);
    from.setHours(0, 0, 0, 0);
    return { label: 'this week', from: from.toISOString(), to: to.toISOString() };
  }
  return {
    label: 'the last 7 days',
    from: new Date(to.getTime() - 7 * DAY_MS).toISOString(),
    to: to.toISOString(),
  };
}

function names(project) {
  return [project?.name, ...(Array.isArray(project?.aliases) ? project.aliases : [])]
    .map((name) => String(name || '').trim())
    .filter(Boolean);
}

function compact(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function matchesName(question, name) {
  const q = String(question || '').toLowerCase();
  const literal = String(name || '').toLowerCase();
  if (q.includes(literal)) return true;
  const normalizedName = compact(name);
  return normalizedName.length >= 4 && compact(q).includes(normalizedName);
}

function requestedProjectName(question) {
  const q = String(question || '');
  const patterns = [
    /\b(?:in|on|for)\s+(?:the\s+)?([a-z0-9][a-z0-9._-]*(?:\s+[a-z0-9][a-z0-9._-]*){0,4}?)\s+project\b/i,
    /\bproject\s+(?:named\s+)?["']?([a-z0-9][a-z0-9._-]*(?:\s+[a-z0-9][a-z0-9._-]*){0,4}?)["']?(?=\s+(?:in|over|during|for|from)\b|[?.!,]|$)/i,
    /\b(?:in|on|for)\s+(?:the\s+)?([a-z0-9][a-z0-9 ._-]{0,80}?)(?=\s+(?:in|over|during|for|from)\s+(?:the\s+)?(?:last|past|this)\b|[?.!,]|$)/i,
  ];
  for (const pattern of patterns) {
    const match = q.match(pattern);
    if (match) {
      const candidate = match[1].trim();
      if (!/^(?:last|past|this)\s+\d*\s*(?:day|week|month)/i.test(candidate)) return candidate;
    }
  }
  return null;
}

function resolveProject(question, catalog) {
  const matches = [...catalog]
    .flatMap((project) => names(project).map((name) => ({ project, name })))
    .filter((candidate) => matchesName(question, candidate.name))
    .sort((a, b) => b.name.length - a.name.length);
  const distinctProjects = [...new Map(matches.map((match) => [match.project.project_id, match.project])).values()];
  if (distinctProjects.length > 1) {
    return { project: null, requested_project: null, matched_projects: distinctProjects };
  }
  if (matches[0]) {
    return { project: matches[0].project, requested_project: matches[0].name, matched_projects: distinctProjects };
  }
  const requested = requestedProjectName(question);
  if (requested) return { project: null, requested_project: requested, matched_projects: [] };
  if (catalog.length === 1) {
    return { project: catalog[0], requested_project: catalog[0].name, matched_projects: [catalog[0]] };
  }
  return { project: null, requested_project: null, matched_projects: [] };
}

function parseGitLog(output) {
  return String(output || '')
    .split('\x1e')
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [sha, timestamp, subject, body = ''] = record.split('\x1f');
      const pr = String(subject || '').match(/\bMerge pull request #(\d+)\b/i)
        || String(subject || '').match(/\(#(\d+)\)\s*$/);
      return {
        sha,
        short_sha: String(sha).slice(0, 7),
        timestamp,
        subject,
        body: body.trim(),
        pr_number: pr ? Number.parseInt(pr[1], 10) : null,
      };
    });
}

export function readLocalGitActivity(project, period, options = {}) {
  if (!project?.root || !existsSync(project.root)) {
    return { available: false, commits: [], reason: 'project-root-missing' };
  }
  const exec = options.execFileSync || execFileSync;
  try {
    exec('git', ['-C', project.root, 'rev-parse', '--git-dir'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    const output = exec('git', [
      '-C', project.root, 'log', 'HEAD',
      `--since=${period.from}`, `--until=${period.to}`,
      `--max-count=${MAX_GIT_COMMITS + 1}`,
      '--date=iso-strict',
      '--pretty=format:%H%x1f%aI%x1f%s%x1f%b%x1e',
    ], {
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const rows = parseGitLog(output);
    return {
      available: true,
      commits: rows.slice(0, MAX_GIT_COMMITS),
      truncated: rows.length > MAX_GIT_COMMITS,
    };
  } catch {
    return { available: false, commits: [], reason: 'git-history-unavailable' };
  }
}

export function buildProjectActivity(question, options = {}) {
  const catalog = Array.isArray(options.catalog) ? options.catalog : [];
  if (!isProjectActivityQuestion(question, catalog)) return null;
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const period = periodFor(question, now);
  const resolved = resolveProject(question, catalog);
  const base = {
    requested: true,
    period,
    project: resolved.project,
    requested_project: resolved.requested_project,
    matched_projects: resolved.matched_projects,
    catalog_projects: catalog.map((project) => ({
      project_id: project.project_id,
      name: project.name,
    })),
  };
  if (!resolved.project) return base;

  const source = ['antigravity', 'claude', 'codex', 'cursor', 'hermes']
    .find((candidate) => String(question).toLowerCase().includes(candidate));
  const evidenceResult = typeof options.queryEvidence === 'function'
    ? options.queryEvidence({
      project_id: resolved.project.project_id,
      from: period.from,
      to: period.to,
      ...(source ? { source } : {}),
      limit: MAX_EVIDENCE_EVENTS,
    })
    : { items: [] };
  const requestedPr = String(question || '').match(/\bpr\s*#?\s*(\d+)\b/i);
  const git = readLocalGitActivity(resolved.project, period, options);
  const requestedPrNumber = requestedPr ? Number.parseInt(requestedPr[1], 10) : null;
  if (requestedPrNumber) {
    git.commits = git.commits.filter((commit) => commit.pr_number === requestedPrNumber);
  }
  return {
    ...base,
    requested_pr: requestedPrNumber,
    git,
    events: Array.isArray(evidenceResult?.items) ? evidenceResult.items : [],
    evidence_total: Number(evidenceResult?.total) || 0,
  };
}
