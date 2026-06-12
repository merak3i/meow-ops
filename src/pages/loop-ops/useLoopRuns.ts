// Run history (spec §Phase 5). runs.json is the canonical log — appended by
// the operator or the executing agent at run end, never auto-generated
// silently. Costs are enriched by joining sessionIds against the session
// export; a run with no resolvable sessions keeps cost null and says so.
import { useEffect, useState } from 'react';
import { fetchLoopRuns, fetchSessionCosts } from './api';
import type { SessionCost } from './api';
import type { LoopRun } from './types';

export interface EnrichedRun extends LoopRun {
  joined: SessionCost | null;
}

const RUN_STATES = ['planned', 'running', 'passed', 'failed', 'stopped'];

function isValidRun(value: unknown): value is LoopRun {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Partial<LoopRun>;
  return typeof r.id === 'string'
    && typeof r.goal === 'string'
    && RUN_STATES.includes(r.state as string)
    && typeof r.startedAt === 'string'
    && Array.isArray(r.entityIds)
    && Array.isArray(r.sessionIds)
    && Array.isArray(r.artifacts)
    && Array.isArray(r.verified)
    && Array.isArray(r.notVerified);
}

export function useLoopRuns(): { runs: EnrichedRun[]; loading: boolean } {
  const [runs, setRuns] = useState<EnrichedRun[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await fetchLoopRuns();
        const valid = Array.isArray(raw) ? raw.filter(isValidRun) : [];
        const allIds = [...new Set(valid.flatMap((r) => r.sessionIds))];
        const costs = await fetchSessionCosts(allIds);
        if (cancelled) return;
        const enriched = valid.map((run) => {
          const hits = run.sessionIds.map((id) => costs.get(id)).filter((c): c is SessionCost => Boolean(c));
          const joined: SessionCost | null = hits.length === 0 ? null : hits.reduce((acc, c) => ({
            costUsd: acc.costUsd + c.costUsd,
            tokens: acc.tokens + c.tokens,
            durationSeconds: acc.durationSeconds + c.durationSeconds,
            models: [...new Set([...acc.models, ...c.models])],
          }));
          return { ...run, joined };
        });
        // Newest first.
        enriched.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
        setRuns(enriched);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return { runs, loading };
}
