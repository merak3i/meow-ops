#!/usr/bin/env node
// Deterministic Loop Engineering proposer.
//
// This is the first assistant layer: it reads only local repo/ledger facts,
// emits complete draft proposals, and advances deterministic rules to
// pending_approval. LLM enrichment is explicit via --ai, budget-capped, and
// still reads/writes only metadata through the ledger choke point.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  appendRecord, assertRedacted, newId, readLedger,
} from './loop-ledger.mjs';
import { checkGitignore } from './loop-eval.mjs';
import { callLlm } from './llm-gateway.mjs';
import {
  hasOpenProposalForLoop, hasOpenProposalForRule, latestProposals,
} from './loop-proposal-helpers.mjs';

export { hasOpenProposalForLoop, hasOpenProposalForRule } from './loop-proposal-helpers.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..');
const LOOP_ID = 'meow-ops-guardrails';
const DAY_MS = 86_400_000;
const STALE_DRAFT_DAYS = 14;
const IMPROVE_TEMPLATE = join(REPO_ROOT, 'prompts', 'loop', 'improve.md');
const Z_THRESHOLD = 2.5;
const FLAG_METRICS = {
  cost_spike: 'cost_usd_real',
  error_spike: 'tool_error_count',
  slower: 'duration_seconds',
};
const PUBLIC_DATA_RULE = 'public/data/*';
const DEMO_NEGATIONS = [
  '!public/data/demo-cost-summary.json',
  '!public/data/demo-sessions.json',
  '!public/data/demo-superadmin-usage.json',
];

function iso(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function relativePath(repoRoot, target) {
  const rel = relative(repoRoot, target);
  if (!rel || rel.startsWith('..')) return target;
  return rel;
}

function safeReadJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function safeReadText(path) {
  return readFileSync(path, 'utf8');
}

function numberOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function hasProposalForComparison(comparisonId, records = readLedger('proposal')) {
  return latestProposals(records)
    .some((proposal) => proposal.comparison_id === comparisonId);
}

function baseProposal({
  ruleId, loopId = LOOP_ID, now, category, title, onePercentTarget, diff, rationale, evidence,
  confidence, risk, riskNotes, expectedBenefit, rollbackPlan, reviewOnly,
}) {
  const record = {
    proposal_id: newId('prop'),
    loop_id: loopId,
    created_at: iso(now),
    created_by: 'assistant:risk',
    category,
    title,
    one_percent_target: onePercentTarget,
    diff,
    rationale,
    evidence: [
      { kind: 'rule', ref: ruleId },
      ...evidence,
    ],
    confidence,
    risk,
    risk_notes: riskNotes,
    expected_benefit: expectedBenefit,
    rollback: { plan: rollbackPlan },
    review_only: reviewOnly,
    status: 'draft',
  };
  assertRedacted(record, 'proposal');
  return record;
}

function costSummaryRows(repoRoot) {
  const path = join(repoRoot, 'public', 'data', 'cost-summary.json');
  if (!existsSync(path)) return [];
  let parsed;
  try {
    parsed = safeReadJson(path);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed.daily_summary)) return [];
  return parsed.daily_summary
    .filter((row) => row && typeof row.date === 'string')
    .sort((a, b) => a.date.localeCompare(b.date));
}

