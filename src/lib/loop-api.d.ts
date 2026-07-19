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
export interface ProjectControlCatalogEntry {
  project_id: string;
  name: string;
  aliases: string[];
  root: string;
  learning_state_path: string;
  git_remote: string | null;
}
export interface ProjectControlLearning {
  learning_id: string;
  project_id: string;
  kind: string;
  title: string;
  rationale: string;
  impact: 'low' | 'medium' | 'high';
  confidence: number;
  status: 'proposed' | 'approved' | 'published' | 'rejected' | 'deferred';
  evidence: Array<{ kind: string; ref: string; detail?: string }>;
}
export interface ProjectControlSnapshot {
  ok?: boolean;
  project: ProjectControlCatalogEntry;
  constitution: {
    fields: Record<string, ProjectClaim | null>;
    coverage: { confirmed: number; total: number; ratio: number };
  };
  agents: { observed: string[]; blind_spots: string[] };
  learning: { counts: Record<string, number>; candidates: ProjectControlLearning[] };
}
export interface ProjectControlPortfolio {
  ok: boolean;
  projects: ProjectControlSnapshot[];
}
export interface ProjectLearningStateResponse {
  ok: boolean;
  project: ProjectControlCatalogEntry;
  files: Record<string, string | null>;
}
export interface ProjectEvidenceResponse {
  ok: boolean;
  project_id: string;
  total: number;
  items: Array<Record<string, unknown>>;
  next_cursor?: string | null;
}
export interface ProjectAdapterPreview {
  ok: boolean;
  preview: {
    generated_at: string;
    targets: Array<{
      agent: string;
      path: string;
      exists: boolean;
      changed: boolean;
      checksum: string;
    }>;
  };
}
export function fetchProjectControlPortfolio(): Promise<ProjectControlPortfolio>;
export type LearningQuestStage = 'discovered' | 'practiced' | 'proven' | 'shipped' | null;
export type LearningQuestLane = 'code' | 'product' | 'marketing' | 'gtm' | 'sales';
export interface LearningQuestTopic {
  topic_id: string;
  title: string;
  summary: string;
  lane: LearningQuestLane;
  difficulty: number;
  tags: string[];
  prerequisite_ids: string[];
  stage: LearningQuestStage;
  recall: { confidence: number; refresh_due: boolean; interval_days: number; next_due_at: string };
  next_question: { question_id: string; kind: string; question_text: string };
  progress: { action_count: number; attempts: number; completed_actions: string[]; next_actions: string[] };
}
export interface LearningQuestSnapshot {
  ok: boolean;
  schema_version: number;
  topics: LearningQuestTopic[];
  summary: {
    total_topics: number;
    by_stage: Record<string, number>;
    by_lane: Record<LearningQuestLane, number>;
    durable_capability: number;
  };
  analytics: {
    recall: { attempts: number; pass_rate: number; refresh_due: number; reached_360_days: number };
    independence: { completed_actions: number; unassisted_rate: number; average_hints: number };
    explanation: { passes: number; rubric_average: number };
    calibration_error: number;
    effort: { average_attempts: number; average_duration_seconds: number };
    stage_funnel: Record<string, number>;
    by_lane: Record<LearningQuestLane, { topics: number; shipped: number; recall_confidence: number }>;
    guidance: {
      bottleneck_stage: string;
      independence_direction: 'rising' | 'steady' | 'falling';
      next_intervention: string;
    };
  };
  rewards: {
    xp: number;
    level: number;
    streak_days: number;
    dimensions: { understanding: number; independence: number; shipping: number; consistency: number };
    badges: string[];
  };
  workshop: {
    state: 'none' | 'active';
    health: number;
    age_days: number;
    inactive_days: number;
    pending_count: number;
    completed_count: number;
    can_resume: boolean;
    can_complete: boolean;
    origin: 'weekend' | 'spontaneous';
    focus_topic_id: string | null;
    reminder: string;
  };
}
export function fetchLearningQuestSnapshot(): Promise<LearningQuestSnapshot>;
export function saveLearningQuestTopic(topic: Record<string, unknown>): Promise<LearningQuestSnapshot | null>;
export function removeLearningQuestTopic(topicId: string): Promise<LearningQuestSnapshot | null>;
export function recordLearningQuestEvent(event: Record<string, unknown>): Promise<LearningQuestSnapshot | null>;
export function verifyLearningQuestProof(topicId: string, action?: 'commit_verified'): Promise<LearningQuestSnapshot | null>;
export function updateLearningQuestWorkshop(action: 'start' | 'complete', topicIds?: string[]): Promise<LearningQuestSnapshot | null>;
export function fetchProjectControlSnapshot(projectId: string): Promise<ProjectControlSnapshot | null>;
export function fetchProjectLearningState(projectId: string): Promise<ProjectLearningStateResponse | null>;
export function fetchProjectEvidence(
  projectId: string,
  options?: { limit?: number; source?: string },
): Promise<ProjectEvidenceResponse | null>;
export function previewProjectContextAdapters(projectId: string): Promise<ProjectAdapterPreview | null>;
export interface ProjectAdapterMutationResult {
  ok: boolean;
  result?: { sync_id: string; applied?: unknown[]; restored?: unknown[] };
  error?: string;
}
export function applyProjectContextAdapters(
  projectId: string,
  preview: ProjectAdapterPreview['preview'],
): Promise<ProjectAdapterMutationResult | null>;
export function rollbackProjectContextAdapters(
  projectId: string,
  syncId: string,
): Promise<ProjectAdapterMutationResult | null>;
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
