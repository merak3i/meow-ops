#!/usr/bin/env node
// Capture a loop run from the local session export.
//
//   node sync/loop-capture.mjs --loop patherle-qa --since 2026-07-01
//   node sync/loop-capture.mjs --loop meow-ops-dev --sessions id1,id2
//   node sync/loop-capture.mjs --loop x --correlation branch:fix/foo --baseline run_abc
//
// Reads public/data/sessions.json (already stripped of content fields by
// toPublicSession), summarizes the selected sessions into a LoopRun, and
// appends it to the ledger. With --baseline it also appends a RunComparison
// with per-metric delta_pct and flags.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  appendRecord, newId, readLedger, resolveLedgerDir,
} from './loop-ledger.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SESSIONS_PATH = join(HERE, '..', 'public', 'data', 'sessions.json');

// Deltas beyond these thresholds get a flag on the comparison; the UI turns
// flags into pre-filled proposal skeletons later (Phase 3).
const FLAG_RULES = [
  { flag: 'cost_spike', metric: 'cost_usd_real', above: 25 },
  { flag: 'error_spike', metric: 'tool_error_count', above: 25 },
  { flag: 'slower', metric: 'duration_seconds', above: 25 },
];

export function parseArgs(argv) {
  const opts = { loop: null, sessions: null, since: null, until: null, correlation: null, baseline: null, project: null };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    const name = key.slice(2);
    if (!(name in opts)) throw new Error(`unknown flag --${name}`);
    opts[name] = argv[i + 1];
    i++;
  }
  if (!opts.sessions && !opts.since && !opts.correlation) {
    throw new Error('select sessions with --sessions, --since, or --correlation');
  }
  return opts;
}

export function readLoopAliases(path = join(resolveLedgerDir(), 'aliases.json')) {
  if (!existsSync(path)) return {};
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(`[aliases] aliases.json is malformed JSON: ${err.message}`);
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('[aliases] aliases.json must be an object mapping correlation prefixes to loop_id strings');
  }
  for (const [prefix, loopId] of Object.entries(parsed)) {
    if (!prefix || typeof loopId !== 'string' || loopId.length === 0) {
      throw new Error('[aliases] aliases.json must map non-empty correlation prefixes to non-empty loop_id strings');
    }
  }
  return parsed;
}

export function resolveLoopId(opts, aliases = null) {
  if (opts.loop) return opts.loop;
  const loadedAliases = aliases ?? readLoopAliases();
  if (opts.correlation) {
    const match = Object.keys(loadedAliases)
      .filter((prefix) => opts.correlation.startsWith(prefix))
      .sort((a, b) => b.length - a.length || a.localeCompare(b))[0];
    if (match) return loadedAliases[match];
  }
  throw new Error('--loop <loop_id> is required unless --correlation matches aliases.json');
}

export function selectSessions(all, opts) {
  let picked = all;
  if (opts.sessions) {
    const wanted = new Set(opts.sessions.split(',').map((s) => s.trim()).filter(Boolean));
    picked = picked.filter((s) => wanted.has(s.session_id));
  }
  if (opts.since) {
    const since = Date.parse(opts.since);
    const until = opts.until ? Date.parse(opts.until) + 24 * 3600 * 1000 : Infinity;
    picked = picked.filter((s) => {
      const t = Date.parse(s.ended_at || s.started_at || 0);
      return t >= since && t < until;
    });
  }
  if (opts.correlation) {
    picked = picked.filter((s) => (s.correlation_id || '').startsWith(opts.correlation));
  }
  if (opts.project) {
    picked = picked.filter((s) => s.project === opts.project);
  }
  // Dedupe by session_id: the exporter has historically emitted the same
  // session more than once (per-file suffixing), which double-counts every
  // metric. Bad totals here become bad "1% improvement" evidence later.
  const byId = new Map();
  for (const s of picked) if (!byId.has(s.session_id)) byId.set(s.session_id, s);
  return [...byId.values()];
}

