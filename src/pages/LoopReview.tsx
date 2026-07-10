import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { ToggleGroup } from '@/components/ui/ToggleGroup';
import { FiveBeatCard } from '@/components/five-beat/FiveBeatCard';
import {
  fetchLoopComparisons,
  fetchLoopDecisions,
  fetchLoopDigest,
  fetchLoopDigestHistory,
  fetchLoopOutcomes,
  fetchLoopProposals,
  fetchLoopRuns,
  fetchLoopSimulations,
  fetchLoopSummary,
  postLoopDecision,
  postLoopExecute,
  postLoopAsk,
  postLoopRunDigest,
} from '@/lib/loop-api';
import type { DigestData } from '@/lib/loop-api';
import type {
  Comparison,
  ComparisonDelta,
  Decision,
  DecisionValue,
  LoopRun,
  LoopSummary,
  Outcome,
  Proposal,
  Simulation,
} from '@/types/loop';

type View = 'proposals' | 'runs' | 'ship-next' | 'digest' | 'activity';
type Filter = 'pending' | 'drafts' | 'decided' | 'expired' | 'all';

const VIEWS: { value: View; label: string }[] = [
  { value: 'proposals', label: 'Proposals' },
  { value: 'runs', label: 'Runs' },
  { value: 'ship-next', label: 'Ship Next' },
  { value: 'digest', label: 'Digest' },
  { value: 'activity', label: 'Activity' },
];

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'drafts', label: 'Drafts' },
  { value: 'decided', label: 'Decided' },
  { value: 'expired', label: 'Expired' },
  { value: 'all', label: 'All' },
];

const riskRank: Record<string, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

