import { useEffect, useState } from 'react';
import { AlertCircle, Check, Clock3, GitCommitHorizontal, LoaderCircle, Minus, RotateCw, X } from 'lucide-react';
import './SyncActivityDrawer.css';
import { sourceMeta } from '../lib/sources';
import { fetchStorageSnapshot, formatStorageBytes, isLocalStorageSurface } from '../lib/storage-api';
import { IS_PROD } from '../lib/queries';
import { fetchGithubActivity } from '../lib/github-activity';

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

function runLabel(run) {
  if (!run) return 'no runs';
  if (run.status && run.status !== 'completed') return run.status.replaceAll('_', ' ');
  return run.conclusion ? run.conclusion.replaceAll('_', ' ') : 'completed';
}

function GithubActivity({ activity, unavailable }) {
  if (!activity && !unavailable) return null;
  return (
    <section className="sync-activity__github" aria-label="Repository activity from GitHub">
      <div className="sync-activity__github-head">
        <strong>Code activity</strong>
        <span>{activity?.lastActivityAt ? `GitHub · ${relativeTime(Date.parse(activity.lastActivityAt))}` : 'GitHub'}</span>
      </div>
      {unavailable && !activity && <p>GitHub activity is unavailable right now.</p>}
      {activity?.repos?.map((repo) => {
        if (repo.error) {
          return (
            <div key={repo.repo} className="sync-activity__repo">
              <span className="sync-activity__repo-name">{repo.repo}</span>
              <small>{repo.error === 'rate_limited' ? 'GitHub rate limit reached' : repo.error === 'not_found' ? 'Not visible to this deployment' : 'Unavailable'}</small>
            </div>
          );
        }
        const commit = repo.commits?.[0];
        const run = repo.runs?.[0];
        return (
          <div key={repo.repo} className="sync-activity__repo">
            <span className="sync-activity__repo-name">
              {repo.url ? <a href={repo.url} target="_blank" rel="noopener noreferrer">{repo.repo}</a> : repo.repo}
              <small>{relativeTime(repo.lastActivityAt ? Date.parse(repo.lastActivityAt) : null)}</small>
            </span>
            {commit && (
              <span className="sync-activity__commit">
                <GitCommitHorizontal size={12} aria-hidden="true" />
                <code>{commit.url ? <a href={commit.url} target="_blank" rel="noopener noreferrer">{commit.sha}</a> : commit.sha}</code>
                <span>{commit.message || 'Private commit'}</span>
              </span>
            )}
            {run && (
              <small data-conclusion={run.conclusion || run.status}>
                {run.name ? `${run.name}: ` : 'Latest workflow: '}{runLabel(run)} · {relativeTime(run.updatedAt ? Date.parse(run.updatedAt) : null)}
              </small>
            )}
          </div>
        );
      })}
    </section>
  );
}

function PhaseIcon({ status }) {
  if (status === 'succeeded') return <Check size={13} />;
  if (status === 'failed') return <AlertCircle size={13} />;
  if (status === 'warning') return <AlertCircle size={13} />;
  if (status === 'running') return <LoaderCircle className="sync-activity__spin" size={13} />;
  if (status === 'skipped') return <Minus size={13} />;
  return <Clock3 size={13} />;
}

