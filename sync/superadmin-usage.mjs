#!/usr/bin/env node
// Local-only SuperAdmin usage exporter.
//
// Reads optional operator-owned SaaS usage snapshots plus GitHub Actions
// metadata from gh auth, then writes a sanitized browser JSON file:
//   public/data/superadmin-usage.json
//
// No provider secrets, service-role keys, raw invoices, or account IDs are
// written. The committed public demo lives at public/data/demo-superadmin-usage.json.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DEFAULT_OUT = join(ROOT, 'public', 'data', 'superadmin-usage.json');
const DEMO_FILE = join(ROOT, 'public', 'data', 'demo-superadmin-usage.json');
const DEFAULT_REPOS = [
  'merak3i/meow-ops',
  'merak3i/patherle',
  'merak3i/patherle-agentic-loop-ops',
  'merak3i/meow-creative-haus-2',
];

const SECRET_TEXT = /(token|secret|password|credential|cookie|authorization|service_role|api[_-]?key)/i;
const TOKEN_SHAPE = /\b(?:gh[pousr]_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{16,}|xox[baprs]-[A-Za-z0-9-]+)\b/g;

function arg(name, fallback = null) {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function splitList(value, fallback) {
  const raw = value || '';
  const list = raw.split(',').map((item) => item.trim()).filter(Boolean);
  return list.length ? list : fallback;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clampPct(value) {
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(999, Math.round(value)));
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function gb(bytes) {
  return round((Number(bytes) || 0) / 1024 / 1024 / 1024, 2);
}

function safeText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const text = String(value).replace(TOKEN_SHAPE, '[redacted]').trim();
  if (!text) return fallback;
  if (SECRET_TEXT.test(text) && text.length > 80) return '[redacted]';
  return text.slice(0, 220);
}

function safeId(value, fallback) {
  return safeText(value, fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || fallback;
}

function firstValue(row, keys) {
  for (const key of keys) {
    if (row && row[key] !== undefined && row[key] !== null && row[key] !== '') return row[key];
  }
  return null;
}

function daysUntil(dateLike) {
  if (!dateLike) return null;
  const ms = new Date(dateLike).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.ceil((ms - Date.now()) / 86_400_000);
}

function serviceStatus({ usagePct, renewalDate, explicitStatus }) {
  const status = safeText(explicitStatus).toLowerCase();
  if (['healthy', 'watch', 'over', 'unknown'].includes(status)) return status;
  if (usagePct !== null && usagePct >= 100) return 'over';
  if (usagePct !== null && usagePct >= 75) return 'watch';
  const due = daysUntil(renewalDate);
  if (due !== null && due >= 0 && due <= 7) return 'watch';
  return 'healthy';
}

export function normalizeService(row, index = 0) {
  const name = safeText(firstValue(row, ['name', 'service_name', 'service', 'provider', 'vendor']), `Service ${index + 1}`);
  const vendor = safeText(firstValue(row, ['vendor', 'provider', 'platform']), name);
  const usageValue = numberOrNull(firstValue(row, ['usageValue', 'usage_value', 'usage', 'used', 'current_usage', 'current']));
  const limitValue = numberOrNull(firstValue(row, ['limitValue', 'limit_value', 'limit', 'quota', 'capacity', 'monthly_limit']));
  const explicitPct = numberOrNull(firstValue(row, ['usagePct', 'usage_pct', 'percent_used', 'pct']));
  const usagePct = clampPct(explicitPct ?? (limitValue && usageValue !== null ? (usageValue / limitValue) * 100 : null));
  const renewalDate = safeText(firstValue(row, ['renewalDate', 'renewal_date', 'renews_at', 'billing_period_end', 'next_renewal']), '');
  const monthlyCostUsd = numberOrNull(firstValue(row, ['monthlyCostUsd', 'monthly_cost_usd', 'cost_usd', 'monthly_cost', 'budget_usd']));
  const notesRaw = firstValue(row, ['notes', 'note', 'annotations']);
  const notes = Array.isArray(notesRaw)
    ? notesRaw.map((item) => safeText(item)).filter(Boolean).slice(0, 4)
    : safeText(notesRaw) ? [safeText(notesRaw)] : [];

  return {
    id: safeId(firstValue(row, ['id', 'key', 'slug']) ?? name, `service-${index + 1}`),
    name,
    vendor,
    category: safeText(firstValue(row, ['category', 'type', 'group']), 'Other'),
    owner: safeText(firstValue(row, ['owner', 'team']), 'Operator'),
    plan: safeText(firstValue(row, ['plan', 'tier']), 'Configured'),
    environment: safeText(firstValue(row, ['environment', 'surface', 'scope']), 'daily use'),
    status: serviceStatus({ usagePct, renewalDate, explicitStatus: firstValue(row, ['status', 'health']) }),
    monthlyCostUsd: monthlyCostUsd ?? 0,
    renewalDate,
    usageLabel: safeText(firstValue(row, ['usageLabel', 'usage_label', 'metric']), 'usage'),
    limitLabel: safeText(firstValue(row, ['limitLabel', 'limit_label']), 'limit'),
    usageValue: usageValue ?? 0,
    limitValue: limitValue ?? 0,
    usagePct: usagePct ?? 0,
    lastCheckedAt: safeText(firstValue(row, ['lastCheckedAt', 'last_checked_at', 'updated_at', 'created_at']), new Date().toISOString()),
    notes,
  };
}

function normalizeServices(rows) {
  return rows.map((row, index) => normalizeService(row, index));
}

function summarizeServices(services) {
  return {
    services: services.length,
    monthlyUsd: round(services.reduce((sum, service) => sum + (service.monthlyCostUsd || 0), 0), 2),
    watch: services.filter((service) => service.status === 'watch').length,
    over: services.filter((service) => service.status === 'over').length,
    renewal30d: services.filter((service) => {
      const due = daysUntil(service.renewalDate);
      return due !== null && due >= 0 && due <= 30;
    }).length,
  };
}

function readSnapshotRows(snapshotPath) {
  if (!snapshotPath) return [];
  const fullPath = resolve(snapshotPath);
  if (!existsSync(fullPath)) throw new Error(`snapshot not found: ${fullPath}`);
  const parsed = JSON.parse(readFileSync(fullPath, 'utf8'));
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.services)) return parsed.services;
  if (Array.isArray(parsed.rows)) return parsed.rows;
  if (Array.isArray(parsed.saas?.services)) return parsed.saas.services;
  return [];
}

