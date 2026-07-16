import type {
  Comparison, Decision, DecisionResult, LoopRun, LoopSummary, Outcome, Proposal, Simulation,
} from '@/types/loop';

export function fetchLoopProposals(): Promise<Proposal[]>;
export function fetchLoopDecisions(): Promise<Decision[]>;
export function fetchLoopRuns(): Promise<LoopRun[]>;
export function fetchLoopComparisons(): Promise<Comparison[]>;
export function fetchLoopSimulations(): Promise<Simulation[]>;
export function fetchLoopOutcomes(): Promise<Outcome[]>;
export function fetchLoopSummary(): Promise<LoopSummary>;
export interface DigestData {
  generated_at: string;
  period: { since: string; until: string };
  capture: { run_id: string | null; sessions: number };
  intake: { processed: number; stored: number; dropped: number; skipped: number };
  health: {
    agents_total: number;
    flagged: number;
    flags: string[];
    agents: Array<{
      label: string;
      running: boolean;
      last_exit_status: number | null;
      log_staleness_hours: number | null;
      flags: string[];
    }>;
  };
  proposals: { new_drafts: number; pending: number; total: number };
  notes?: string[];
}
export function fetchLoopDigest(): Promise<DigestData | null>;
export function fetchLoopDigestHistory(): Promise<DigestData[]>;
export function postLoopRunDigest(): Promise<{ ok: boolean; digest?: DigestData; error?: string } | null>;
export type KnowledgeGate = 'known_known' | 'known_unknown' | 'unknown_known' | 'unknown_unknown';
export interface ProjectLearningTarget {
  project_id?: string;
  project_name?: string;
  field: string;
}
export interface CompanionEvidence {
  kind: string;
  ref: string;
  detail: string;
}
export interface CompanionAnswer {
  ok: boolean;
  answer?: string;
  source?: 'keyword' | 'llm';
  gate?: KnowledgeGate;
  confidence?: number;
  evidence?: CompanionEvidence[];
  unknowns?: string[];
  next_question?: string;
  learning?: ProjectLearningTarget;
  claim_id?: string;
  claim_status?: 'inferred' | 'owner_confirmed' | 'stale' | 'contradicted';
  soul?: Pick<CompanionSoulProfile, 'name' | 'preset' | 'revision' | 'uncertainty_policy'> & {
    project_overlay?: Pick<CompanionProjectSoulOverlay, 'project_id' | 'project_name'> | null;
  };
  error?: string;
}
export function postLoopAsk(question: string): Promise<CompanionAnswer | null>;
export interface ProjectClaim {
  claim_id: string;
  project_id: string;
  project_name: string;
  field: string;
  value: string;
  status: 'inferred' | 'owner_confirmed' | 'stale' | 'contradicted';
  source: string;
}
export interface ProjectIntelligenceProject {
  id: string;
  name: string;
  matchNames: string[];
  facts: Record<string, ProjectClaim>;
}
export interface ProjectIntelligenceSnapshot {
  ok: boolean;
  projects: ProjectIntelligenceProject[];
  claim_count: number;
  session_count: number;
}
export function fetchProjectIntelligenceSnapshot(): Promise<ProjectIntelligenceSnapshot | null>;
export function postProjectClaim(input: {
  project_name: string;
  project_id?: string;
  field: string;
  value: string;
  supersedes?: string;
}): Promise<{ ok: boolean; claim?: ProjectClaim; error?: string } | null>;
export function postProjectConfirm(claim_id: string): Promise<{ ok: boolean; claim?: ProjectClaim; error?: string } | null>;
export type SoulPresetId = 'clear-operator' | 'warm-strategist' | 'critical-partner' | 'curious-explorer';
export type UncertaintyPolicy = 'strict' | 'evidence-led' | 'exploratory';
export type ResponseVerbosity = 'concise' | 'balanced' | 'detailed';
export type ResponseChallenge = 'gentle' | 'balanced' | 'direct';
export type ResponseExploration = 'focused' | 'balanced' | 'expansive';
export interface CompanionResponsePreferences {
  verbosity: ResponseVerbosity;
  challenge: ResponseChallenge;
  exploration: ResponseExploration;
}
export interface CompanionProjectResponsePreferences {
  verbosity: ResponseVerbosity | 'inherit';
  challenge: ResponseChallenge | 'inherit';
  exploration: ResponseExploration | 'inherit';
}
export interface SoulPreset {
  id: SoulPresetId;
  name: string;
  description: string;
  instruction: string;
}
export interface CompanionProjectSoulOverlay {
  project_id: string;
  project_name: string;
  enabled: boolean;
  preset: SoulPresetId | 'inherit';
  custom_instructions: string;
  response_preferences: CompanionProjectResponsePreferences;
}
export interface CompanionSoulProfile {
  schema_version: 3;
  profile_id: 'primary';
  revision: number;
  updated_at: string | null;
  name: string;
  preset: SoulPresetId;
  custom_instructions: string;
  response_preferences: CompanionResponsePreferences;
  uncertainty_policy: UncertaintyPolicy;
  memory: {
    session_metrics: boolean;
    project_facts: boolean;
    inferred_claims: boolean;
  };
  model_synthesis: boolean;
  project_overlays: CompanionProjectSoulOverlay[];
}
export interface CompanionSoulResponse {
  ok: boolean;
  profile?: CompanionSoulProfile;
  presets?: SoulPreset[];
  error?: string;
}
export function fetchCompanionSoul(): Promise<CompanionSoulResponse | null>;
export function saveCompanionSoul(profile: CompanionSoulProfile): Promise<CompanionSoulResponse | null>;
export function resetCompanionSoul(): Promise<CompanionSoulResponse | null>;
export type CompanionFeedbackSignal =
  | 'too_verbose'
  | 'too_brief'
  | 'too_soft'
  | 'too_harsh'
  | 'too_speculative'
  | 'missed_possibilities';
