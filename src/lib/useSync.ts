import { useCallback, useEffect, useState } from 'react';

import {
  IS_PROD, getSyncStatus, invalidateRealSessions, triggerSync,
  type SyncStatus,
} from './queries';

// Sync state used to live inside the sidebar button. It moved up here because
// the command palette can also trigger a sync, and two components polling the
// same endpoint on their own timers is how you get flickering status.

export type SyncMode = 'sync' | 'refresh';
export type SyncState = 'idle' | 'running' | 'succeeded' | 'partial' | 'failed';

const STATUS_TICK_MS = 30_000;
const RUNNING_POLL_MS = 1200;

function modeFor(status: SyncStatus | null): SyncMode {
  return status?.mode === 'local-sync' || status?.mode === 'dev-sync' ? 'sync' : 'refresh';
}

export function useSync(onReload: () => void) {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [mode, setMode] = useState<SyncMode>(IS_PROD ? 'refresh' : 'sync');
  const [requesting, setRequesting] = useState(false);
  const [, setTick] = useState(0);

  const refreshStatus = useCallback(async () => {
    const next = await getSyncStatus();
    setStatus(next);
    setMode(modeFor(next));
    return next;
  }, []);

  useEffect(() => {
    let mounted = true;
    void getSyncStatus().then((next) => {
      if (!mounted) return;
      setStatus(next);
      setMode(modeFor(next));
    });
    // Re-render on a timer so the "3m ago" label stays truthful without
    // hitting the endpoint again.
    const tick = setInterval(() => setTick((n) => n + 1), STATUS_TICK_MS);
    return () => { mounted = false; clearInterval(tick); };
  }, []);

  useEffect(() => {
    if (status?.state !== 'running') return undefined;
    const poll = setInterval(() => {
      void refreshStatus().then((next) => {
        if (next.state !== 'running' && next.ok) {
          invalidateRealSessions();
          onReload();
        }
      });
    }, RUNNING_POLL_MS);
    return () => clearInterval(poll);
  }, [onReload, refreshStatus, status?.state]);

  const run = useCallback(async () => {
    if (requesting || status?.state === 'running') return;
    setRequesting(true);

    let action = mode;
    if (action === 'refresh' && IS_PROD) {
      // The helper may have come online since the page loaded; re-check before
      // downgrading to a plain reload.
      const latest = await getSyncStatus();
      if (latest.mode === 'local-sync') { setMode('sync'); action = 'sync'; }
    }

    if (action === 'refresh') {
      try { invalidateRealSessions(); onReload(); } finally { setRequesting(false); }
      return;
    }

    const result = await triggerSync();
    if (result.status) setStatus({ ...result.status, mode: status?.mode ?? 'dev-sync' });
    await refreshStatus();
    setRequesting(false);
  }, [mode, onReload, refreshStatus, requesting, status?.mode, status?.state]);

  const state: SyncState = requesting ? 'running' : (status?.state ?? 'idle');

  return {
    status,
    mode,
    state,
    requesting,
    run,
    lastSyncAt: status?.artifact?.mtime ?? status?.mtime ?? null,
    /** True when the local helper answered, so helper-backed surfaces will work. */
    helperOnline: status?.mode === 'local-sync' || status?.mode === 'dev-sync',
  };
}

export type SyncController = ReturnType<typeof useSync>;
