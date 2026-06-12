// Loads the Loop-Ops spec (static-first with local-API fallback — see api.ts)
// plus file-freshness status, and exposes a refresh action that re-runs the
// workbook importer through the local API. The data files are LOCAL-ONLY
// (gitignored); the hosted build without a running local API intentionally
// shows the instructional empty state.
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchLoopSpecRaw, fetchLoopStatus, postLoopSync } from './api';
import type { LoopOpsStatus } from './api';
import { STATUS_SEVERITY } from './types';
import type { LoopEntity, LoopSpec, LoopStatus } from './types';

interface LoopOpsData {
  spec: LoopSpec | null;
  status: LoopOpsStatus | null;
  loading: boolean;
  syncing: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

// Per-entity validation, not just top-level shape: this gate fronts the
// importer output and the local API — one malformed entity must fall back to
// the empty state, not white-screen the route.
function isValidEntity(value: unknown): value is LoopEntity {
  if (typeof value !== 'object' || value === null) return false;
  const e = value as Partial<LoopEntity>;
  return typeof e.id === 'string'
    && (e.kind === 'coordinator' || e.kind === 'director' || e.kind === 'assistant')
    && typeof e.label === 'string'
    && STATUS_SEVERITY.includes(e.status as LoopStatus)
    && Array.isArray(e.sources)
    && Array.isArray(e.repoLinks)
    && Array.isArray(e.allowedActions);
}

function isValidSpec(value: unknown): value is LoopSpec {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<LoopSpec>;
  return Array.isArray(candidate.entities)
    && candidate.entities.every(isValidEntity)
    && Array.isArray(candidate.edges)
    && typeof candidate.meta === 'object' && candidate.meta !== null
    && typeof (candidate.meta as { generatedAt?: unknown }).generatedAt === 'string';
}

export function useLoopOpsData(): LoopOpsData {
  const [spec, setSpec] = useState<LoopSpec | null>(null);
  const [status, setStatus] = useState<LoopOpsStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  // Re-arm on every mount — StrictMode dev runs mount→cleanup→mount, and the
  // ref object survives that cycle; a cleanup-only effect would leave it false.
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const load = useCallback(async () => {
    try {
      const [rawSpec, freshStatus] = await Promise.all([fetchLoopSpecRaw(), fetchLoopStatus()]);
      if (!alive.current) return;
      if (!isValidSpec(rawSpec)) throw new Error('spec failed shape validation');
      setSpec(rawSpec);
      setStatus(freshStatus);
      setError(null);
    } catch (err) {
      if (!alive.current) return;
      setSpec(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (alive.current) setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const refresh = useCallback(async () => {
    setSyncing(true);
    try {
      const result = await postLoopSync();
      await load();
      // Re-set AFTER load: a failed import leaves the previous spec.json in
      // place, so the reload succeeds and would otherwise wipe the message.
      if (!result.ok && alive.current) {
        setError(result.stderr?.trim() || result.error || `import exited ${result.code ?? '?'}`);
      }
    } finally {
      if (alive.current) setSyncing(false);
    }
  }, [load]);

  return { spec, status, loading, syncing, error, refresh };
}