function latestWithTrailing(rows, metric) {
  const candidates = rows
    .map((row) => ({ row, value: numberOrNull(row[metric]) }))
    .filter((item) => item.value !== null);
  if (candidates.length < 2) return null;
  const latest = candidates.at(-1);
  const trailing = candidates.slice(Math.max(0, candidates.length - 15), -1);
  if (!latest || trailing.length === 0) return null;
  return { latest, trailing };
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function zScore(value, values) {
  const avg = mean(values);
  const variance = values.reduce((sum, item) => sum + (item - avg) ** 2, 0) / values.length;
  const std = Math.sqrt(variance);
  return { mean: avg, std, z: std > 0 ? (value - avg) / std : 0 };
}

export function spendVelocityProposal({ repoRoot = REPO_ROOT, now = new Date() } = {}) {
  const sample = latestWithTrailing(costSummaryRows(repoRoot), 'estimated_cost_usd');
  if (!sample) return null;
  const trailingCosts = sample.trailing.map((item) => item.value);
  const stats = zScore(sample.latest.value, trailingCosts);
  if (!(stats.z > Z_THRESHOLD)) return null;
  return baseProposal({
    ruleId: 'spend-velocity',
    now,
    category: 'workflow',
    title: 'Review spend velocity spike',
    onePercentTarget: 'Catch a daily spend spike before it becomes the new operating baseline',
    diff: {
      target_path: 'public/data/cost-summary.json',
      date: sample.latest.row.date,
      estimated_cost_usd: sample.latest.value,
      trailing_14_day_mean: Number(stats.mean.toFixed(4)),
      z_score: Number(stats.z.toFixed(2)),
    },
    rationale: `latest daily estimated_cost_usd is ${Number(stats.z.toFixed(2))} standard deviations above the trailing 14-day mean`,
    evidence: [
      { kind: 'metric', ref: 'estimated_cost_usd', value: Number(sample.latest.value.toFixed(4)) },
      { kind: 'metric', ref: 'trailing-14-day-mean', value: Number(stats.mean.toFixed(4)) },
      { kind: 'metric', ref: 'z-score', value: Number(stats.z.toFixed(2)) },
    ],
    confidence: 0.78,
    risk: 'medium',
    riskNotes: 'local daily_summary spend only; no session content inspected',
    expectedBenefit: 'focuses the weekly review on real spend velocity before manual changes compound it',
    rollbackPlan: 'Reject this alert if the spike maps to intentional operator work',
    reviewOnly: false,
  });
}

export function ghostSpikeProposal({ repoRoot = REPO_ROOT, now = new Date() } = {}) {
  const sample = latestWithTrailing(costSummaryRows(repoRoot), 'ghost_count');
  if (!sample) return null;
  const trailingGhosts = sample.trailing.map((item) => item.value);
  const trailingMean = mean(trailingGhosts);
  const threshold = Math.max(5, trailingMean * 3);
  if (!(sample.latest.value > threshold)) return null;
  return baseProposal({
    ruleId: 'ghost-spike',
    now,
    category: 'workflow',
    title: 'Investigate ghost session spike',
    onePercentTarget: 'Stop empty or low-signal sessions from crowding out useful operator context',
    diff: {
      target_path: 'public/data/cost-summary.json',
      date: sample.latest.row.date,
      ghost_count: sample.latest.value,
      trailing_14_day_mean: Number(trailingMean.toFixed(2)),
      threshold: Number(threshold.toFixed(2)),
    },
    rationale: `latest ghost_count is ${sample.latest.value}, above max(5, 3x trailing mean ${Number(trailingMean.toFixed(2))})`,
    evidence: [
      { kind: 'metric', ref: 'ghost_count', value: sample.latest.value },
      { kind: 'metric', ref: 'trailing-14-day-mean', value: Number(trailingMean.toFixed(2)) },
    ],
    confidence: 0.74,
    risk: 'medium',
    riskNotes: 'local daily_summary ghost counts only; no session content inspected',
    expectedBenefit: 'keeps the review queue pointed at useful work instead of empty sessions',
    rollbackPlan: 'Reject this alert if the ghost spike is a known one-off import artifact',
    reviewOnly: false,
  });
}

function isRecentWarnRun(run, now) {
  if (!run || typeof run.notes !== 'string' || !run.notes.startsWith('WARN:')) return false;
  const captured = Date.parse(run.captured_at || '');
  if (!Number.isFinite(captured)) return false;
  const ageMs = new Date(now).getTime() - captured;
  return ageMs >= 0 && ageMs <= 7 * DAY_MS;
}

export function durationAnomalyProposal({ now = new Date(), runs = readLedger('run') } = {}) {
  const run = runs
    .filter((candidate) => isRecentWarnRun(candidate, now))
    .sort((a, b) => b.captured_at.localeCompare(a.captured_at))[0] || null;
  if (!run) return null;
  return baseProposal({
    ruleId: 'duration-anomaly',
    loopId: run.loop_id,
    now,
    category: 'workflow',
    title: `${run.loop_id}: investigate duration sanity warning`,
    onePercentTarget: 'Keep loop duration metrics trustworthy by checking suspected double-counted sessions',
    diff: {
      run_id: run.run_id,
      captured_at: run.captured_at,
      summary: 'Review session dedupe and capture window logic for this warned run',
    },
    rationale: `run ${run.run_id} tripped the capture duration WARN bound in the last 7 days`,
    evidence: [
      { kind: 'run', ref: run.run_id },
    ],
    confidence: 0.8,
    risk: 'medium',
    riskNotes: 'duration sanity warning from ledger run notes; no session content inspected',
    expectedBenefit: 'prevents bad duration deltas from driving the weekly operator queue',
    rollbackPlan: 'Reject this alert if the WARN was expected for this run window',
    reviewOnly: false,
  });
}

export function staleRateLimitsProposal({ repoRoot = REPO_ROOT, now = new Date() } = {}) {
  const path = join(repoRoot, 'public', 'data', 'rate-limits.json');
  if (!existsSync(path)) return null;
  let parsed;
  try {
    parsed = safeReadJson(path);
  } catch {
    return null;
  }
  const updatedAt = Date.parse(parsed._updated || '');
  if (!Number.isFinite(updatedAt)) return null;
  const ageDays = Math.floor((new Date(now).getTime() - updatedAt) / 86_400_000);
  if (ageDays <= 7) return null;
  return baseProposal({
    ruleId: 'stale-rate-limits',
    now,
    category: 'workflow',
    title: 'Refresh stale rate-limit metadata',
    onePercentTarget: 'Keep the rate-limit panel from making decisions with stale provider metadata',
    diff: {
      target_path: 'public/data/rate-limits.json',
      before: `_updated: ${parsed._updated}`,
      after: 'Refresh the local rate-limit snapshot or remove the stale panel dependency',
    },
    rationale: `rate-limits.json is ${ageDays} days old; the guardrail treats anything older than 7 days as stale`,
    evidence: [
      { kind: 'metric', ref: 'rate-limit-age-days', value: ageDays },
      { kind: 'file', ref: 'public/data/rate-limits.json', value: `_updated ${parsed._updated}` },
    ],
    confidence: 0.82,
    risk: 'low',
    riskNotes: 'local metadata refresh only; no production writes',
    expectedBenefit: 'reduces stale-capacity false confidence in operator review',
    rollbackPlan: 'Restore the previous local rate-limits snapshot if the refreshed metadata is wrong',
    reviewOnly: false,
  });
}

function correctedGitignore(raw) {
  const lines = raw.split('\n');
  const kept = lines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('!')) return true;
    if (trimmed.includes('demo-')) return true;
    return !/loop|sessions\.json|cost-summary|rate-limits/.test(trimmed);
  });
  if (!kept.map((line) => line.trim()).includes(PUBLIC_DATA_RULE)) {
    kept.push(PUBLIC_DATA_RULE);
  }
  for (const negation of DEMO_NEGATIONS) {
    if (!kept.map((line) => line.trim()).includes(negation)) kept.push(negation);
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '\n');
}

