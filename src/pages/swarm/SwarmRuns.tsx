import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';

import { Badge, Button, Card, EmptyState, Notice } from '../../components/ui';
import { SAMPLE_SWARM, fetchSwarmSnapshot, isLocalSwarmSurface } from '../../lib/swarm-api';
import type { SwarmSnapshot } from '../../lib/swarm-api';
import { RUN_STATUS_META, elapsed, swarmControl } from '../../lib/swarm-control';
import type { RunSummary } from '../../lib/swarm-control';
import { RunMonitor } from './RunMonitor';
import { providerChoices } from './SwarmControl';
import './control.css';

// Swarm · Runs: every orchestrated run, newest first. Live runs refresh on
// their own; open one for the pipeline, outputs and actions.

type Filter = 'all' | 'live' | 'waiting' | 'attention' | 'done' | 'drafts' | 'qa';
const FILTERS: readonly { id: Filter; label: string; test: (run: RunSummary) => boolean }[] = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'live', label: 'Live', test: (run) => run.status === 'running' },
  { id: 'waiting', label: 'Waiting on you', test: (run) => run.waiting > 0 },
  { id: 'attention', label: 'Needs you', test: (run) => run.status === 'needs-attention' },
  { id: 'done', label: 'Done', test: (run) => run.status === 'completed' },
  { id: 'drafts', label: 'Drafts', test: (run) => run.status === 'draft' },
  { id: 'qa', label: 'QA', test: (run) => run.tags.includes('qa') },
];

export default function SwarmRuns() {
  const [local] = useState(isLocalSwarmSurface);
  const client = useMemo(() => swarmControl(), []);
  const [runs, setRuns] = useState<RunSummary[] | null>(local ? null : []);
  const [snapshot, setSnapshot] = useState<SwarmSnapshot | null>(local ? null : SAMPLE_SWARM);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const [list, status] = await Promise.all([client.listRuns(signal), snapshot ? Promise.resolve(snapshot) : fetchSwarmSnapshot(signal)]);
      if (signal?.aborted) return;
      setRuns(list);
      setSnapshot(status);
      setNow(Date.now());
      setError(null);
    } catch (reason) {
      if (!signal?.aborted) setError(reason instanceof Error ? reason.message : 'Runs are unavailable.');
    }
  }, [client, snapshot]);

  useEffect(() => {
    if (!local) return undefined;
    const controller = new AbortController();
    void load(controller.signal);
    const timer = window.setInterval(() => { if (!document.hidden) void load(controller.signal); }, 5000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [local, load]);

  const nameOf = useCallback((id: string) => snapshot?.providers.find((provider) => provider.id === id)?.name ?? id, [snapshot]);
  const choices = useMemo(() => (snapshot ? providerChoices(snapshot) : []), [snapshot]);

  if (!local) return <EmptyState title="Runs stay on your Mac" body="Orchestrated runs, their prompts and outputs live in the local helper. Open the local dashboard to see them." />;
  if (open) return <div className="sc"><RunMonitor runId={open} providers={choices} nameOf={nameOf} onClose={() => { setOpen(null); void load(); }} /></div>;

  const visible = (runs ?? []).filter((run) => FILTERS.find((item) => item.id === filter)?.test(run));
  return (
    <div className="sc">
      {error && <Notice>{error}</Notice>}
      <div className="sc-row sc-row--between">
        <div className="sc-filters" role="tablist" aria-label="Filter runs">
          {FILTERS.map((item) => {
            const count = (runs ?? []).filter(item.test).length;
            return <button key={item.id} type="button" role="tab" aria-selected={filter === item.id} className={`sc-filter${filter === item.id ? ' is-on' : ''}`} onClick={() => setFilter(item.id)}>{item.label} <span className="mo-num">{count}</span></button>;
          })}
        </div>
        <Button size="sm" onClick={() => { void load(); }}><RefreshCw size={12} aria-hidden="true" />Refresh</Button>
      </div>
      {runs === null ? <p className="sc-muted" role="status">Reading runs…</p> : visible.length === 0 ? (
        <EmptyState title={runs.length ? 'Nothing matches this filter' : 'No runs yet'} body={runs.length ? 'Pick another filter.' : 'Plan one in Control: write the goal, break it down, assign harnesses, dispatch.'} />
      ) : (
        <Card pad={false}>
          <div className="sc-table-scroll" tabIndex={0} role="region" aria-label="Orchestrated runs">
            <table className="sc-table">
              <thead><tr><th scope="col">Run</th><th scope="col">Status</th><th scope="col">Steps</th><th scope="col">Harnesses</th><th scope="col">Started</th><th scope="col" className="mo-num">Took</th></tr></thead>
              <tbody>
                {visible.map((run) => {
                  const meta = RUN_STATUS_META[run.status];
                  return (
                    <tr key={run.id}>
                      <th scope="row">
                        <button type="button" className="sc-link" onClick={() => setOpen(run.id)}>{run.title}</button>
                        <small className="sc-mono">{run.workspace}</small>
                      </th>
                      <td>
                        <Badge tone={meta.tone} dot>{meta.label}</Badge>
                        {run.waiting > 0 && <small className="is-warn sc-nowrap">{run.waiting} waiting on you</small>}
                        {run.tags.includes('qa') && <small>QA</small>}
                        {run.purpose === 'plan' && <small>Breakdown</small>}
                      </td>
                      <td className="mo-num">{run.counts.completed ?? 0}/{run.steps}{run.counts.failed ? <small className="is-warn sc-nowrap">{run.counts.failed} failed</small> : null}</td>
                      <td>{run.providers.map(nameOf).join(', ')}</td>
                      <td className="sc-nowrap">{run.dispatchedAt ? new Date(run.dispatchedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Draft'}</td>
                      <td className="mo-num sc-nowrap">{run.dispatchedAt ? elapsed(run.dispatchedAt, run.finishedAt ?? (run.status === 'running' ? null : run.updatedAt), now) : 'Unavailable'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
