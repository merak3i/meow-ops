// Loop Engineering entity schemas and validators.
//
// Fail-loud plain validators in the style of parse-codex.mjs: every writer
// must pass these before a record reaches disk (see loop-ledger.mjs). Error
// messages carry a [rule-id] tag so tests and the eval runner can assert the
// exact reason a record was rejected without echoing record content.

export const SCHEMA_VERSION = 1;

export const ENTITIES = ['run', 'comparison', 'proposal', 'decision', 'simulation', 'outcome'];

// The only legal status walk. A proposal cannot skip states — in particular
// draft→approved without simulated + pending_approval is rejected at write
// time, which is what keeps "assistants are draft-only" structurally true.
export const STATUS_FLOW = {
  draft: ['simulated'],
  simulated: ['pending_approval'],
  pending_approval: ['approved', 'rejected'],
  approved: ['applied', 'pending_approval'],
  rejected: ['pending_approval'],
  applied: ['rolled_back'],
  rolled_back: [],
};

export const PROPOSAL_CATEGORIES = [
  'prompt', 'skill', 'rubric', 'test', 'ui', 'workflow', 'policy',
];

// Diff targets that force review_only — privacy / security / money /
// client-data / prod-infra surfaces. Generators cannot unset the flag: the
// validator rejects any record that violates this map.
export const REVIEW_ONLY_PATH_RE =
  /supabase|\.github|payment|razorpay|\.env|LaunchAgents|\.plist/i;

// Cost is two incompatible things (real Claude API-equivalent vs notional
// Codex subscription burn). They must never be summed; any field that looks
// like a sum is rejected outright.
const SUMMED_COST_KEY_RE = /^cost_usd_(total|combined|sum|all)$/i;

// Field allowlists. The serializer in loop-ledger.mjs DROPS anything not
// listed here, so a future writer cannot smuggle new free-text fields past
// redaction by accident.
export const ALLOWED_FIELDS = {
  run: [
    'schema_version', 'run_id', 'loop_id', 'captured_at', 'sources',
    'session_ids', 'correlation_id', 'project', 'git_branch', 'metrics',
    'artifacts', 'notes',
  ],
  comparison: [
    'schema_version', 'comparison_id', 'run_id', 'baseline_run_id', 'loop_id',
    'computed_at', 'deltas', 'flags',
  ],
  proposal: [
    'schema_version', 'proposal_id', 'loop_id', 'run_id', 'comparison_id',
    'created_at', 'created_by', 'category', 'title', 'one_percent_target',
    'diff', 'rationale', 'evidence', 'confidence', 'risk', 'risk_notes',
    'expected_benefit', 'rollback', 'review_only', 'simulation_id', 'status',
  ],
  decision: [
    'schema_version', 'decision_id', 'proposal_id', 'decided_at', 'decision',
    'decided_by', 'reason', 'undo_of',
  ],
  simulation: [
    'schema_version', 'simulation_id', 'proposal_id', 'ran_at', 'mode',
    'results', 'pass',
  ],
  outcome: [
    'schema_version', 'outcome_id', 'decision_id', 'loop_id', 'recorded_at',
    'baseline_run_id', 'next_run_id', 'verdict', 'deltas',
  ],
};

function fail(rule, message) {
  throw new Error(`[${rule}] ${message}`);
}

function req(record, field, type, entity) {
  const value = record[field];
  if (value === undefined || value === null || value === '') {
    fail('missing-field', `${entity} is missing required field "${field}"`);
  }
  if (type === 'array') {
    if (!Array.isArray(value)) fail('missing-field', `${entity}.${field} must be an array`);
  } else if (typeof value !== type) {
    fail('missing-field', `${entity}.${field} must be a ${type}`);
  }
  return value;
}

// Walks every key at every depth; used for the never-sum rule so a summed
// cost field cannot hide inside metrics or deltas.
function walkKeys(value, visit, path = '') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    const keyPath = path ? `${path}.${key}` : key;
    visit(key, keyPath);
    walkKeys(child, visit, keyPath);
  }
}

function rejectSummedCost(record, entity) {
  walkKeys(record, (key, keyPath) => {
    if (SUMMED_COST_KEY_RE.test(key)) {
      fail('summed-cost', `${entity}.${keyPath} sums real and notional cost — the two must never be combined`);
    }
  });
}

export function validateStatusTransition(from, to) {
  const nexts = STATUS_FLOW[from];
  if (!nexts) fail('status-flow', `unknown status "${from}"`);
  if (!nexts.includes(to)) {
    fail('status-flow', `illegal status transition "${from}" → "${to}"`);
  }
  return true;
}

export function validateLoopRun(record) {
  req(record, 'run_id', 'string', 'run');
  req(record, 'loop_id', 'string', 'run');
  req(record, 'captured_at', 'string', 'run');
  req(record, 'sources', 'array', 'run');
  req(record, 'session_ids', 'array', 'run');
  const metrics = req(record, 'metrics', 'object', 'run');
  for (const field of ['duration_seconds', 'total_tokens', 'message_count']) {
    if (typeof metrics[field] !== 'number') {
      fail('missing-field', `run.metrics.${field} must be a number`);
    }
  }
  rejectSummedCost(record, 'run');
  return record;
}

