#!/usr/bin/env node
// Deterministic Loop Engineering proposer.
//
// This is the first assistant layer: it reads only local repo/ledger facts,
// emits complete draft proposals, and advances deterministic rules to
// pending_approval. No LLM calls, no network, no real transcript content.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  appendRecord, assertRedacted, foldLatestById, newId, readLedger,
} from './loop-ledger.mjs';
import { checkGitignore } from './loop-eval.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..');
const LOOP_ID = 'meow-ops-guardrails';
const OPEN_TERMINAL = new Set(['approved', 'rejected']);
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

function latestProposals(records = readLedger('proposal')) {
  return foldLatestById(records, 'proposal_id');
}

function evidenceHasRule(proposal, ruleRef) {
  return Array.isArray(proposal.evidence)
    && proposal.evidence.some((item) => item && item.kind === 'rule' && item.ref === ruleRef);
}

export function hasOpenProposalForRule(ruleRef, records = readLedger('proposal')) {
  return latestProposals(records)
    .some((proposal) => !OPEN_TERMINAL.has(proposal.status) && evidenceHasRule(proposal, ruleRef));
}

function baseProposal({
  ruleId, now, category, title, onePercentTarget, diff, rationale, evidence,
  confidence, risk, riskNotes, expectedBenefit, rollbackPlan, reviewOnly,
}) {
  const record = {
    proposal_id: newId('prop'),
    loop_id: LOOP_ID,
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
  ];
  return rules.map(([ruleId, fn]) => ({ ruleId, proposal: fn(options) }));
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

export function runProposer(options = {}) {
  const results = [];
  for (const { ruleId, proposal } of collectCandidates(options)) {
    if (!proposal) {
      results.push({ ruleId, status: 'clear', proposal_id: null });
      continue;
    }
    if (hasOpenProposalForRule(ruleId)) {
      results.push({ ruleId, status: 'skipped-open', proposal_id: null });
      continue;
    }
    const draft = appendRecord('proposal', proposal);
    const { pending } = advanceDeterministicProposal(draft);
    results.push({ ruleId, status: 'fired', proposal_id: pending.proposal_id });
  }
  return results;
}

function main() {
  const results = runProposer({});
  for (const result of results) {
    const suffix = result.proposal_id ? ` ${result.proposal_id}` : '';
    console.log(`${result.ruleId}: ${result.status}${suffix}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
