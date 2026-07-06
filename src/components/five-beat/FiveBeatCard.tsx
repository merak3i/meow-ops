import { RotateCcw } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { Decision, DecisionValue, Proposal } from '@/types/loop';

interface FiveBeatCardProps {
  proposal: Proposal | null;
  latestDecision: Decision | null;
  busy: boolean;
  error: string | null;
  onDecision: (decision: DecisionValue, options?: { undoOf?: string; reason?: string }) => void;
}

const riskColor: Record<string, string> = {
  low: 'var(--green)',
  medium: 'var(--warning)',
  high: '#fb7185',
  critical: '#f43f5e',
};

const styles: Record<string, CSSProperties> = {
  shell: {
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: 20,
    display: 'flex',
    flexDirection: 'column',
    gap: 18,
    minHeight: 520,
  },
  section: {
    borderTop: '1px solid var(--border)',
    paddingTop: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  sectionTitle: {
    margin: 0,
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: 'var(--text-muted)',
  },
  title: { margin: 0, fontSize: 22, lineHeight: 1.25, color: 'var(--text-primary)' },
  row: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  muted: { margin: 0, fontSize: 13, lineHeight: 1.6, color: 'var(--text-secondary)' },
  chip: {
    border: '1px solid var(--border)',
    borderRadius: 999,
    padding: '3px 9px',
    fontSize: 11,
    color: 'var(--text-secondary)',
    background: 'var(--bg-hover)',
  },
  button: {
    border: '1px solid var(--border)',
    borderRadius: 7,
    padding: '8px 12px',
    fontSize: 12,
    color: 'var(--text-primary)',
    background: 'var(--bg-hover)',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  primaryButton: {
    borderColor: 'var(--accent)',
    color: 'var(--bg-main)',
    background: 'var(--accent)',
  },
  pre: {
    margin: 0,
    padding: 12,
    maxHeight: 220,
    overflow: 'auto',
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--bg-main)',
    color: 'var(--text-secondary)',
    fontSize: 11,
    lineHeight: 1.55,
    fontFamily: 'JetBrains Mono, monospace',
    whiteSpace: 'pre-wrap',
  },
};

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return 'n/a';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(formatValue).join(', ');
  if (typeof value === 'object') {
    return Object.entries(value)
      .map(([key, child]) => `${key}: ${formatValue(child)}`)
      .join(' · ');
  }
  return String(value);
}

function creatorKind(createdBy: string) {
  if (createdBy === 'owner') return 'owner';
  if (createdBy.startsWith('assistant:')) return 'assistant';
  return 'rule';
}

function confidencePercent(value: number | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value <= 1 ? value * 100 : value));
}

function diffText(diff: Proposal['diff']) {
  if (!diff) return '';
  if (typeof diff === 'string') return diff;
  if (typeof diff.patch === 'string') return diff.patch;
  return JSON.stringify(diff, null, 2);
}