export function trackedDataRegressionProposal({ repoRoot = REPO_ROOT, now = new Date() } = {}) {
  try {
    checkGitignore(repoRoot);
    return null;
  } catch (err) {
    const gitignore = join(repoRoot, '.gitignore');
    const before = existsSync(gitignore) ? readFileSync(gitignore, 'utf8') : '';
    const after = correctedGitignore(before);
    return baseProposal({
      ruleId: 'tracked-data-regression',
      now,
      category: 'policy',
      title: 'Restore the public data tracking guard',
      onePercentTarget: 'Prevent real local session data from becoming git-trackable',
      diff: {
        target_path: '.gitignore',
        before,
        after,
      },
      rationale: `gitignore-guard failed: ${err.message}`,
      evidence: [
        { kind: 'check', ref: 'gitignore-guard', value: err.message },
      ],
      confidence: 0.94,
      risk: 'high',
      riskNotes: 'public data guardrail regression can expose local-only generated files',
      expectedBenefit: 'keeps the repo privacy boundary enforced before any commit or PR',
      rollbackPlan: 'Restore the previous .gitignore if the correction blocks required synthetic demo files',
      reviewOnly: true,
    });
  }
}

function plistStrings(text) {
  const matches = [...text.matchAll(/<string>([^<]+)<\/string>/g)];
  return matches.map((match) => match[1].trim());
}

