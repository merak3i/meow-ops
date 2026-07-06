// Mirrors sync/loop-schema.mjs ALLOWED_FIELDS. Keep field names in sync by
// comment reference only; the browser bundle must not import sync/ modules.

export type ProposalStatus =
  | 'draft'
  | 'simulated'
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'applied'
  | 'rolled_back';

export type DecisionValue = 'approved' | 'rejected' | 'deferred' | 'undone';

export type ProposalCategory =
  | 'prompt'
  | 'skill'
  | 'rubric'
  | 'test'
  | 'ui'
  | 'workflow'
  | 'policy';

export interface LoopRun {
  schema_version: number;
  run_id: string;
  loop_id: string;
  captured_at: string;
  sources: string[];
  session_ids: string[];
  correlation_id?: string | null;
  project?: string | null;
  git_branch?: string | null;
  metrics: {
    sessions?: number;
    duration_seconds: number;
    total_tokens: number;
    message_count: number;
    cost_usd_real?: number;
    cost_usd_notional?: number;
    tool_error_count?: number;
    [key: string]: unknown;
  };
  artifacts?: unknown;
  notes?: string | null;
}

export interface Comparison {
  schema_version: number;
  comparison_id: string;
  run_id: string;
  baseline_run_id: string;
  loop_id: string;
  computed_at?: string;
  deltas: Record<string, ComparisonDelta | unknown>;
  flags: unknown[];
}

export interface ComparisonDelta {
  before: number;
  after: number;
  delta_pct: number;
}

export interface ProposalDiff {
  target_path?: string;
  summary?: string;
  patch?: string;
  before?: unknown;
  after?: unknown;
  [key: string]: unknown;
}

export interface Proposal {
  schema_version: number;
  proposal_id: string;
  loop_id: string;
  run_id?: string;
  comparison_id?: string;
  created_at: string;
  created_by: string;
  category: ProposalCategory;
  title: string;
  one_percent_target: string;
  diff?: ProposalDiff | string;
  rationale?: string;
  evidence: unknown[];
  confidence?: number;
  risk?: string;
  risk_notes?: string;
  expected_benefit?: string;
  rollback: {
    plan: string;
    [key: string]: unknown;
  };
  review_only?: boolean;
  simulation_id?: string;
  status: ProposalStatus;
}

export interface Decision {
  schema_version: number;
  decision_id: string;
  proposal_id: string;
  decided_at: string;
  decision: DecisionValue;
  decided_by: string;
  reason?: string;
  undo_of?: string;
}

export interface SimulationResultItem {
  check: string;
  pass: boolean;
  note?: string;
  [key: string]: unknown;
}

export interface Simulation {
  schema_version: number;
  simulation_id: string;
  proposal_id: string;
  ran_at: string;
  mode: 'test-run' | 'checklist';
  results: SimulationResultItem[];
  pass: boolean;
}

export interface Outcome {
  schema_version: number;
  outcome_id: string;
  decision_id: string;
  loop_id: string;
  recorded_at: string;
  baseline_run_id: string;
  next_run_id: string;
  verdict: 'improved' | 'regressed' | 'neutral' | 'unknown';
  deltas: Record<string, ComparisonDelta | unknown>;
}

export interface LoopSummary {
  counts_by_status: Record<string, number>;
  open_per_loop: Record<string, number>;
  total: number;
}

export interface DecisionResult {
  ok: boolean;
  decision?: Decision;
  proposal?: Proposal;
  error?: string;
}