const styles: Record<string, CSSProperties> = {
  shell: { display: 'flex', flexDirection: 'column', gap: 20 },
  header: { display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start' },
  title: { margin: 0, fontSize: 22, fontWeight: 300, color: 'var(--text-primary)' },
  subtitle: { margin: '6px 0 0', color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.5 },
  controls: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' },
  badgeRow: { display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' },
  badge: {
    border: '1px solid var(--border)',
    borderRadius: 999,
    padding: '4px 10px',
    fontSize: 11,
    color: 'var(--text-secondary)',
    background: 'var(--bg-card)',
  },
  warnBadge: {
    border: '1px solid var(--warning)',
    borderRadius: 999,
    padding: '3px 8px',
    fontSize: 10,
    color: 'var(--warning)',
    background: 'color-mix(in srgb, var(--warning) 9%, transparent)',
  },
  grid: { display: 'grid', gridTemplateColumns: 'minmax(280px, 360px) minmax(0, 1fr)', gap: 18, alignItems: 'start' },
  queue: { display: 'flex', flexDirection: 'column', gap: 12 },
  queueHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  list: { display: 'flex', flexDirection: 'column', gap: 8 },
  item: {
    textAlign: 'left',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: 12,
    background: 'var(--bg-card)',
    color: 'var(--text-primary)',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  empty: {
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: 28,
    color: 'var(--text-secondary)',
    fontSize: 14,
  },
  runsShell: { display: 'flex', flexDirection: 'column', gap: 14 },
  shipShell: { display: 'grid', gridTemplateColumns: 'minmax(0, 1.2fr) minmax(280px, 0.8fr)', gap: 18, alignItems: 'start' },
  shipSection: { display: 'flex', flexDirection: 'column', gap: 10 },
  shipRow: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: 14,
    background: 'var(--bg-card)',
    color: 'var(--text-primary)',
    textAlign: 'left',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  shipMeta: { display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10, color: 'var(--text-muted)', fontSize: 11 },
  loopFilters: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  loopChip: {
    border: '1px solid var(--border)',
    borderRadius: 999,
    padding: '5px 10px',
    fontSize: 11,
    background: 'var(--bg-card)',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  tableWrap: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--bg-card)',
    overflow: 'auto',
  },
  table: { width: '100%', minWidth: 840, borderCollapse: 'collapse' },
  th: {
    padding: '10px 12px',
    textAlign: 'left',
    fontSize: 10,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: 'var(--text-muted)',
    borderBottom: '1px solid var(--border)',
    whiteSpace: 'nowrap',
  },
  td: {
    padding: '11px 12px',
    fontSize: 12,
    color: 'var(--text-secondary)',
    borderBottom: '1px solid var(--border)',
    whiteSpace: 'nowrap',
  },
  detail: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: 16,
    background: 'var(--bg-card)',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  digestRow: {
    display: 'grid',
    gridTemplateColumns: '120px minmax(0, 1fr)',
    gap: 12,
    alignItems: 'baseline',
    color: 'var(--text-secondary)',
    fontSize: 13,
  },
  digestLabel: { color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.8 },
  detailTitle: { margin: 0, fontSize: 13, color: 'var(--text-primary)' },
  deltaGrid: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  deltaChip: {
    border: '1px solid var(--border)',
    borderRadius: 999,
    padding: '5px 9px',
    fontSize: 11,
    background: 'var(--bg-hover)',
    color: 'var(--text-secondary)',
  },
  muted: { margin: 0, color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.6 },
};

const askBarStyle: CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', width: '100%' };

const askInputStyle: CSSProperties = {
  flex: 1, border: '1px solid var(--border)', borderRadius: 6, padding: '8px 12px', fontSize: 13,
  background: 'var(--bg-card)',
  color: 'var(--text-primary)',
  fontFamily: 'inherit',
};

const askButtonStyle: CSSProperties = {
  border: '1px solid var(--border)', borderRadius: 6, padding: '8px 14px', fontSize: 12,
  background: 'var(--bg-card)', color: 'var(--text-secondary)', cursor: 'pointer', fontFamily: 'inherit',
};

function latestDecisionByProposal(decisions: Decision[]) {
  const latest = new Map<string, Decision>();
  for (const decision of decisions) {
    const existing = latest.get(decision.proposal_id);
    if (!existing || decision.decided_at > existing.decided_at) {
      latest.set(decision.proposal_id, decision);
    }
  }
  return latest;
}

function latestSimulationByProposal(simulations: Simulation[]) {
  const latest = new Map<string, Simulation>();
  for (const simulation of simulations) {
    const existing = latest.get(simulation.proposal_id);
    if (!existing || simulation.ran_at > existing.ran_at) {
      latest.set(simulation.proposal_id, simulation);
    }
  }
  return latest;
}

function outcomeByDecision(outcomes: Outcome[]) {
  const latest = new Map<string, Outcome>();
  for (const outcome of outcomes) {
    const existing = latest.get(outcome.decision_id);
    if (!existing || outcome.recorded_at > existing.recorded_at) {
      latest.set(outcome.decision_id, outcome);
    }
  }
  return latest;
}

function riskValue(proposal: Proposal) {
  return riskRank[proposal.risk || ''] ?? 2;
}

function confidenceValue(proposal: Proposal) {
  const raw = proposal.confidence;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 0;
  return raw <= 1 ? raw : raw / 100;
}

function isDecided(proposal: Proposal, latest: Decision | undefined) {
  if (isExpiredDecision(latest)) return false;
  if (latest?.decision === 'undone') return false;
  return Boolean(latest) || ['approved', 'rejected', 'applied', 'rolled_back'].includes(proposal.status);
}

function isExpiredDecision(decision: Decision | undefined | null) {
  return Boolean(
    decision
    && decision.decision === 'rejected'
    && decision.reason === 'expired stale draft'
    && (decision.created_by === 'system:expire' || decision.decided_by === 'system:expire'),
  );
}

function isExpiredProposal(proposal: Proposal, latest: Decision | undefined) {
  return proposal.status === 'rejected' && isExpiredDecision(latest);
}

function isSkeleton(proposal: Proposal) {
  return proposal.created_by === 'assistant:loop';
}

function hasLlmEvidence(proposal: Proposal) {
  return proposal.evidence.some((item) => (
    item
    && typeof item === 'object'
    && 'kind' in item
    && (item as { kind?: unknown }).kind === 'llm'
  ));
}

interface ExecutionEvidence {
  kind: 'execution';
  mode?: string;
  pr_url?: string;
}

function isExecutionEvidence(item: unknown): item is ExecutionEvidence {
  return Boolean(
    item
    && typeof item === 'object'
    && 'kind' in item
    && (item as { kind?: unknown }).kind === 'execution',
  );
}

function latestExecutionEvidence(proposal: Proposal | null) {
  return proposal ? [...proposal.evidence].reverse().find(isExecutionEvidence) || null : null;
}

function decisionTone(decision: DecisionValue) {
  if (decision === 'approved') return 'var(--success, #22c55e)';
  if (decision === 'rejected') return 'var(--danger, #fb7185)';
  return 'var(--text-muted)';
}

function truncateReason(reason?: string) {
  if (!reason) return null;
  return reason.length > 80 ? `${reason.slice(0, 77)}...` : reason;
}

function metricNumber(run: LoopRun, key: string) {
  const value = run.metrics[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-US').format(value);
}

function formatCost(value: number) {
  return `$${value.toFixed(value > 0 && value < 1 ? 4 : 2)}`;
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0s';
  if (seconds >= 3600) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.round((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  }
  if (seconds >= 60) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  return `${Math.round(seconds)}s`;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function hasDurationWarn(run: LoopRun | null) {
  return typeof run?.notes === 'string' && run.notes.startsWith('WARN:');
}

function asDelta(value: unknown): ComparisonDelta | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<ComparisonDelta>;
  if (
    typeof candidate.before !== 'number'
    || typeof candidate.after !== 'number'
    || typeof candidate.delta_pct !== 'number'
  ) return null;
  return candidate as ComparisonDelta;
}

function sortedDeltas(comparison: Comparison | null) {
  if (!comparison) return [];
  return Object.entries(comparison.deltas)
    .map(([metric, value]) => ({ metric, delta: asDelta(value) }))
    .filter((item): item is { metric: string; delta: ComparisonDelta } => Boolean(item.delta))
    .sort((a, b) => Math.abs(b.delta.delta_pct) - Math.abs(a.delta.delta_pct) || a.metric.localeCompare(b.metric));
}

function deltaTone(deltaPct: number) {
  return deltaPct > 0 ? 'var(--danger, #fb7185)' : 'var(--success, var(--green))';
}

export default function LoopReview() {
  const [view, setView] = useState<View>('proposals');
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [runs, setRuns] = useState<LoopRun[]>([]);
  const [comparisons, setComparisons] = useState<Comparison[]>([]);
  const [simulations, setSimulations] = useState<Simulation[]>([]);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [digest, setDigest] = useState<DigestData | null>(null);
  const [digestHistory, setDigestHistory] = useState<DigestData[]>([]);
  const [summary, setSummary] = useState<LoopSummary>({ counts_by_status: {}, open_per_loop: {}, total: 0 });
  const [filter, setFilter] = useState<Filter>('pending');
  const [loopFilter, setLoopFilter] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [digestBusy, setDigestBusy] = useState(false);
  const [askInput, setAskInput] = useState('');
  const [askAnswer, setAskAnswer] = useState<string | null>(null);
  const [askSource, setAskSource] = useState<'keyword' | 'llm' | null>(null);
  const [askBusy, setAskBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [
      nextProposals,
      nextDecisions,
      nextSummary,
      nextRuns,
      nextComparisons,
      nextSimulations,
      nextOutcomes,
      nextDigest,
      nextDigestHistory,
    ] = await Promise.all([
      fetchLoopProposals(),
      fetchLoopDecisions(),
      fetchLoopSummary(),
      fetchLoopRuns(),
      fetchLoopComparisons(),
      fetchLoopSimulations(),
      fetchLoopOutcomes(),
      fetchLoopDigest(),
      fetchLoopDigestHistory(),
    ]);
    setProposals(nextProposals);
    setDecisions(nextDecisions);
    setSummary(nextSummary);
    setRuns(nextRuns);
    setComparisons(nextComparisons);
    setSimulations(nextSimulations);
    setOutcomes(nextOutcomes);
    setDigest(nextDigest);
    setDigestHistory(nextDigestHistory);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const latestByProposal = useMemo(() => latestDecisionByProposal(decisions), [decisions]);
  const latestSimulationByProposalId = useMemo(() => latestSimulationByProposal(simulations), [simulations]);
  const outcomeByDecisionId = useMemo(() => outcomeByDecision(outcomes), [outcomes]);

  const sorted = useMemo(() => {
    return [...proposals].sort((a, b) => {
      const riskDelta = riskValue(a) - riskValue(b);
      if (riskDelta !== 0) return riskDelta;
      const confidenceDelta = confidenceValue(b) - confidenceValue(a);
      if (confidenceDelta !== 0) return confidenceDelta;
      return a.created_at.localeCompare(b.created_at);
    });
  }, [proposals]);

  const shipRankedPending = useMemo(() => {
    return proposals
      .filter((proposal) => {
        const latest = latestByProposal.get(proposal.proposal_id);
        return proposal.status === 'pending_approval' && (!latest || latest.decision === 'undone');
      })
      .sort((a, b) => {
        const riskDelta = riskValue(a) - riskValue(b);
        if (riskDelta !== 0) return riskDelta;
        const confidenceDelta = confidenceValue(b) - confidenceValue(a);
        if (confidenceDelta !== 0) return confidenceDelta;
        return a.created_at.localeCompare(b.created_at);
      });
  }, [latestByProposal, proposals]);

  const approvedAwaitingApply = useMemo(() => {
    return proposals
      .filter((proposal) => {
        const latest = latestByProposal.get(proposal.proposal_id);
        return proposal.status === 'approved' && !isExpiredProposal(proposal, latest);
      })
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }, [latestByProposal, proposals]);

  const filtered = useMemo(() => {
    return sorted.filter((proposal) => {
      const latest = latestByProposal.get(proposal.proposal_id);
      if (filter === 'all') return true;
      if (filter === 'pending') return proposal.status === 'pending_approval' && (!latest || latest.decision === 'undone');
      if (filter === 'drafts') return proposal.status === 'draft' || proposal.status === 'simulated';
      if (filter === 'expired') return isExpiredProposal(proposal, latest);
      return isDecided(proposal, latest);
    });
  }, [filter, latestByProposal, sorted]);

  const sortedRuns = useMemo(() => {
    return [...runs].sort((a, b) => b.captured_at.localeCompare(a.captured_at));
  }, [runs]);

  const activityItems = useMemo(() => {
    const proposalById = new Map(proposals.map((proposal) => [proposal.proposal_id, proposal]));
    return [...decisions]
      .sort((a, b) => b.decided_at.localeCompare(a.decided_at))
      .slice(0, 50)
      .map((decision) => ({ decision, proposal: proposalById.get(decision.proposal_id) ?? null }));
  }, [decisions, proposals]);

  const loopOptions = useMemo(() => {
    return [...new Set(sortedRuns.map((run) => run.loop_id))].sort();
  }, [sortedRuns]);

  const filteredRuns = useMemo(() => {
    return loopFilter === 'all'
      ? sortedRuns
      : sortedRuns.filter((run) => run.loop_id === loopFilter);
  }, [loopFilter, sortedRuns]);

  useEffect(() => {
    if (filtered.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !filtered.some((proposal) => proposal.proposal_id === selectedId)) {
      setSelectedId(filtered[0]?.proposal_id ?? null);
    }
  }, [filtered, selectedId]);

  useEffect(() => {
    if (filteredRuns.length === 0) {
      setSelectedRunId(null);
      return;
    }
    if (!selectedRunId || !filteredRuns.some((run) => run.run_id === selectedRunId)) {
      setSelectedRunId(filteredRuns[0]?.run_id ?? null);
    }
  }, [filteredRuns, selectedRunId]);

  const selected = filtered.find((proposal) => proposal.proposal_id === selectedId) ?? null;
  const selectedDecision = selected ? latestByProposal.get(selected.proposal_id) ?? null : null;
  const selectedSimulation = selected ? latestSimulationByProposalId.get(selected.proposal_id) ?? null : null;
  const selectedOutcome = selectedDecision ? outcomeByDecisionId.get(selectedDecision.decision_id) ?? null : null;
  const selectedRun = filteredRuns.find((run) => run.run_id === selectedRunId) ?? null;
  const selectedComparison = selectedRun
    ? comparisons.find((comparison) => comparison.run_id === selectedRun.run_id) ?? null
    : null;
  const selectedDeltas = sortedDeltas(selectedComparison);

  const handleDecision = useCallback(async (
    decision: DecisionValue,
    options?: { undoOf?: string; reason?: string },
  ) => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    const payload: {
      proposal_id: string;
      decision: DecisionValue;
      reason?: string;
      undo_of?: string;
    } = {
      proposal_id: selected.proposal_id,
      decision,
    };
    if (options?.reason) payload.reason = options.reason;
    if (options?.undoOf) payload.undo_of = options.undoOf;

    const result = await postLoopDecision(payload);
    if (!result?.ok) {
      setError(result?.error || 'Local helper unavailable. Start npm run loop:propose after node sync/local-api.mjs.');
      setBusy(false);
      return;
    }
    setFilter(decision === 'undone' ? 'pending' : 'decided');
    await load();
    setSelectedId(selected.proposal_id);
    setBusy(false);
  }, [load, selected]);

  const handleExecute = useCallback(async (proposalId: string, mode: 'dry-run' | 'push' = 'dry-run') => {
    setBusy(true);
    setError(null);
    const result = await postLoopExecute({ proposal_id: proposalId, mode });
    if (!result?.ok) {
      setError(result?.error || 'Local helper unavailable. Start node sync/local-api.mjs with MEOW_EXECUTOR_ENABLED=1.');
      setBusy(false);
      return;
    }
    setBusy(false);
    window.setTimeout(() => {
      void load();
    }, mode === 'push' ? 10000 : 3000);
  }, [load]);

  const handleRunDigest = useCallback(async () => {
    setDigestBusy(true);
    setError(null);
    try {
      const result = await postLoopRunDigest();
      if (!result?.ok) {
        setError(result?.error || 'Local helper unavailable. Start node sync/local-api.mjs.');
        return;
      }
      await load();
    } finally {
      setDigestBusy(false);
    }
  }, [load]);

  const handleAsk = useCallback(async () => {
    const question = askInput.trim();
    if (!question || askBusy) return;
    setAskBusy(true);
    setError(null);
    setAskAnswer(null);
    setAskSource(null);
    try {
      const result = await postLoopAsk(question);
      if (!result?.ok) {
        setError(result?.error || 'Local helper unavailable. Start node sync/local-api.mjs.');
        return;
      }
      setAskAnswer(result.answer || '');
      setAskSource(result.source === 'llm' ? 'llm' : 'keyword');
    } finally {
      setAskBusy(false);
    }
  }, [askBusy, askInput]);

  return (
    <div style={styles.shell}>
      <header style={styles.header}>
        <div>
          <h1 style={styles.title}>Review Deck</h1>
          <p style={styles.subtitle}>Owner approval queue and Loop Engineering run deltas.</p>
        </div>
        <div style={styles.badgeRow}>
          <span style={styles.badge}>{summary.total} proposals</span>
          <span style={styles.badge}>{summary.counts_by_status.pending_approval || 0} pending</span>
          <span style={styles.badge}>{Object.keys(summary.open_per_loop).length} open loops</span>
          <span style={styles.badge}>{runs.length} runs</span>
        </div>
      </header>

      <div style={styles.controls}>
        <ToggleGroup value={view} onChange={(value: View) => setView(value)} options={VIEWS} ariaLabel="Review Deck view" />
        {view === 'proposals' && (
          <ToggleGroup value={filter} onChange={(value: Filter) => setFilter(value)} options={FILTERS} size="sm" ariaLabel="Proposal status filter" />
        )}
      </div>

      <div style={askBarStyle}>
        <input
          type="text"
          value={askInput}
          placeholder="Ask about proposals, cost, health, activity..."
          style={askInputStyle}
          onChange={(event) => {
            setAskInput(event.target.value);
            setAskAnswer(null);
            setAskSource(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void handleAsk();
            }
          }}
        />
        <button
          type="button"
          style={{ ...askButtonStyle, cursor: askBusy ? 'wait' : 'pointer', opacity: askBusy ? 0.6 : 1 }}
          disabled={askBusy}
          onClick={() => { void handleAsk(); }}
        >
          {askBusy ? 'Thinking...' : 'Ask'}
        </button>
      </div>

      {(askBusy || askAnswer) && (
        <div style={styles.detail}>
          <div style={{ color: 'var(--text-secondary)', fontSize: 13, whiteSpace: 'pre-wrap' }}>
            {askBusy ? 'Thinking...' : <>{askAnswer}{askSource === 'llm' && <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}> (via AI)</span>}</>}
          </div>
        </div>
      )}

      {loading ? (
        <div style={styles.empty}>Loading Review Deck...</div>
      ) : view === 'proposals' ? (
        proposals.length === 0 ? (
          <div style={styles.empty}>No proposals yet — run npm run loop:propose</div>
        ) : (
          <div style={styles.grid}>
            <aside style={styles.queue}>
              <div style={styles.queueHeader}>
                <h2 style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>Proposal Queue</h2>
              </div>
              <div style={styles.list}>
                {filtered.length === 0 ? (
                  <div style={styles.empty}>No proposals match this filter.</div>
                ) : filtered.map((proposal) => {
                  const latest = latestByProposal.get(proposal.proposal_id);
                  const outcome = latest ? outcomeByDecisionId.get(latest.decision_id) : null;
                  const active = proposal.proposal_id === selectedId;
                  return (
                    <button
                      key={proposal.proposal_id}
                      type="button"
                      style={{
                        ...styles.item,
                        borderColor: active ? 'var(--accent)' : 'var(--border)',
                      }}
                      onClick={() => setSelectedId(proposal.proposal_id)}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                        <strong style={{ fontSize: 13, lineHeight: 1.35 }}>{proposal.title}</strong>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{proposal.risk || 'risk n/a'}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                        <span>{proposal.loop_id}</span>
                        <span>{latest ? latest.decision : proposal.status}</span>
                        {outcome && <span>outcome {outcome.verdict}</span>}
                        <span>{Math.round(confidenceValue(proposal) * 100)}%</span>
                        {isSkeleton(proposal) && <span>skeleton — complete manually</span>}
                        {hasLlmEvidence(proposal) && <span>llm-drafted</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            </aside>
            <FiveBeatCard
              proposal={selected}
              latestDecision={selectedDecision}
              latestSimulation={selectedSimulation}
              outcome={selectedOutcome}
              busy={busy}
              error={error}
              onDecision={handleDecision}
              onExecute={selected ? (mode) => handleExecute(selected.proposal_id, mode) : undefined}
            />
          </div>
        )
      ) : view === 'ship-next' ? (
        <section style={styles.shipShell}>
          <div style={styles.shipSection}>
            <h2 style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>Pending owner decisions</h2>
            {shipRankedPending.length === 0 ? (
              <div style={styles.empty}>No pending proposals. Run npm run loop:propose after the next capture.</div>
            ) : shipRankedPending.map((proposal, index) => (
              <button
                key={proposal.proposal_id}
                type="button"
                style={styles.shipRow}
                onClick={() => {
                  setView('proposals');
                  setFilter('pending');
                  setSelectedId(proposal.proposal_id);
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <strong>#{index + 1} {proposal.title}</strong>
                  <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{proposal.risk || 'risk n/a'} - {Math.round(confidenceValue(proposal) * 100)}%</span>
                </div>
                <p style={styles.muted}>{proposal.one_percent_target}</p>
                {proposal.expected_benefit && <p style={styles.muted}>{proposal.expected_benefit}</p>}
                <div style={styles.shipMeta}>
                  <span>{proposal.loop_id}</span>
                  <span>{formatDate(proposal.created_at)}</span>
                  <span>{proposal.status}</span>
                  {hasLlmEvidence(proposal) && <span>llm-drafted</span>}
                </div>
              </button>
            ))}
          </div>
          <div style={styles.shipSection}>
            <h2 style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>Approved, awaiting manual apply</h2>
            {approvedAwaitingApply.length === 0 ? (
              <div style={styles.empty}>No approved manual-apply items.</div>
            ) : approvedAwaitingApply.map((proposal) => (
              <button
                key={proposal.proposal_id}
                type="button"
                style={styles.shipRow}
                onClick={() => {
                  setView('proposals');
                  setFilter('decided');
                  setSelectedId(proposal.proposal_id);
                }}
              >
                <strong>{proposal.title}</strong>
                <p style={styles.muted}>{proposal.one_percent_target}</p>
                {proposal.expected_benefit && <p style={styles.muted}>{proposal.expected_benefit}</p>}
                <div style={styles.shipMeta}>
                  <span>{proposal.loop_id}</span>
                  <span>approved, awaiting manual apply</span>
                  {hasLlmEvidence(proposal) && <span>llm-drafted</span>}
                </div>
              </button>
            ))}
          </div>
        </section>
      ) : view === 'digest' ? (
        <section style={styles.runsShell}>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={() => void handleRunDigest()}
              disabled={digestBusy}
              style={{
                border: '1px solid var(--border)',
                borderRadius: 6,
                padding: '6px 14px',
                fontSize: 12,
                background: 'var(--bg-card)',
                color: 'var(--text-secondary)',
                cursor: digestBusy ? 'wait' : 'pointer',
                fontFamily: 'inherit',
                opacity: digestBusy ? 0.6 : 1,
              }}
            >
              {digestBusy ? 'Running...' : 'Run digest'}
            </button>
          </div>
          {error ? <div style={{ ...styles.empty, color: 'var(--danger, #fb7185)' }}>{error}</div> : null}
          {!digest ? (
            <div style={styles.empty}>No digest available — run `npm run digest` first.</div>
          ) : (
            <div style={styles.detail}>
              <div style={styles.digestRow}>
                <span style={styles.digestLabel}>Period</span>
                <span>{formatDate(digest.period.since)} - {formatDate(digest.period.until)}</span>
              </div>
              <div style={styles.digestRow}>
                <span style={styles.digestLabel}>Capture</span>
                <span>{formatNumber(digest.capture.sessions)} sessions · {digest.capture.run_id || 'no new run'}</span>
              </div>
              <div style={styles.digestRow}>
                <span style={styles.digestLabel}>Intake</span>
                <span>{digest.intake.processed} processed / {digest.intake.stored} stored / {digest.intake.dropped} dropped / {digest.intake.skipped} skipped</span>
              </div>
              <div style={styles.digestRow}>
                <span style={styles.digestLabel}>Health</span>
                <span>{digest.health.agents_total} agents · {digest.health.flagged} flagged · {digest.health.flags.length ? digest.health.flags.join(', ') : 'no flags'}</span>
              </div>
              {digest.health.agents?.length ? (
                <div style={styles.digestRow}>
                  <span style={styles.digestLabel}>Agents</span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {digest.health.agents.map((agent) => {
                      const stale = typeof agent.log_staleness_hours === 'number' && agent.log_staleness_hours > 24;
                      const failed = typeof agent.last_exit_status === 'number' && agent.last_exit_status !== 0;
                      return (
                        <span key={agent.label} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'baseline' }}>
                          <span style={{ color: agent.running ? 'var(--success, #22c55e)' : 'var(--danger, #fb7185)' }}>●</span>
                          <strong>{agent.label}</strong>
                          <span>{agent.running ? 'running' : 'stopped'}</span>
                          {failed && <span style={{ color: 'var(--danger, #fb7185)' }}>exit {agent.last_exit_status}</span>}
                          {stale && <span style={{ color: 'var(--warning)' }}>{agent.log_staleness_hours}h stale</span>}
                          {agent.flags.length > 0 && <span>{agent.flags.join(', ')}</span>}
                        </span>
                      );
                    })}
                  </div>
                </div>
              ) : null}
              <div style={styles.digestRow}>
                <span style={styles.digestLabel}>Proposals</span>
                <span>{digest.proposals.new_drafts} new / {digest.proposals.pending} pending / {digest.proposals.total} total</span>
              </div>
              {digest.notes?.length ? (
                <div style={styles.digestRow}>
                  <span style={styles.digestLabel}>Notes</span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {digest.notes.map((note, index) => (
                      <span key={`${note}-${index}`} style={{ color: 'var(--text-muted)' }}>· {note}</span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          )}
          {digestHistory.length > 0 ? (
            <>
              <h2 style={styles.detailTitle}>History</h2>
              <div style={styles.tableWrap}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Date</th>
                      <th style={styles.th}>Sessions</th>
                      <th style={styles.th}>Intake</th>
                      <th style={styles.th}>Flagged</th>
                      <th style={styles.th}>New proposals</th>
                      <th style={styles.th}>Pending</th>
                    </tr>
                  </thead>
                  <tbody>
                    {digestHistory.map((entry) => (
                      <tr key={entry.generated_at}>
                        <td style={styles.td}>{formatDate(entry.generated_at)}</td>
                        <td style={styles.td}>{formatNumber(entry.capture.sessions)}</td>
                        <td style={styles.td}>{formatNumber(entry.intake.stored)}</td>
                        <td style={styles.td}>{formatNumber(entry.health.flagged)}</td>
                        <td style={styles.td}>{formatNumber(entry.proposals.new_drafts)}</td>
                        <td style={styles.td}>{formatNumber(entry.proposals.pending)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </section>
      ) : view === 'activity' ? (
        <section style={styles.runsShell}>
          {activityItems.length === 0 ? (
            <div style={styles.empty}>No activity yet — decisions appear here after approving or rejecting proposals.</div>
          ) : (
            <div style={{ ...styles.detail, padding: 0, gap: 0 }}>
              {activityItems.map(({ decision, proposal }) => {
                const execution = latestExecutionEvidence(proposal);
                const reason = truncateReason(decision.reason);
                return (
                  <div
                    key={decision.decision_id}
                    style={{
                      display: 'flex',
                      alignItems: 'baseline',
                      gap: 12,
                      padding: '8px 12px',
                      borderBottom: '1px solid var(--border)',
                      fontSize: 12,
                      color: 'var(--text-secondary)',
                    }}
                  >
                    <span style={{ color: 'var(--text-muted)' }}>{formatDate(decision.decided_at)}</span>
                    <span style={{ color: decisionTone(decision.decision), fontWeight: 600 }}>{decision.decision}</span>
                    {execution?.pr_url ? (
                      <a href={execution.pr_url} target="_blank" rel="noopener noreferrer" style={styles.loopChip}>
                        executed ({execution.mode || 'dry-run'})
                      </a>
                    ) : execution ? (
                      <span style={styles.loopChip}>executed ({execution.mode || 'dry-run'})</span>
                    ) : null}
                    <button
                      type="button"
                      style={styles.loopChip}
                      onClick={() => {
                        setView('proposals');
                        setFilter('all');
                        setSelectedId(decision.proposal_id);
                      }}
                    >
                      {proposal?.title || decision.proposal_id}
                    </button>
                    {reason ? <span style={{ color: 'var(--text-muted)' }}>— {reason}</span> : null}
                    <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: 11 }}>by {decision.decided_by}</span>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      ) : (
        <section style={styles.runsShell}>
          {runs.length === 0 ? (
            <div style={styles.empty}>No runs yet — run npm run loop:capture</div>
          ) : (
            <>
              <div style={styles.loopFilters} aria-label="Run loop filter">
                <button
                  type="button"
                  style={{
                    ...styles.loopChip,
                    borderColor: loopFilter === 'all' ? 'var(--accent)' : 'var(--border)',
                    color: loopFilter === 'all' ? 'var(--text-primary)' : 'var(--text-secondary)',
                  }}
                  onClick={() => setLoopFilter('all')}
                >
                  all loops
                </button>
                {loopOptions.map((loopId) => (
                  <button
                    key={loopId}
                    type="button"
                    style={{
                      ...styles.loopChip,
                      borderColor: loopFilter === loopId ? 'var(--accent)' : 'var(--border)',
                      color: loopFilter === loopId ? 'var(--text-primary)' : 'var(--text-secondary)',
                    }}
                    onClick={() => setLoopFilter(loopId)}
                  >
                    {loopId}
                  </button>
                ))}
              </div>

              <div style={styles.tableWrap}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>captured_at</th>
                      <th style={styles.th}>loop</th>
                      <th style={styles.th}>sessions</th>
                      <th style={styles.th}>duration</th>
                      <th style={styles.th}>tokens</th>
                      <th style={styles.th}>real cost</th>
                      <th style={styles.th}>notional cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRuns.map((run) => {
                      const active = run.run_id === selectedRunId;
                      return (
                        <tr
                          key={run.run_id}
                          onClick={() => setSelectedRunId(run.run_id)}
                          style={{
                            cursor: 'pointer',
                            background: active ? 'var(--bg-hover)' : 'transparent',
                          }}
                        >
                          <td style={styles.td}>{formatDate(run.captured_at)}</td>
                          <td style={{ ...styles.td, color: 'var(--text-primary)' }}>{run.loop_id}</td>
                          <td style={styles.td}>{formatNumber(metricNumber(run, 'sessions') || run.session_ids.length)}</td>
                          <td style={styles.td}>
                            <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                              {formatDuration(metricNumber(run, 'duration_seconds'))}
                              {hasDurationWarn(run) && <span style={styles.warnBadge}>WARN</span>}
                            </span>
                          </td>
                          <td style={styles.td}>{formatNumber(metricNumber(run, 'total_tokens'))}</td>
                          <td style={styles.td}>{formatCost(metricNumber(run, 'cost_usd_real'))}</td>
                          <td style={styles.td}>{formatCost(metricNumber(run, 'cost_usd_notional'))}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div style={styles.detail}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <h2 style={styles.detailTitle}>
                    {selectedRun ? `${selectedRun.loop_id} · ${selectedRun.run_id}` : 'Select a run'}
                  </h2>
                  {hasDurationWarn(selectedRun) && <span style={styles.warnBadge}>WARN duration sanity flag</span>}
                </div>
                {selectedRun?.notes && <p style={styles.muted}>{selectedRun.notes}</p>}
                {!selectedRun ? (
                  <p style={styles.muted}>Select a run to inspect comparison deltas.</p>
                ) : !selectedComparison ? (
                  <p style={styles.muted}>No baseline comparison for this run.</p>
                ) : (
                  <>
                    <div style={styles.deltaGrid}>
                      {selectedDeltas.map(({ metric, delta }) => {
                        const tone = deltaTone(delta.delta_pct);
                        const sign = delta.delta_pct > 0 ? '+' : '';
                        return (
                          <span
                            key={metric}
                            style={{
                              ...styles.deltaChip,
                              borderColor: tone,
                              color: tone,
                            }}
                          >
                            {metric}: {sign}{delta.delta_pct}% ({delta.before} {'->'} {delta.after})
                          </span>
                        );
                      })}
                    </div>
                    <div style={styles.deltaGrid}>
                      {selectedComparison.flags.length === 0 ? (
                        <span style={styles.badge}>no flags</span>
                      ) : selectedComparison.flags.map((flag) => (
                        <span key={String(flag)} style={styles.badge}>{String(flag)}</span>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