export function summarize(sessions) {
  const metrics = {
    sessions: sessions.length,
    duration_seconds: 0,
    total_tokens: 0,
    cost_usd_real: 0,      // Claude: real API-equivalent dollars
    cost_usd_notional: 0,  // Codex: subscription burn, NOT billed money
    message_count: 0,
    tool_error_count: 0,   // not derivable from sessions.json yet; stays 0 until the exporter emits it
  };
  const sources = new Set();
  for (const s of sessions) {
    sources.add(s.source || 'unknown');
    metrics.duration_seconds += s.duration_seconds || 0;
    metrics.total_tokens += s.total_tokens || 0;
    metrics.message_count += s.message_count || 0;
    const cost = s.estimated_cost_usd || 0;
    if (s.source === 'codex') metrics.cost_usd_notional += cost;
    else metrics.cost_usd_real += cost;
  }
  for (const key of ['cost_usd_real', 'cost_usd_notional']) {
    metrics[key] = Math.round(metrics[key] * 1e6) / 1e6;
  }
  return { metrics, sources: [...sources].sort() };
}

export function compareRuns(baseline, run) {
  const deltas = {};
  const flags = new Set();
  for (const [metric, after] of Object.entries(run.metrics)) {
    const before = baseline.metrics[metric];
    if (typeof after !== 'number' || typeof before !== 'number') continue;
    const delta_pct = before === 0
      ? (after === 0 ? 0 : 100)
      : Math.round(((after - before) / before) * 10000) / 100;
    deltas[metric] = { before, after, delta_pct };
    for (const rule of FLAG_RULES) {
      if (rule.metric === metric && delta_pct > rule.above) flags.add(rule.flag);
    }
  }
  const spendDown = deltas.cost_usd_real && deltas.cost_usd_real.delta_pct < 0;
  const fasterOrSame = deltas.duration_seconds && deltas.duration_seconds.delta_pct <= 0;
  if (spendDown && fasterOrSame) flags.add('improved');
  return { deltas, flags: [...flags].sort() };
}

// The known double-count bug class inflates duration; a run "longer" than 5x
// its own selection window is suspect. Warn, never fail — the run is still
// recorded, but the operator sees the caveat before trusting any delta.
export function durationWarning(metrics, opts) {
  if (!opts.since) return null;
  const until = opts.until ? Date.parse(opts.until) + 24 * 3600 * 1000 : Date.now();
  const windowSeconds = (until - Date.parse(opts.since)) / 1000;
  if (windowSeconds > 0 && metrics.duration_seconds > windowSeconds * 5) {
    return `WARN: duration_seconds (${metrics.duration_seconds}) exceeds 5x the selection window (${Math.round(windowSeconds)}s) — possible session double-count; treat deltas as soft`;
  }
  return null;
}

export function buildRun(sessions, opts) {
  const { metrics, sources } = summarize(sessions);
  const warning = durationWarning(metrics, opts);
  return {
    run_id: newId('run'),
    loop_id: opts.loop,
    captured_at: new Date().toISOString(),
    sources,
    session_ids: sessions.map((s) => s.session_id),
    correlation_id: opts.correlation || null,
    project: opts.project || null,
    git_branch: null,
    metrics,
    artifacts: [],
    notes: warning,
  };
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
    opts.loop = resolveLoopId(opts);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  const all = JSON.parse(readFileSync(SESSIONS_PATH, 'utf8'));
  const sessions = selectSessions(all, opts);
  if (sessions.length === 0) {
    console.error('no sessions matched the selection — nothing captured');
    process.exit(1);
  }
  const run = appendRecord('run', buildRun(sessions, opts));
  if (run.notes) console.warn(run.notes);
  console.log(`captured ${run.run_id} (${run.loop_id}): ${JSON.stringify(run.metrics)}`);

  if (opts.baseline) {
    const baseline = readLedger('run').find((r) => r.run_id === opts.baseline);
    if (!baseline) {
      console.error(`baseline run ${opts.baseline} not found in the ledger`);
      process.exit(1);
    }
    const { deltas, flags } = compareRuns(baseline, run);
    const comparison = appendRecord('comparison', {
      comparison_id: newId('cmp'),
      run_id: run.run_id,
      baseline_run_id: baseline.run_id,
      loop_id: run.loop_id,
      computed_at: new Date().toISOString(),
      deltas,
      flags,
    });
    console.log(`compared vs ${baseline.run_id}: flags=[${comparison.flags.join(', ')}]`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
