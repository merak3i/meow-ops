// Run history (spec §Phase 5). runs.json is the canonical log — appended by
// the operator or the executing agent at run end, never auto-generated
// silently. Costs are enriched by joining sessionIds against the session
// export; a run with no resolvable sessions keeps cost null and says so.
import { useEffect, useState } from 'react';
import { fetchLoopRuns, fetchSessionCosts } from './api';
import type { SessionCost } from './api';
import type { LoopRun } from './types';
import { isValidLoopRun } from './run-validation.mjs';
import { fetchLoopComparisons } from '@/lib/loop-api';
import type { Comparison } from '@/types/loop';

export interface EnrichedRun extends LoopRun {
  joined: SessionCost | null;
  comparison: Comparison | null;
}

export function useLoopRuns(): { runs: EnrichedRun[]; loading: boolean } {
  const [runs, setRuns] = useState<EnrichedRun[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [raw, comparisons] = await Promise.all([fetchLoopRuns(), fetchLoopComparisons()]);
        const valid = Array.isArray(raw) ? raw.filter(isValidLoopRun) : [];
        const comparisonByRun = new Map(comparisons.map((comparison) => [comparison.run_id, comparison]));
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
          return { ...run, joined, comparison: comparisonByRun.get(run.id) ?? null };
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
