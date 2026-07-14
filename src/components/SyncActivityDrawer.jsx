import { AlertCircle, Check, Clock3, LoaderCircle, Minus, RotateCw, X } from 'lucide-react';
import './SyncActivityDrawer.css';

const PHASE_LABELS = {
  preflight: 'Prepare local run',
  export_sessions: 'Export sessions',
  verify_artifacts: 'Verify artifacts',
  refresh_limits: 'Refresh usage limits',
};

function relativeTime(ms) {
  if (!ms) return 'never';
  const diff = Math.max(0, Date.now() - Number(ms));
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function PhaseIcon({ status }) {
  if (status === 'succeeded') return <Check size={13} />;
  if (status === 'failed') return <AlertCircle size={13} />;
  if (status === 'warning') return <AlertCircle size={13} />;
  if (status === 'running') return <LoaderCircle className="sync-activity__spin" size={13} />;
  if (status === 'skipped') return <Minus size={13} />;
  return <Clock3 size={13} />;
}

export default function SyncActivityDrawer({ open, status, onClose, onRetry, retrying }) {
  if (!open) return null;
  const state = status?.state || 'idle';
  const artifact = status?.artifact || {};
  const issue = status?.failure || status?.warning;
  const stateLabel = state === 'running' ? 'Sync in progress'
    : state === 'succeeded' ? 'Healthy'
      : state === 'partial' ? 'Completed with warning'
        : state === 'failed' ? 'Needs attention'
          : 'Ready';

  return (
    <section className="sync-activity" role="dialog" aria-label="Sync activity" aria-live="polite">
      <header className="sync-activity__header">
        <div>
          <div className="sync-activity__eyebrow">Background activity</div>
          <h2>Session sync</h2>
        </div>
        <button type="button" className="sync-activity__icon-button" onClick={onClose} aria-label="Close sync activity">
          <X size={16} />
        </button>
      </header>

      <div className={`sync-activity__state sync-activity__state--${state}`}>
        <span className="sync-activity__state-dot" />
        <div>
          <strong>{stateLabel}</strong>
          <span>{state === 'running' ? PHASE_LABELS[status?.phase] || 'Working…' : `Data ${relativeTime(artifact.mtime)}`}</span>
        </div>
      </div>

      {status?.phases?.length > 0 && (
        <ol className="sync-activity__phases">
          {status.phases.map((phase) => (
            <li key={phase.id} data-status={phase.status}>
              <span className="sync-activity__phase-icon"><PhaseIcon status={phase.status} /></span>
              <span>{PHASE_LABELS[phase.id] || phase.id}</span>
              <small>{phase.status}</small>
            </li>
          ))}
        </ol>
      )}

      {issue && (
        <div className="sync-activity__issue">
          <strong>{issue.stage ? `Stopped at ${PHASE_LABELS[issue.stage] || issue.stage}` : 'Sync warning'}</strong>
          <p>{issue.summary}</p>
          {issue.code && <code>{issue.code}</code>}
        </div>
      )}

      <div className="sync-activity__facts">
        <div><span>Sessions</span><strong>{artifact.sessions ?? '—'}</strong></div>
        <div><span>Sources</span><strong>{Object.keys(artifact.source_counts || {}).length || '—'}</strong></div>
        <div><span>Last run</span><strong>{status?.completed_at ? relativeTime(Date.parse(status.completed_at)) : '—'}</strong></div>
      </div>

      <footer className="sync-activity__footer">
        <span>Run details stay local and contain metadata only.</span>
        <button type="button" onClick={onRetry} disabled={retrying || state === 'running'}>
          <RotateCw size={13} />
          {state === 'failed' ? 'Retry' : 'Sync now'}
        </button>
      </footer>
    </section>
  );
}
