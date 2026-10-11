// sync/hosted-status.mjs — the only bridge between a hosted shell and the helper.
//
// Owner decision (2026-10-11): the hosted dashboard may read a redacted sync
// status and start a local sync run. It still cannot read sessions, costs,
// titles, projects, paths, transcripts, storage, or any other private route.
// A sync run only refreshes files on this machine; nothing is uploaded.
//
// Opt out with MEOW_HOSTED_SYNC=0. Add further exact https origins with
// MEOW_HOSTED_SYNC_ORIGINS (comma-separated).

export const DEFAULT_HOSTED_SYNC_ORIGINS = ['https://meow-ops.vercel.app'];

export function hostedSyncOrigins(env = process.env) {
  if (String(env.MEOW_HOSTED_SYNC ?? '').trim() === '0') return new Set();
  const extra = String(env.MEOW_HOSTED_SYNC_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => {
      try {
        const url = new URL(value);
        return url.protocol === 'https:' && url.origin === value;
      } catch {
        return false;
      }
    });
  return new Set([...DEFAULT_HOSTED_SYNC_ORIGINS, ...extra]);
}

/** Exactly two operations are reachable from a hosted origin. */
export function isHostedSyncRoute(path, method) {
  return (path === '/sync/status' && method === 'GET')
    || (path === '/sync' && method === 'POST');
}

const PHASE_STATUSES = new Set(['pending', 'running', 'succeeded', 'failed', 'warning', 'skipped']);
const STATES = new Set(['idle', 'running', 'succeeded', 'partial', 'failed']);
const SAFE_ID = /^[a-z0-9_-]{1,64}$/i;

function safeId(value) {
  return typeof value === 'string' && SAFE_ID.test(value) ? value : null;
}

function safeIso(value) {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function safeCount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

function safeIssue(issue) {
  if (!issue || typeof issue !== 'object') return null;
  // Summaries can quote local paths or tool output. Only codes cross over.
  return { stage: safeId(issue.stage), code: safeId(issue.code) };
}

/**
 * Allowlist projection of getSyncStatus() for a hosted origin. Fields not
 * named here never leave the machine.
 */
export function redactSyncStatusForHosted(status) {
  const source = status && typeof status === 'object' ? status : {};
  const artifact = source.artifact && typeof source.artifact === 'object' ? source.artifact : {};
  const sourceCounts = {};
  for (const [key, value] of Object.entries(artifact.source_counts || {})) {
    if (safeId(key)) sourceCounts[key] = safeCount(value);
  }
  const sourceHealth = {};
  for (const [key, value] of Object.entries(artifact.source_health || {})) {
    if (!safeId(key) || !value || typeof value !== 'object') continue;
    sourceHealth[key] = { state: safeId(value.state) || 'unknown', sessions: safeCount(value.sessions) };
  }
  const mtime = Number(artifact.mtime);
  return {
    ok: Boolean(source.ok),
    redacted: true,
    run_id: safeId(source.run_id),
    state: STATES.has(source.state) ? source.state : 'idle',
    phase: safeId(source.phase),
    phases: Array.isArray(source.phases)
      ? source.phases.map((phase) => ({
        id: safeId(phase?.id),
        status: PHASE_STATUSES.has(phase?.status) ? phase.status : 'pending',
      })).filter((phase) => phase.id)
      : [],
    trigger: safeId(source.trigger),
    started_at: safeIso(source.started_at),
    completed_at: safeIso(source.completed_at),
    failure: safeIssue(source.failure),
    warning: safeIssue(source.warning),
    artifact: {
      available: Boolean(artifact.available),
      mtime: Number.isFinite(mtime) ? mtime : null,
      sessions: safeCount(artifact.sessions),
      source_counts: sourceCounts,
      source_health: sourceHealth,
    },
  };
}
