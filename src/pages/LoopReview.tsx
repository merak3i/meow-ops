import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { ToggleGroup } from '@/components/ui/ToggleGroup';
import { FiveBeatCard } from '@/components/five-beat/FiveBeatCard';
import {
  fetchLoopDecisions,
  fetchLoopProposals,
  fetchLoopSummary,
  postLoopDecision,
} from '@/lib/loop-api';
import type { Decision, DecisionValue, LoopSummary, Proposal } from '@/types/loop';

type Filter = 'pending' | 'drafts' | 'decided' | 'all';

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
  badgeRow: { display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' },
  badge: {
    border: '1px solid var(--border)',
    borderRadius: 999,
    padding: '4px 10px',
    fontSize: 11,
    color: 'var(--text-secondary)',
    background: 'var(--bg-card)',
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

export default function LoopReview() {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [summary, setSummary] = useState<LoopSummary>({ counts_by_status: {}, open_per_loop: {}, total: 0 });
  const [filter, setFilter] = useState<Filter>('pending');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [nextProposals, nextDecisions, nextSummary] = await Promise.all([
      fetchLoopProposals(),
      fetchLoopDecisions(),
      fetchLoopSummary(),
    ]);
    setProposals(nextProposals);
    setDecisions(nextDecisions);
    setSummary(nextSummary);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const latestByProposal = useMemo(() => latestDecisionByProposal(decisions), [decisions]);

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

  useEffect(() => {
    if (filtered.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !filtered.some((proposal) => proposal.proposal_id === selectedId)) {
      setSelectedId(filtered[0]?.proposal_id ?? null);
    }
  }, [filtered, selectedId]);

  const selected = filtered.find((proposal) => proposal.proposal_id === selectedId) ?? null;
  const selectedDecision = selected ? latestByProposal.get(selected.proposal_id) ?? null : null;

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
          <p style={styles.subtitle}>Owner approval queue for Loop Engineering proposals.</p>
        </div>
        <div style={styles.badgeRow}>
          <span style={styles.badge}>{summary.total} proposals</span>
          <span style={styles.badge}>{summary.counts_by_status.pending_approval || 0} pending</span>
          <span style={styles.badge}>{Object.keys(summary.open_per_loop).length} open loops</span>
        </div>
      </header>

      {loading ? (
        <div style={styles.empty}>Loading Review Deck…</div>
      ) : proposals.length === 0 ? (
        <div style={styles.empty}>No proposals yet — run npm run loop:propose</div>
      ) : (
        <div style={styles.grid}>
          <aside style={styles.queue}>
            <div style={styles.queueHeader}>
              <h2 style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>Proposal Queue</h2>
              <ToggleGroup value={filter} onChange={(value: Filter) => setFilter(value)} options={FILTERS} size="sm" ariaLabel="Proposal status filter" />
            </div>
            <div style={styles.list}>
              {filtered.length === 0 ? (
                <div style={styles.empty}>No proposals match this filter.</div>
              ) : filtered.map((proposal) => {
                const latest = latestByProposal.get(proposal.proposal_id);
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
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                      {proposal.loop_id} · {latest ? latest.decision : proposal.status} · {Math.round(confidenceValue(proposal) * 100)}%
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>
          <FiveBeatCard
            proposal={selected}
            latestDecision={selectedDecision}
            busy={busy}
            error={error}
            onDecision={handleDecision}
          />
        </div>
      )}
    </div>
  );
}