function resolveTemplatePath(repoRoot, value) {
  if (value === 'YOUR_REPO_PATH') return repoRoot;
  if (value.startsWith('YOUR_REPO_PATH/')) return join(repoRoot, value.slice('YOUR_REPO_PATH/'.length));
  if (value.startsWith('/')) return value;
  if (value.startsWith('sync/')) return join(repoRoot, value);
  return null;
}

function pathLabel(repoRoot, value, resolved) {
  if (value.startsWith('YOUR_REPO_PATH/')) return value.slice('YOUR_REPO_PATH/'.length);
  if (value === 'YOUR_REPO_PATH') return '.';
  if (resolved) return relativePath(repoRoot, resolved);
  return value;
}

function scanPlistReferences(repoRoot, plistRel) {
  const plistPath = join(repoRoot, plistRel);
  if (!existsSync(plistPath)) return [{ source: plistRel, ref: plistRel, reason: 'plist-file-missing' }];
  const text = readFileSync(plistPath, 'utf8');
  const missing = [];
  for (const value of plistStrings(text)) {
    if (value.includes(':')) continue; // PATH lists and URLs are not single file references.
    const resolved = resolveTemplatePath(repoRoot, value);
    if (!resolved) continue;
    const label = pathLabel(repoRoot, value, resolved);
    const isLogPath = /Standard(Out|Error)Path/.test(text.slice(Math.max(0, text.indexOf(value) - 80), text.indexOf(value)));
    const checkPath = isLogPath ? dirname(resolved) : resolved;
    if (!existsSync(checkPath)) {
      missing.push({ source: plistRel, ref: label, reason: isLogPath ? 'log-parent-missing' : 'path-missing' });
    }
  }
  return missing;
}

