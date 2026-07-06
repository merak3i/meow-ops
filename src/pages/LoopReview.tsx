import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { ToggleGroup } from '@/components/ui/ToggleGroup';
import { FiveBeatCard } from '@/components/five-beat/FiveBeatCard';
import {
  fetchLoopComparisons,
  fetchLoopDecisions,
  fetchLoopOutcomes,
  fetchLoopProposals,
  fetchLoopRuns,
  fetchLoopSimulations,
  fetchLoopSummary,
  postLoopDecision,
} from '@/lib/loop-api';
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

type View = 'proposals' | 'runs';
type Filter = 'pending' | 'drafts' | 'decided' | 'all';

const VIEWS: { value: View; label: string }[] = [
  { value: 'proposals', label: 'Proposals' },
  { value: 'runs', label: 'Runs' },
];

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'drafts', label: 'Drafts' },
  { value: 'decided', label: 'Decided' },
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
  if (latest?.decision === 'undone') return false;
  return Boolean(latest) || ['approved', 'rejected', 'applied', 'rolled_back'].includes(proposal.status);
}

function isSkeleton(proposal: Proposal) {
  return proposal.created_by === 'assistant:loop';
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
  const [summary, setSummary] = useState<LoopSummary>({ counts_by_status: {}, open_per_loop: {}, total: 0 });
  const [filter, setFilter] = useState<Filter>('pending');
  const [loopFilter, setLoopFilter] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
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
    ] = await Promise.all([
      fetchLoopProposals(),
      fetchLoopDecisions(),
      fetchLoopSummary(),
      fetchLoopRuns(),
      fetchLoopComparisons(),
      fetchLoopSimulations(),
      fetchLoopOutcomes(),
    ]);
    setProposals(nextProposals);
    setDecisions(nextDecisions);
    setSummary(nextSummary);
    setRuns(nextRuns);
    setComparisons(nextComparisons);
    setSimulations(nextSimulations);
    setOutcomes(nextOutcomes);
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

  const filtered = useMemo(() => {
    return sorted.filter((proposal) => {
      const latest = latestByProposal.get(proposal.proposal_id);
      if (filter === 'all') return true;
      if (filter === 'pending') return proposal.status === 'pending_approval' && (!latest || latest.decision === 'undone');
      if (filter === 'drafts') return proposal.status === 'draft' || proposal.status === 'simulated';
      return isDecided(proposal, latest);
    });
  }, [filter, latestByProposal, sorted]);

  const sortedRuns = useMemo(() => {
    return [...runs].sort((a, b) => b.captured_at.localeCompare(a.captured_at));
  }, [runs]);

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
            />
          </div>
        )
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