function ghApi(path) {
  try {
    return {
      ok: true,
      data: JSON.parse(execFileSync('gh', ['api', path], {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 30_000,
      })),
    };
  } catch (err) {
    const stderr = err?.stderr ? String(err.stderr).trim().slice(0, 300) : '';
    return { ok: false, error: stderr || err.message || 'gh api failed' };
  }
}

function runDurationMinutes(run) {
  const start = new Date(run.run_started_at || run.created_at || 0).getTime();
  const end = new Date(run.updated_at || Date.now()).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return (end - start) / 60_000;
}

function summarizeRepoActions(repo) {
  const repoInfo = ghApi(`/repos/${repo}`);
  const runsResult = ghApi(`/repos/${repo}/actions/runs?per_page=100`);
  const workflowsResult = ghApi(`/repos/${repo}/actions/workflows?per_page=100`);
  const cacheResult = ghApi(`/repos/${repo}/actions/cache/usage`);
  const artifactsResult = ghApi(`/repos/${repo}/actions/artifacts?per_page=100`);

  if (!repoInfo.ok && !runsResult.ok) {
    return {
      repo,
      visibility: 'unknown',
      health: 'unknown',
      runs: 0,
      successful: 0,
      failed: 0,
      cancelled: 0,
      inProgress: 0,
      estimatedMinutes: 0,
      cacheGb: 0,
      artifactGb: 0,
      artifactCount: 0,
      workflows: [],
      latestRun: null,
      notes: [`GitHub API unavailable: ${safeText(runsResult.error || repoInfo.error, 'not available')}`],
    };
  }

  const runs = Array.isArray(runsResult.data?.workflow_runs) ? runsResult.data.workflow_runs : [];
  const workflows = Array.isArray(workflowsResult.data?.workflows)
    ? workflowsResult.data.workflows.slice(0, 8).map((workflow) => ({
        name: safeText(workflow.name, 'workflow'),
        state: safeText(workflow.state, 'unknown'),
      }))
    : [];
  const artifacts = Array.isArray(artifactsResult.data?.artifacts) ? artifactsResult.data.artifacts : [];
  const failed = runs.filter((run) => run.conclusion === 'failure' || run.conclusion === 'timed_out' || run.conclusion === 'action_required').length;
  const successful = runs.filter((run) => run.conclusion === 'success').length;
  const cancelled = runs.filter((run) => run.conclusion === 'cancelled' || run.conclusion === 'skipped').length;
  const inProgress = runs.filter((run) => run.status === 'in_progress' || run.status === 'queued' || run.status === 'waiting').length;
  const estimatedMinutes = round(runs.reduce((sum, run) => sum + runDurationMinutes(run), 0), 1);
  const artifactBytes = artifacts.reduce((sum, item) => sum + (Number(item.size_in_bytes) || 0), 0);
  const latest = runs[0] ?? null;
  const health = failed > 0 ? 'watch' : inProgress > 0 ? 'running' : 'healthy';

  return {
    repo,
    visibility: repoInfo.data?.private ? 'private' : 'public',
    health,
    runs: runs.length,
    successful,
    failed,
    cancelled,
    inProgress,
    estimatedMinutes,
    cacheGb: gb(cacheResult.data?.active_caches_size_in_bytes),
    artifactGb: gb(artifactBytes),
    artifactCount: Number(artifactsResult.data?.total_count) || artifacts.length,
    workflows,
    latestRun: latest ? {
      name: safeText(latest.name || latest.display_title || latest.workflow_id, 'workflow run'),
      status: safeText(latest.status, 'unknown'),
      conclusion: latest.conclusion ? safeText(latest.conclusion) : null,
      startedAt: safeText(latest.run_started_at || latest.created_at, ''),
      url: safeText(latest.html_url, ''),
    } : null,
    notes: [
      'Estimated minutes are workflow wall-clock, not GitHub billable minutes.',
      ...(cacheResult.ok ? [] : ['Cache usage unavailable for this token or repo.']),
      ...(artifactsResult.ok ? [] : ['Artifact usage unavailable for this token or repo.']),
    ],
  };
}