function scanLocalApiSpawnTargets(repoRoot) {
  const apiRel = 'sync/local-api.mjs';
  const apiPath = join(repoRoot, apiRel);
  if (!existsSync(apiPath)) return [{ source: apiRel, ref: apiRel, reason: 'local-api-missing' }];
  const text = readFileSync(apiPath, 'utf8');
  const missing = [];
  for (const match of text.matchAll(/spawn\(NODE,\s*\[join\(ROOT,\s*'sync',\s*'([^']+)'\)/g)) {
    const scriptRel = join('sync', match[1]);
    const scriptPath = join(repoRoot, scriptRel);
    if (!existsSync(scriptPath)) missing.push({ source: apiRel, ref: scriptRel, reason: 'spawn-target-missing' });
  }
  return missing;
}

export function scanDanglingAutomationPaths({ repoRoot = REPO_ROOT } = {}) {
  const plists = ['sync/com.meowops.localapi.plist', 'sync/launchd-example.plist'];
  return [
    ...plists.flatMap((plist) => scanPlistReferences(repoRoot, plist)),
    ...scanLocalApiSpawnTargets(repoRoot),
  ];
}

export function danglingAutomationProposal({ repoRoot = REPO_ROOT, now = new Date() } = {}) {
  const missing = scanDanglingAutomationPaths({ repoRoot });
  if (missing.length === 0) return null;
  const first = missing[0];
  return baseProposal({
    ruleId: 'dangling-automation-paths',
    now,
    category: 'workflow',
    title: 'Repair dangling local automation references',
    onePercentTarget: 'Keep launchd/local API automation references aligned with files that exist',
    diff: {
      target_path: first.source.endsWith('.plist') ? first.source : 'sync/local-api.mjs',
      before: missing.map((item) => `${item.source}: ${item.ref} (${item.reason})`).join('\n'),
      after: 'Update or remove the dangling references so every local automation path resolves',
    },
    rationale: `${missing.length} local automation reference(s) point at paths that are not present`,
    evidence: [
      { kind: 'check', ref: 'missing-automation-paths', value: missing.length },
      { kind: 'file', ref: first.source, value: first.ref },
    ],
    confidence: 0.76,
    risk: 'medium',
    riskNotes: 'automation templates and local helper spawn paths are operational guardrails',
    expectedBenefit: 'reduces silent local automation drift before the next weekly loop review',
    rollbackPlan: 'Revert the automation reference edits if the operator confirms the path is intentionally external',
    reviewOnly: true,
  });
}

export function collectCandidates(options = {}) {
  const rules = [
    ['stale-rate-limits', staleRateLimitsProposal],
    ['tracked-data-regression', trackedDataRegressionProposal],
    ['dangling-automation-paths', danglingAutomationProposal],
    ['spend-velocity', spendVelocityProposal],
    ['ghost-spike', ghostSpikeProposal],
    ['duration-anomaly', durationAnomalyProposal],
  ];
  return rules.map(([ruleId, fn]) => ({ ruleId, proposal: fn(options) }));
}

function numericDelta(delta) {
  if (!delta || typeof delta !== 'object') return null;
  const before = Number(delta.before);
  const after = Number(delta.after);
  const deltaPct = Number(delta.delta_pct);
  if (![before, after, deltaPct].every(Number.isFinite)) return null;
  return { before, after, delta_pct: deltaPct };
}

function topFlaggedDelta(comparison) {
  const flaggedMetrics = (comparison.flags || [])
    .map((flag) => FLAG_METRICS[String(flag)])
    .filter((metric) => metric && comparison.deltas?.[metric]);
  const metricNames = flaggedMetrics.length > 0
    ? flaggedMetrics
    : Object.keys(comparison.deltas || {});
  return metricNames
    .map((metric) => ({ metric, delta: numericDelta(comparison.deltas[metric]) }))
    .filter((item) => item.delta)
    .sort((a, b) => Math.abs(b.delta.delta_pct) - Math.abs(a.delta.delta_pct) || a.metric.localeCompare(b.metric))[0] || null;
}

function topFlagForMetric(flags, metric) {
  return (flags || []).find((flag) => FLAG_METRICS[String(flag)] === metric)
    || String((flags || [])[0] || 'flagged');
}

export function comparisonSkeletonProposal(comparison, { now = new Date() } = {}) {
  if (!Array.isArray(comparison.flags) || comparison.flags.length === 0) return null;
  const top = topFlaggedDelta(comparison);
  if (!top) return null;
  const topFlag = topFlagForMetric(comparison.flags, top.metric);
  const record = {
    proposal_id: newId('prop'),
    loop_id: comparison.loop_id,
    run_id: comparison.run_id,
    comparison_id: comparison.comparison_id,
    created_at: iso(now),
    created_by: 'assistant:loop',
    category: 'workflow',
    title: `${comparison.loop_id}: ${topFlag} vs baseline`,
    one_percent_target: `${top.metric} moved ${top.delta.delta_pct}% vs baseline; investigate whether a 1% loop improvement is available`,
    diff: {
      summary: 'Draft comparison skeleton; complete the recommended action manually before owner approval.',
      before: top.delta.before,
      after: top.delta.after,
      metric: top.metric,
      delta_pct: top.delta.delta_pct,
    },
    rationale: `comparison ${comparison.comparison_id} emitted ${comparison.flags.length} flag(s): ${comparison.flags.join(', ')}`,
    evidence: [
      { kind: 'comparison', ref: comparison.comparison_id },
      {
        kind: 'metric',
        ref: top.metric,
        before: top.delta.before,
        after: top.delta.after,
        delta_pct: top.delta.delta_pct,
      },
    ],
    confidence: 0.4,
    risk: 'low',
    risk_notes: 'draft context only; operator must complete the proposal before approval',
    expected_benefit: 'turns flagged run deltas into visible review context without auto-advancing a decision',
    rollback: { plan: 'n/a — investigation skeleton' },
    review_only: false,
    status: 'draft',
  };
  assertRedacted(record, 'proposal');
  return record;
}

function comparisonLlmVars(comparison) {
  const top = topFlaggedDelta(comparison);
  const metrics = top ? {
    primary_metric: top.metric,
    before: top.delta.before,
    after: top.delta.after,
    delta_pct: top.delta.delta_pct,
  } : {};
  return {
    loop_id: comparison.loop_id,
    metrics,
    deltas: comparison.deltas || {},
    flags: comparison.flags || [],
  };
}

function withLlmDraft(proposal, draft) {
  return {
    ...proposal,
    one_percent_target: draft.one_percent_target,
    rationale: draft.rationale,
    expected_benefit: draft.expected_benefit,
    evidence: [
      ...proposal.evidence,
      { kind: 'llm', ref: 'deepseek:deepseek-chat' },
    ],
  };
}

export function appendComparisonSkeletons({ now = new Date(), comparisons = readLedger('comparison') } = {}) {
  const results = [];
  for (const comparison of comparisons) {
    if (!Array.isArray(comparison.flags) || comparison.flags.length === 0) {
      results.push({ comparison_id: comparison.comparison_id, loop_id: comparison.loop_id, status: 'clear', proposal_id: null });
      continue;
    }
    if (hasProposalForComparison(comparison.comparison_id)) {
      results.push({ comparison_id: comparison.comparison_id, loop_id: comparison.loop_id, status: 'skipped-existing', proposal_id: null });
      continue;
    }
    if (hasOpenProposalForLoop(comparison.loop_id)) {
      results.push({ comparison_id: comparison.comparison_id, loop_id: comparison.loop_id, status: 'skipped-open', proposal_id: null });
      continue;
    }
    const proposal = comparisonSkeletonProposal(comparison, { now });
    if (!proposal) {
      results.push({ comparison_id: comparison.comparison_id, loop_id: comparison.loop_id, status: 'clear', proposal_id: null });
      continue;
    }
    const stored = appendRecord('proposal', proposal);
    results.push({ comparison_id: comparison.comparison_id, loop_id: comparison.loop_id, status: 'skeleton', proposal_id: stored.proposal_id });
  }
  return results;
}

export async function appendComparisonSkeletonsWithAi({
  now = new Date(),
  comparisons = readLedger('comparison'),
  ai = false,
  noAi = false,
  env = process.env,
  transport = globalThis.fetch,
} = {}) {
  const results = [];
  const shouldUseAi = ai === true && noAi !== true;
  const template = shouldUseAi ? safeReadText(IMPROVE_TEMPLATE) : null;
  for (const comparison of comparisons) {
    if (!Array.isArray(comparison.flags) || comparison.flags.length === 0) {
      results.push({ comparison_id: comparison.comparison_id, loop_id: comparison.loop_id, status: 'clear', proposal_id: null });
      continue;
    }
    if (hasProposalForComparison(comparison.comparison_id)) {
      results.push({ comparison_id: comparison.comparison_id, loop_id: comparison.loop_id, status: 'skipped-existing', proposal_id: null });
      continue;
    }
    if (hasOpenProposalForLoop(comparison.loop_id)) {
      results.push({ comparison_id: comparison.comparison_id, loop_id: comparison.loop_id, status: 'skipped-open', proposal_id: null });
      continue;
    }
    const proposal = comparisonSkeletonProposal(comparison, { now });
    if (!proposal) {
      results.push({ comparison_id: comparison.comparison_id, loop_id: comparison.loop_id, status: 'clear', proposal_id: null });
      continue;
    }
    let enriched = null;
    let llmStatus = null;
    if (shouldUseAi) {
      const llm = await callLlm({
        template,
        vars: comparisonLlmVars(comparison),
        env,
        transport,
        now,
      });
      if (llm?.draft) enriched = withLlmDraft(proposal, llm.draft);
    }
    if (enriched) {
      try {
        const stored = appendRecord('proposal', enriched);
        results.push({ comparison_id: comparison.comparison_id, loop_id: comparison.loop_id, status: 'skeleton-enriched', proposal_id: stored.proposal_id });
        continue;
      } catch {
        // Malicious or malformed LLM text must die at appendRecord(). The
        // deterministic skeleton still ships, with no LLM output persisted.
        llmStatus = 'rejected';
      }
    }
    const stored = appendRecord('proposal', proposal);
    results.push({ comparison_id: comparison.comparison_id, loop_id: comparison.loop_id, status: 'skeleton', proposal_id: stored.proposal_id, llm_status: llmStatus });
  }
  return results;
}

function advanceDeterministicProposal(draft) {
  const simulated = appendRecord('proposal', {
    ...draft,
    created_by: 'system:propose',
    risk_notes: `${draft.risk_notes}; deterministic rule - simulation not applicable`,
    status: 'simulated',
  });
  const pending = appendRecord('proposal', {
    ...simulated,
    created_by: 'system:propose',
    status: 'pending_approval',
  });
  return { draft, simulated, pending };
}

export function expireStaleDrafts({ now = new Date(), proposals = readLedger('proposal') } = {}) {
  const results = [];
  const cutoff = new Date(now).getTime() - STALE_DRAFT_DAYS * DAY_MS;
  for (const proposal of latestProposals(proposals)) {
    if (proposal.status !== 'draft') continue;
    const created = Date.parse(proposal.created_at || '');
    if (!Number.isFinite(created) || created > cutoff) continue;

    // This is the one non-owner decision author: loop:propose may expire
    // untouched stale drafts so they leave the active owner queue without
    // pretending a human rejected them.
    const decision = appendRecord('decision', {
      decision_id: newId('dec'),
      proposal_id: proposal.proposal_id,
      decided_at: iso(now),
      decision: 'rejected',
      decided_by: 'system:expire',
      created_by: 'system:expire',
      reason: 'expired stale draft',
    });
    const expired = appendRecord('proposal', {
      ...proposal,
      created_by: 'system:expire',
      status: 'rejected',
    });
    results.push({ proposal_id: proposal.proposal_id, decision_id: decision.decision_id, status: expired.status });
  }
  return results;
}

export function runProposer(options = {}) {
  const results = [];
  for (const expired of expireStaleDrafts({ now: options.now })) {
    results.push({ ruleId: `expire:${expired.proposal_id}`, status: 'expired', proposal_id: expired.proposal_id });
  }
  for (const { ruleId, proposal } of collectCandidates(options)) {
    if (!proposal) {
      results.push({ ruleId, status: 'clear', proposal_id: null });
      continue;
    }
    if (hasOpenProposalForLoop(proposal.loop_id)) {
      results.push({ ruleId, status: 'skipped-open', proposal_id: null });
      continue;
    }
    const draft = appendRecord('proposal', proposal);
    const { pending } = advanceDeterministicProposal(draft);
    results.push({ ruleId, status: 'fired', proposal_id: pending.proposal_id });
  }
  for (const result of appendComparisonSkeletons({ now: options.now })) {
    results.push({
      ruleId: `comparison:${result.comparison_id}`,
      status: result.status,
      proposal_id: result.proposal_id,
    });
  }
  return results;
}

export async function runProposerWithAi(options = {}) {
  const results = [];
  for (const expired of expireStaleDrafts({ now: options.now })) {
    results.push({ ruleId: `expire:${expired.proposal_id}`, status: 'expired', proposal_id: expired.proposal_id });
  }
  for (const { ruleId, proposal } of collectCandidates(options)) {
    if (!proposal) {
      results.push({ ruleId, status: 'clear', proposal_id: null });
      continue;
    }
    if (hasOpenProposalForLoop(proposal.loop_id)) {
      results.push({ ruleId, status: 'skipped-open', proposal_id: null });
      continue;
    }
    const draft = appendRecord('proposal', proposal);
    const { pending } = advanceDeterministicProposal(draft);
    results.push({ ruleId, status: 'fired', proposal_id: pending.proposal_id });
  }
  for (const result of await appendComparisonSkeletonsWithAi({
    now: options.now,
    ai: options.ai,
    noAi: options.noAi,
    env: options.env,
    transport: options.transport,
  })) {
    results.push({
      ruleId: `comparison:${result.comparison_id}`,
      status: result.status,
      proposal_id: result.proposal_id,
    });
  }
  return results;
}

function parseCliArgs(argv) {
  const opts = { ai: false, noAi: false };
  for (const arg of argv) {
    if (arg === '--ai') opts.ai = true;
    else if (arg === '--no-ai') opts.noAi = true;
    else throw new Error(`unknown flag ${arg}`);
  }
  return opts;
}

async function main() {
  const opts = parseCliArgs(process.argv.slice(2));
  const results = opts.ai || opts.noAi
    ? await runProposerWithAi(opts)
    : runProposer({});
  for (const result of results) {
    const suffix = result.proposal_id ? ` ${result.proposal_id}` : '';
    console.log(`${result.ruleId}: ${result.status}${suffix}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}