export function validateComparison(record) {
  req(record, 'comparison_id', 'string', 'comparison');
  req(record, 'run_id', 'string', 'comparison');
  req(record, 'baseline_run_id', 'string', 'comparison');
  req(record, 'loop_id', 'string', 'comparison');
  req(record, 'deltas', 'object', 'comparison');
  req(record, 'flags', 'array', 'comparison');
  rejectSummedCost(record, 'comparison');
  return record;
}

export function validateProposal(record) {
  req(record, 'proposal_id', 'string', 'proposal');
  req(record, 'loop_id', 'string', 'proposal');
  req(record, 'created_at', 'string', 'proposal');
  const createdBy = req(record, 'created_by', 'string', 'proposal');
  const category = req(record, 'category', 'string', 'proposal');
  req(record, 'title', 'string', 'proposal');
  req(record, 'one_percent_target', 'string', 'proposal');
  const evidence = req(record, 'evidence', 'array', 'proposal');
  const status = req(record, 'status', 'string', 'proposal');

  if (!PROPOSAL_CATEGORIES.includes(category)) {
    fail('category', `proposal.category "${category}" is not one of ${PROPOSAL_CATEGORIES.join('/')}`);
  }
  if (!Object.hasOwn(STATUS_FLOW, status)) {
    fail('status-flow', `proposal.status "${status}" is not a known status`);
  }
  if (evidence.length === 0) {
    fail('missing-field', 'proposal.evidence must contain at least one item');
  }
  if (!record.rollback || typeof record.rollback !== 'object' || !record.rollback.plan) {
    fail('rollback', 'proposal.rollback.plan is required — no proposal ships without an undo path');
  }

  // Assistants are draft-only. A record claiming assistant authorship with
  // any decided/advanced status is forged or buggy either way — reject it.
  if (createdBy.startsWith('assistant:') && status !== 'draft') {
    fail('assistant-status', `assistant-authored proposal must have status "draft", got "${status}"`);
  }

  const targetPath = record.diff && record.diff.target_path ? String(record.diff.target_path) : '';
  const needsReviewOnly = category === 'policy' || (targetPath && REVIEW_ONLY_PATH_RE.test(targetPath));
  if (needsReviewOnly && record.review_only !== true) {
    fail('review_only', `proposal touching a gated surface (category "${category}", target "${targetPath || 'n/a'}") must set review_only: true`);
  }

  rejectSummedCost(record, 'proposal');
  return record;
}

export function validateDecision(record) {
  req(record, 'decision_id', 'string', 'decision');
  req(record, 'proposal_id', 'string', 'decision');
  req(record, 'decided_at', 'string', 'decision');
  const decision = req(record, 'decision', 'string', 'decision');
  req(record, 'decided_by', 'string', 'decision');
  if (!['approved', 'rejected', 'deferred', 'undone'].includes(decision)) {
    fail('missing-field', `decision.decision "${decision}" must be approved/rejected/deferred/undone`);
  }
  return record;
}

export function validateSimulation(record) {
  req(record, 'simulation_id', 'string', 'simulation');
  req(record, 'proposal_id', 'string', 'simulation');
  req(record, 'ran_at', 'string', 'simulation');
  const mode = req(record, 'mode', 'string', 'simulation');
  const results = req(record, 'results', 'array', 'simulation');
  req(record, 'pass', 'boolean', 'simulation');
  if (!['test-run', 'checklist'].includes(mode)) {
    fail('simulation-mode', `simulation.mode "${mode}" must be test-run/checklist`);
  }
  if (results.length === 0) {
    fail('missing-field', 'simulation.results must contain at least one result');
  }
  for (const [index, result] of results.entries()) {
    if (!result || typeof result !== 'object') {
      fail('missing-field', `simulation.results[${index}] must be an object`);
    }
    if (typeof result.check !== 'string' || result.check.length === 0) {
      fail('missing-field', `simulation.results[${index}].check must be a string`);
    }
    if (typeof result.pass !== 'boolean') {
      fail('missing-field', `simulation.results[${index}].pass must be a boolean`);
    }
    if (result.note !== undefined && typeof result.note !== 'string') {
      fail('missing-field', `simulation.results[${index}].note must be a string`);
    }
  }
  rejectSummedCost(record, 'simulation');
  return record;
}

export function validateOutcome(record) {
  req(record, 'outcome_id', 'string', 'outcome');
  req(record, 'decision_id', 'string', 'outcome');
  req(record, 'loop_id', 'string', 'outcome');
  req(record, 'recorded_at', 'string', 'outcome');
  req(record, 'baseline_run_id', 'string', 'outcome');
  req(record, 'next_run_id', 'string', 'outcome');
  const verdict = req(record, 'verdict', 'string', 'outcome');
  req(record, 'deltas', 'object', 'outcome');
  if (!['improved', 'regressed', 'neutral', 'unknown'].includes(verdict)) {
    fail('outcome-verdict', `outcome.verdict "${verdict}" must be improved/regressed/neutral/unknown`);
  }
  rejectSummedCost(record, 'outcome');
  return record;
}

export const VALIDATORS = {
  run: validateLoopRun,
  comparison: validateComparison,
  proposal: validateProposal,
  decision: validateDecision,
  simulation: validateSimulation,
  outcome: validateOutcome,
};
