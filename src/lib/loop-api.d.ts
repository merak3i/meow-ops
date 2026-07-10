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
export function postLoopAsk(question: string): Promise<{ ok: boolean; answer?: string; source?: 'keyword' | 'llm'; error?: string } | null>;
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