export interface CompanionPreferenceSignalDefinition {
  id: CompanionFeedbackSignal;
  label: string;
  description: string;
}
export interface CompanionPreferenceProposal {
  proposal_id: string;
  status: 'review_only';
  signal: CompanionFeedbackSignal;
  signal_label: string;
  title: string;
  reason: string;
  impact: string;
  evidence_count: number;
  scope_label: string;
  target: {
    scope: 'global' | 'project';
    project_id?: string;
    field: keyof CompanionResponsePreferences;
    value: string;
  };
  current_value: string;
}
export interface CompanionPreferenceState {
  ok?: boolean;
  feedback_count: number;
  proposals: CompanionPreferenceProposal[];
  signals: CompanionPreferenceSignalDefinition[];
  policy: { threshold: number; window_days: number; auto_apply: false };
}
export function fetchCompanionPreferences(): Promise<CompanionPreferenceState | null>;
export function postCompanionFeedback(input: {
  signal: CompanionFeedbackSignal;
  response_ref: string;
  gate?: KnowledgeGate;
  soul_revision: number;
  project_id?: string;
}): Promise<{ ok: boolean; preferences?: CompanionPreferenceState; error?: string } | null>;
export function decideCompanionPreference(input: {
  proposal_id: string;
  decision: 'applied' | 'dismissed';
}): Promise<{
  ok: boolean;
  profile?: CompanionSoulProfile;
  preferences?: CompanionPreferenceState;
  error?: string;
} | null>;
export function fetchLoopNonce(): Promise<string | null>;
export function postLoopDecision(input: {
  proposal_id: string;
  decision: 'approved' | 'rejected' | 'deferred' | 'undone';
  reason?: string;
  undo_of?: string;
}): Promise<DecisionResult | null>;
export function postLoopExecute(opts: {
  proposal_id: string;
  mode?: 'dry-run' | 'push';
}): Promise<{ ok: boolean; status?: string; error?: string } | null>;