export function FiveBeatCard({ proposal, latestDecision, busy, error, onDecision }: FiveBeatCardProps) {
  if (!proposal) {
    return (
      <div style={{ ...styles.shell, justifyContent: 'center', alignItems: 'center' }}>
        <p style={styles.muted}>Select a proposal to review.</p>
      </div>
    );
  }

  const confidence = confidencePercent(proposal.confidence);
  const risk = proposal.risk || 'unknown';
  const riskStyle = { color: riskColor[risk] || 'var(--text-secondary)' };
  const diff = diffText(proposal.diff);
  const skeleton = proposal.created_by === 'assistant:loop';
  const pending = proposal.status === 'pending_approval'
    && (!latestDecision || latestDecision.decision === 'undone')
    && !skeleton;
  const reviewOnly = proposal.review_only === true;
  const decisionLine = latestDecision
    ? `${latestDecision.decision} by ${latestDecision.decided_by} at ${new Date(latestDecision.decided_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`
    : 'No owner decision recorded yet.';

  return (
    <article style={styles.shell} data-testid="five-beat-card">
      <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h3 style={styles.sectionTitle}>Notice</h3>
        <h2 style={styles.title}>{proposal.title}</h2>
        <div style={styles.row}>
          <span style={styles.chip}>{proposal.loop_id}</span>
          <span style={styles.chip}>{creatorKind(proposal.created_by)}: {proposal.created_by}</span>
          <span style={styles.chip}>{latestDecision ? latestDecision.decision : proposal.status}</span>
          {skeleton && <span style={styles.chip}>skeleton — complete manually</span>}
          {reviewOnly && <span style={styles.chip}>review only</span>}
        </div>
        <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text-secondary)', fontSize: 12, lineHeight: 1.65 }}>
          {proposal.evidence.map((item, index) => (
            <li key={index}>{formatValue(item)}</li>
          ))}
        </ul>
      </section>

      <section style={styles.section}>
        <h3 style={styles.sectionTitle}>Explain</h3>
        <p style={styles.muted}>{proposal.rationale || 'No rationale supplied.'}</p>
        <div>
          <div style={{ ...styles.row, justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Confidence</span>
            <span style={{ fontSize: 12, color: 'var(--text-primary)' }}>{confidence.toFixed(0)}%</span>
          </div>
          <div style={{ height: 8, borderRadius: 999, background: 'var(--bg-main)', overflow: 'hidden' }}>
            <div style={{ width: `${confidence}%`, height: '100%', background: 'var(--accent)' }} />
          </div>
        </div>
        <p style={styles.muted}>
          Risk: <span style={riskStyle}>{risk}</span>
          {proposal.risk_notes ? ` — ${proposal.risk_notes}` : ''}
        </p>
      </section>

      <section style={styles.section}>
        <h3 style={styles.sectionTitle}>Recommend</h3>
        <div style={{
          border: '1px solid var(--accent)',
          borderRadius: 8,
          padding: 12,
          color: 'var(--text-primary)',
          background: 'color-mix(in srgb, var(--accent) 9%, transparent)',
          fontSize: 13,
        }}>
          {proposal.one_percent_target}
        </div>
        {diff && <pre style={styles.pre}>{diff}</pre>}
        <p style={styles.muted}>Expected benefit: {proposal.expected_benefit || 'Not supplied.'}</p>
        <p style={styles.muted}>Rollback: {proposal.rollback.plan}</p>
      </section>

      <section style={styles.section}>
        <h3 style={styles.sectionTitle}>Approve</h3>
        {skeleton ? (
          <p style={styles.muted}>Skeleton proposal — complete manually before owner approval.</p>
        ) : pending ? (
          <div style={styles.row}>
            {reviewOnly ? (
              <button type="button" disabled={busy} style={styles.button} onClick={() => onDecision('deferred', { reason: 'acknowledged review-only proposal' })}>
                Acknowledge
              </button>
            ) : (
              <button type="button" disabled={busy} style={{ ...styles.button, ...styles.primaryButton }} onClick={() => onDecision('approved')}>
                Approve
              </button>
            )}
            <button type="button" disabled={busy} style={styles.button} onClick={() => onDecision('rejected')}>
              Reject
            </button>
            {!reviewOnly && (
              <button type="button" disabled={busy} style={styles.button} onClick={() => onDecision('deferred')}>
                Defer
              </button>
            )}
          </div>
        ) : (
          <p style={styles.muted}>Proposal is not waiting for approval.</p>
        )}
        {error && <p style={{ ...styles.muted, color: '#fb7185' }}>{error}</p>}
      </section>

      <section style={styles.section}>
        <h3 style={styles.sectionTitle}>Undo / Archive</h3>
        <p style={styles.muted}>{decisionLine}</p>
        {!skeleton && latestDecision && latestDecision.decision !== 'undone' && (
          <button
            type="button"
            disabled={busy}
            style={{ ...styles.button, display: 'inline-flex', alignItems: 'center', gap: 6, width: 'fit-content' }}
            onClick={() => onDecision('undone', { undoOf: latestDecision.decision_id, reason: 'undo' })}
          >
            <RotateCcw size={14} /> Undo
          </button>
        )}
      </section>
    </article>
  );
}
