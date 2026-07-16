// Run timeline (spec §7 bottom strip): every recorded run with its state,
// joined session cost, artifacts, and the explicit not-verified list. A run
// whose evidence lists are empty deserves suspicion, not celebration.
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { CSSProperties } from 'react';
import { StatusChip } from './StatusChip';
import type { EnrichedRun } from './useLoopRuns';
import type { LoopStatus, LoopRun } from './types';
import { formatSignedPercent, selectRunDeltas } from './run-deltas.mjs';

const RUN_STATUS: Record<LoopRun['state'], LoopStatus> = {
  planned: 'covered',
  running: 'running',
  passed: 'passed',
  failed: 'failed',
  stopped: 'blocked',
};

const bar: CSSProperties = {
  borderTop: '1px solid var(--border)', flexShrink: 0,
  padding: '10px 20px', maxHeight: 220, overflowY: 'auto',
};
const small: CSSProperties = { fontSize: 11, color: 'var(--text-muted)' };

function fmtCost(run: EnrichedRun): string {
  if (run.joined) return `$${run.joined.costUsd.toFixed(2)} · ${(run.joined.tokens / 1e6).toFixed(1)}M tok`;
  if (run.cost) return `$${run.cost.usd.toFixed(2)} · ${(run.cost.tokens / 1e6).toFixed(1)}M tok`;
  return 'cost not linked';
}

function RunCard({ run }: { run: EnrichedRun }) {
  const [open, setOpen] = useState(false);
  const deltas = selectRunDeltas(run.comparison);
  return (
    <div data-testid="loop-run" style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '6px 0' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, background: 'none',
          border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0,
        }}
      >
        {open ? <ChevronDown size={13} color="var(--text-muted)" /> : <ChevronRight size={13} color="var(--text-muted)" />}
        <StatusChip status={RUN_STATUS[run.state]} />
        <span style={{
          fontSize: 12, color: 'var(--text-primary)', overflow: 'hidden',
          textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0,
        }}>
          {run.goal}
        </span>
        <span style={small}>{run.startedAt.slice(0, 10)}</span>
        <span style={small}>{fmtCost(run)}</span>
        {deltas.map((delta) => (
          <span
            key={delta.metric}
            data-testid="loop-run-delta"
            data-tone={delta.tone}
            style={{
              ...small,
              color: delta.tone === 'improving'
                ? 'var(--green)'
                : delta.tone === 'worsening' ? 'var(--warning)' : 'var(--text-muted)',
            }}
          >
            {delta.label} {formatSignedPercent(delta.deltaPct)}
          </span>
        ))}
        <span style={small}>{run.artifacts.length} artifact{run.artifacts.length === 1 ? '' : 's'}</span>
      </button>
      {open && (
        <div style={{ paddingLeft: 23, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 11.5, lineHeight: 1.6 }}>
          <span style={small}>operator: {run.operator}</span>
          {run.artifacts.length > 0 && (
            <span style={{ color: 'var(--text-secondary)' }}>
              {run.artifacts.map((a) => (
                <span key={a.id} style={{ marginRight: 12 }}>
                  {a.pathOrUrl.startsWith('https://')
                    ? <a href={a.pathOrUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-hover)' }}>{a.pathOrUrl.replace('https://github.com/', '')}</a>
                    : <code style={{ fontSize: 10.5 }}>{a.pathOrUrl}</code>}
                  {a.reviewStatus !== 'accepted' && <span style={small}> ({a.reviewStatus})</span>}
                </span>
              ))}
            </span>
          )}
          <span style={{ color: 'var(--loop-passed)' }}>verified: {run.verified.length ? run.verified.join(' · ') : 'NOTHING — treat with suspicion'}</span>
          <span style={{ color: 'var(--loop-needs-review)' }}>not verified: {run.notVerified.length ? run.notVerified.join(' · ') : 'nothing declared'}</span>
        </div>
      )}
    </div>
  );
}

export function RunTimeline({ runs, loading }: { runs: EnrichedRun[]; loading: boolean }) {
  return (
    <div style={bar} data-testid="loop-run-timeline">
      <p style={{ ...small, textTransform: 'uppercase', letterSpacing: 0.6, margin: '0 0 4px' }}>
        Run timeline
      </p>
      {loading ? (
        <p style={small}>Loading runs…</p>
      ) : runs.length === 0 ? (
        <p style={small}>
          No runs recorded — append a run entry to public/data/loop-ops/runs.json
          when a loop run ends (Operator SOP §5). Runs only exist when recorded with evidence.
        </p>
      ) : (
        runs.map((run) => <RunCard key={run.id} run={run} />)
      )}
    </div>
  );
}