function collectGitHubActions(repos) {
  const repoSummaries = repos.map((repo) => summarizeRepoActions(repo));
  const totals = repoSummaries.reduce((acc, repo) => ({
    repos: acc.repos + 1,
    runs: acc.runs + repo.runs,
    successful: acc.successful + repo.successful,
    failed: acc.failed + repo.failed,
    cancelled: acc.cancelled + repo.cancelled,
    inProgress: acc.inProgress + repo.inProgress,
    estimatedMinutes: round(acc.estimatedMinutes + repo.estimatedMinutes, 1),
    cacheGb: round(acc.cacheGb + repo.cacheGb, 2),
    artifactGb: round(acc.artifactGb + repo.artifactGb, 2),
    artifactCount: acc.artifactCount + repo.artifactCount,
  }), {
    repos: 0,
    runs: 0,
    successful: 0,
    failed: 0,
    cancelled: 0,
    inProgress: 0,
    estimatedMinutes: 0,
    cacheGb: 0,
    artifactGb: 0,
    artifactCount: 0,
  });

  const now = new Date();
  const started = new Date(now.getTime() - 30 * 86_400_000);
  return {
    period: {
      label: 'last 30 days',
      startedAt: started.toISOString(),
      endedAt: now.toISOString(),
    },
    limits: {
      minutesIncluded: numberOrNull(process.env.MEOW_GITHUB_ACTIONS_MINUTES_LIMIT),
      storageGbIncluded: numberOrNull(process.env.MEOW_GITHUB_ACTIONS_STORAGE_GB_LIMIT),
      source: process.env.MEOW_GITHUB_ACTIONS_MINUTES_LIMIT ? 'env' : 'not configured',
    },
    totals,
    repos: repoSummaries,
  };
}

function sourceWiring() {
  return [
    { name: 'SuperAdmin usage snapshot', surface: 'local JSON export', status: 'wired', privacy: 'sanitized before browser' },
    { name: 'GitHub Actions usage', surface: 'gh api', status: 'wired', privacy: 'repo names and run totals only' },
    { name: 'Provider invoices', surface: 'manual export', status: 'operator-owned', privacy: 'never bundled in public build' },
    { name: 'Patherle admin telemetry', surface: 'service_logs / api_cost_ledger', status: 'expected', privacy: 'service role stays local' },
  ];
}

function loadDemo() {
  return JSON.parse(readFileSync(DEMO_FILE, 'utf8'));
}

function buildDataset({ demo = false } = {}) {
  if (demo) return loadDemo();

  const snapshotPath = arg('snapshot', process.env.MEOW_SUPERADMIN_USAGE_SNAPSHOT || '');
  const repos = splitList(process.env.MEOW_SUPERADMIN_GITHUB_REPOS, DEFAULT_REPOS);
  const snapshotRows = readSnapshotRows(snapshotPath);
  const services = normalizeServices(snapshotRows);
  const githubActions = collectGitHubActions(repos);
  const notVerified = [
    'GitHub Actions minutes are wall-clock estimates unless billing limits are configured.',
    'Provider invoice totals are absent until MEOW_SUPERADMIN_USAGE_SNAPSHOT points at a local export.',
    'No service-role key is read or written by this exporter.',
  ];
  if (!snapshotPath) notVerified.push('SuperAdmin SaaS snapshot path is not configured.');

  return {
    meta: {
      generatedAt: new Date().toISOString(),
      source: snapshotPath ? 'local snapshot + gh api' : 'gh api only',
      currency: 'USD',
      workspace: 'Meow Ops local',
      notVerified,
    },
    githubActions,
    saas: {
      totals: summarizeServices(services),
      services,
    },
    patherle: {
      sources: sourceWiring(),
    },
  };
}

function writeJsonAtomic(file, data) {
  const out = resolve(file);
  mkdirSync(dirname(out), { recursive: true });
  const tmp = `${out}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  renameSync(tmp, out);
  return out;
}

async function main() {
  const out = arg('out', DEFAULT_OUT);
  const data = buildDataset({ demo: hasFlag('demo') });
  const written = writeJsonAtomic(out, data);
  console.log(`superadmin-usage: wrote ${written}`);
  console.log(`superadmin-usage: services=${data.saas.services.length} repos=${data.githubActions.repos.length}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`superadmin-usage: ${err.message}`);
    process.exit(1);
  });
}

export { buildDataset, safeText, summarizeServices };
