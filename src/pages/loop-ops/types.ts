// Data contracts for Loop-Ops (implementation spec §6). spec.json on disk is
// produced by the Phase 3 importer; until then a hand-carried fixture with the
// same shape lives at public/data/loop-ops/spec.json.

export type LoopStatus =
  | 'covered' | 'wired' | 'running' | 'blocked'
  | 'failed' | 'passed' | 'needs-review';

// Worst → best. Directors and the coordinator inherit the worst child status.
export const STATUS_SEVERITY: readonly LoopStatus[] = [
  'failed', 'blocked', 'needs-review', 'running', 'covered', 'wired', 'passed',
];

export type LoopGroup = 'tenant' | 'customer' | 'admin' | 'doer';
export const LOOP_GROUPS: readonly LoopGroup[] = ['tenant', 'customer', 'admin', 'doer'];

// Per-surface knobs and verification context shown in the inspector drawer.
// Additive to the spec §6 contract — everything here is display-only.
export interface LoopEntityDetail {
  modelTier?: string;
  confidenceFloor?: number;
  passThreshold?: number;
  promptVersion?: string;
  evalSet?: string;
  dbStatus?: string;
  e2eGate?: string;
  currentTruth?: string;
  correlationStatus?: string;
  lastCheckedAt?: string;
  guardrails?: string;
  evalSettings?: string;
  flywheelFlags?: string;
  // Display/copy only. The UI never executes validation commands.
  validationCommand?: string;
  releaseChecks?: string[];
  clonePath?: string;
  cloneVerified?: boolean;
  notVerified?: string[];
}

export interface LoopEntity {
  id: string;
  kind: 'coordinator' | 'director' | 'assistant';
  label: string;
  group: LoopGroup | null;
  surfaceKey: string | null;
  archetype: string | null;
  riskClass: string | null;
  wave: number | null;
  status: LoopStatus;
  sources: string[];
  repoLinks: string[];
  allowedActions: string[];
  detail?: LoopEntityDetail;
}

// NOTE: canvas topology is currently DERIVED from kind/group/wave in
// layout.ts, not read from spec.edges. Until the Phase 3 importer emits
// non-hierarchy edges (dependency matrix), spec.edges is carried as data
// but not rendered.
export interface LoopSpecEdge {
  id: string;
  source: string;
  target: string;
}

// Run/gate/artifact contracts (spec §6) — consumed by Phases 3-5. Declared
// now so the Phase 3 importer and Phase 5 run wiring build against a locked
// shape instead of inventing their own.
export interface LoopArtifact {
  id: string;
  runId: string;
  type: 'pr' | 'file' | 'screenshot' | 'report' | 'eval-result';
  pathOrUrl: string;
  createdAt: string;
  reviewStatus: 'pending' | 'accepted' | 'rejected';
}

export interface LoopRun {
  id: string;
  goal: string;
  entityIds: string[];
  state: 'planned' | 'running' | 'passed' | 'failed' | 'stopped';
  startedAt: string;
  endedAt: string | null;
  operator: string;
  sessionIds: string[];
  artifacts: LoopArtifact[];
  cost: { usd: number; tokens: number } | null;
  verified: string[];
  notVerified: string[];
}

export interface LoopGate {
  id: string;
  entityId: string;
  gateType: 'eval' | 'guardrail' | 'hitl' | 'release-check' | 'contract';
  status: LoopStatus;
  evidence: string | null;
  blockingReason: string | null;
  lastCheckedAt: string | null;
}

export interface LoopSpecMeta {
  specVersion: number;
  generatedBy: string;
  generatedAt: string;
  masterSpec: string;
  entityCount: number;
  assistantCount: number;
  productionWritesEnabled: boolean;
  links: Record<string, string>;
}

export interface LoopSpec {
  meta: LoopSpecMeta;
  entities: LoopEntity[];
  edges: LoopSpecEdge[];
}

export function worstStatus(statuses: LoopStatus[]): LoopStatus {
  // An empty set has verified nothing — it must never claim 'passed'.
  if (statuses.length === 0) return 'needs-review';
  let worst: LoopStatus = 'passed';
  for (const s of statuses) {
    if (STATUS_SEVERITY.indexOf(s) < STATUS_SEVERITY.indexOf(worst)) worst = s;
  }
  return worst;
}
