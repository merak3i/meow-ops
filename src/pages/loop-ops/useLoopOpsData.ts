// Loads the Loop-Ops spec from the static data path. Phase 4 upgrades this to
// prefer the local API on 127.0.0.1:7337 (same pattern as lib/queries.js).
// The fixture under public/data/loop-ops/ is LOCAL-ONLY (gitignored via
// public/data/*): the hosted build intentionally shows the instructional
// empty state, per the Phase 0 open-decision default. The Phase 3 importer
// regenerates the file from the Master Spec workbook.
import { useEffect, useState } from 'react';
import { STATUS_SEVERITY } from './types';
import type { LoopEntity, LoopSpec, LoopStatus } from './types';

interface LoopOpsData {
  spec: LoopSpec | null;
  loading: boolean;
  error: string | null;
}

// Per-entity validation, not just top-level shape: this same gate fronts the
// Phase 3 importer output and the Phase 4 local API — one malformed entity
// must fall back to the empty state, not white-screen the route.
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
  const [state, setState] = useState<LoopOpsData>({ spec: null, loading: true, error: null });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/data/loop-ops/spec.json?t=${Date.now()}`);
        if (!res.ok) throw new Error(`spec.json HTTP ${res.status}`);
        const json: unknown = await res.json();
        if (!isValidSpec(json)) throw new Error('spec.json failed shape validation');
        if (!cancelled) setState({ spec: json, loading: false, error: null });
      } catch (err) {
        // Missing spec is a designed state (instructional empty cards), not a crash.
        if (!cancelled) {
          setState({ spec: null, loading: false, error: err instanceof Error ? err.message : String(err) });
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return state;
}
