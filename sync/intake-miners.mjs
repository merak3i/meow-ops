import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertRedacted, newId, readLedger } from './loop-ledger.mjs';
import { resolveIntakeDir } from './intake-local.mjs';
import { hasNonRejectedProposalForEvidenceRef } from './loop-proposal-helpers.mjs';

const LOOP_ID = 'meow-ops-guardrails';

function iso(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function labels(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item) : [];
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
    evidence: [{ kind: 'rule', ref: ruleId }, ...evidence],
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

export function readIntakeSummaries({ intakeDir, env } = {}) {
  const dir = intakeDir || resolveIntakeDir(env || process.env);
  const path = join(dir, 'summaries.jsonl');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
}

export function recurringFailureMiner({ summaries, proposals = readLedger('proposal'), now = new Date() }) {
  const counts = new Map();
  for (const summary of summaries) {
    for (const sig of labels(summary.failure_signatures)) {
      if (!counts.has(sig)) counts.set(sig, new Set());
      counts.get(sig).add(summary.session_id);
    }
  }
  return [...counts.entries()].filter(([, sessions]) => sessions.size >= 3)
    .filter(([sig]) => !hasNonRejectedProposalForEvidenceRef('intake-failure', sig, proposals))
    .map(([sig, sessions]) => baseProposal({
      ruleId: 'recurring-failure',
      now,
      category: 'workflow',
      title: `Recurring failure: ${sig}`,
      onePercentTarget: `Investigate "${sig}" which appeared in ${sessions.size} sessions`,
      diff: { source: 'intake-summaries', signature: sig, session_count: sessions.size },
      rationale: `failure signature "${sig}" recurred across ${sessions.size} distinct sessions`,
      evidence: [{ kind: 'intake-failure', ref: sig, value: sessions.size }],
      confidence: 0.65,
      risk: 'medium',
      riskNotes: 'content-free signature frequency only; no session content inspected',
      expectedBenefit: 'surfaces recurring tool/infra failures before they become invisible background noise',
      rollbackPlan: 'Reject if the failure is a known non-actionable noise signature',
      reviewOnly: true,
    }));
}

export function wastedWorkMiner({ summaries, proposals = readLedger('proposal'), now = new Date() }) {
  const counts = new Map();
  for (const summary of summaries) {
    for (const indicator of labels(summary.waste_indicators)) {
      if (!counts.has(indicator)) counts.set(indicator, new Set());
      counts.get(indicator).add(summary.session_id);
    }
  }
  return [...counts.entries()].filter(([, sessions]) => sessions.size >= 4)
    .filter(([indicator]) => !hasNonRejectedProposalForEvidenceRef('intake-waste', indicator, proposals))
    .map(([indicator, sessions]) => baseProposal({
      ruleId: 'wasted-work',
      now,
      category: 'workflow',
      title: `Repeated waste pattern: ${indicator}`,
      onePercentTarget: `Reduce "${indicator}" waste seen in ${sessions.size} sessions`,
      diff: { source: 'intake-summaries', indicator, session_count: sessions.size },
      rationale: `waste indicator "${indicator}" recurred across ${sessions.size} distinct sessions`,
      evidence: [{ kind: 'intake-waste', ref: indicator, value: sessions.size }],
      confidence: 0.62,
      risk: 'medium',
      riskNotes: 'content-free waste indicator frequency only; no session content inspected',
      expectedBenefit: 'turns repeated waste markers into reviewable workflow improvements',
      rollbackPlan: 'Reject if the waste indicator is expected or already accepted',
      reviewOnly: true,
    }));
}

export function highFrictionMiner({ summaries, proposals = readLedger('proposal'), now = new Date() }) {
  const byKind = new Map();
  for (const summary of summaries) {
    if ((summary.friction_score || 0) < 4 || typeof summary.task_kind !== 'string') continue;
    if (!byKind.has(summary.task_kind)) byKind.set(summary.task_kind, new Set());
    byKind.get(summary.task_kind).add(summary.session_id);
  }
  return [...byKind.entries()].filter(([, sessions]) => sessions.size >= 2)
    .filter(([kind]) => !hasNonRejectedProposalForEvidenceRef('intake-friction', kind, proposals))
    .map(([kind, sessions]) => baseProposal({
      ruleId: 'high-friction',
      now,
      category: 'workflow',
      title: `High friction in ${kind} sessions`,
      onePercentTarget: `${sessions.size} ${kind} sessions scored friction >=4; investigate tool or workflow improvement`,
      diff: { source: 'intake-summaries', task_kind: kind, high_friction_count: sessions.size },
      rationale: `${sessions.size} sessions with task_kind="${kind}" had friction_score >= 4`,
      evidence: [{ kind: 'intake-friction', ref: kind, value: sessions.size }],
      confidence: 0.55,
      risk: 'low',
      riskNotes: 'aggregate friction score only; no session content',
      expectedBenefit: 'focuses workflow improvement on the task types that cause the most operator friction',
      rollbackPlan: 'Reject if high friction for this task kind is expected or non-reducible',
      reviewOnly: true,
    }));
}

export function runIntakeMiners(options = {}) {
  const summaries = options.summaries || readIntakeSummaries(options);
  const proposals = options.proposals || readLedger('proposal');
  const now = options.now || new Date();
  const opts = { summaries, proposals, now };
  return [
    ...recurringFailureMiner(opts),
    ...wastedWorkMiner(opts),
    ...highFrictionMiner(opts),
  ];
}