export default function SyncActivityDrawer({ open, status, onClose, onRetry, onOpenStorage, retrying }) {
  const [storage, setStorage] = useState(null);
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const localStorageSurface = isLocalStorageSurface();
  const [github, setGithub] = useState(null);
  const [githubUnavailable, setGithubUnavailable] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const controller = new AbortController();
    void fetchGithubActivity({ signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      setGithub(result);
      // Local dev servers have no Vercel function; only flag absence on hosted builds.
      setGithubUnavailable(!result && IS_PROD);
    });
    return () => controller.abort();
  }, [open]);

  useEffect(() => {
    if (!open || !localStorageSurface) return undefined;
    const controller = new AbortController();
    void fetchStorageSnapshot(controller.signal)
      .then(result => {
        if (!controller.signal.aborted) {
          setStorage(result);
          setStorageUnavailable(false);
        }
      })
      .catch(() => { if (!controller.signal.aborted) setStorageUnavailable(true); });
    return () => controller.abort();
  }, [open, localStorageSurface]);

  if (!open) return null;
  const state = status?.state || 'idle';
  const disconnected = !status || status.mode === 'refresh-only';
  const hosted = status?.mode === 'hosted-sync';
  const artifact = status?.artifact || {};
  const issue = status?.failure || status?.warning;
  const stateLabel = disconnected ? (IS_PROD ? 'This Mac is not connected' : 'Local sync disconnected') : state === 'running' ? 'Sync in progress'
    : state === 'succeeded' ? 'Last sync succeeded'
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
          <span>{disconnected
            ? (IS_PROD ? 'Start the helper on this Mac, then press Connect. Chrome asks once for local network access.' : 'No local collection status is available.')
            : state === 'running' ? PHASE_LABELS[status?.phase] || 'Working…' : `Data ${relativeTime(artifact.mtime)}`}</span>
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
          {issue.summary && <p>{issue.summary}</p>}
          {issue.code && <code>{issue.code}</code>}
        </div>
      )}

      <div className="sync-activity__facts">
        <div><span>{hosted ? 'Local sessions' : 'Preview sessions'}</span><strong>{artifact.sessions ?? '—'}</strong></div>
        <div><span>{hosted ? 'Local sources' : 'Preview sources'}</span><strong>{Object.keys(artifact.source_counts || {}).length || '—'}</strong></div>
        <div><span>Last run</span><strong>{status?.completed_at ? relativeTime(Date.parse(status.completed_at)) : '—'}</strong></div>
      </div>

      {artifact.source_health && (
        <div className="sync-activity__facts">
          {Object.entries(artifact.source_health).map(([source, health]) => (
            <div key={source}>
              <span>{sourceMeta(source).label}</span>
              <strong>{health.state === 'collected' ? `${health.sessions} collected` : health.state.replaceAll('-', ' ')}</strong>
              {health.coverage?.recovered_steps > 0 && <span>{health.coverage.recovered_steps} steps recovered</span>}
              {health.coverage?.malformed_lines > 0 && <span>{health.coverage.malformed_lines} malformed transcript lines skipped</span>}
            </div>
          ))}
        </div>
      )}
      {disconnected && IS_PROD && (
        <div className="sync-activity__hint">
          <span>On this Mac, in the meow-ops folder:</span>
          <code>npm run agents:install</code>
          <span>or, for this session only: <code>node sync/local-api.mjs</code></span>
        </div>
      )}
      <GithubActivity activity={github} unavailable={githubUnavailable} />
      {localStorageSurface && (
        <section className="sync-activity__storage" aria-label="Local storage summary">
          <div>
            <strong>Local storage</strong>
            <span>{storage?.snapshot
              ? `${formatStorageBytes(storage.snapshot.totals.logicalBytes)} observed · ${storage.snapshot.coverage.completeRoots}/${storage.snapshot.coverage.registeredRoots} locations measured${storage.snapshot.coverage.missingRoots ? ` · ${storage.snapshot.coverage.missingRoots} missing` : ''}`
              : storageUnavailable ? 'Measurement unavailable' : 'Storage has not been measured.'}</span>
            {storage?.snapshot && <small>Measured {new Date(storage.snapshot.generatedAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Kolkata' })} IST</small>}
          </div>
          <button type="button" onClick={onOpenStorage}>View storage</button>
        </section>
      )}
      <footer className="sync-activity__footer">
        <span>{hosted
          ? 'Only run status reaches this page. Sessions stay on this Mac.'
          : disconnected && !IS_PROD ? 'Reloading does not collect local sessions.' : 'Run details stay local and contain metadata only.'}</span>
        <button type="button" onClick={onRetry} disabled={retrying || state === 'running'}>
          <RotateCw size={13} />
          {disconnected ? (IS_PROD ? 'Connect' : 'Reload data') : state === 'failed' ? 'Retry' : 'Sync now'}
        </button>
      </footer>
    </section>
  );
}
