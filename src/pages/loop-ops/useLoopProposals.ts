import { useEffect, useState } from 'react';
import { fetchLoopDecisions, fetchLoopProposals } from '@/lib/loop-api';
import { countOpenProposals } from './proposal-counts.mjs';

export function useLoopProposals(): ReadonlyMap<string, number> {
  const [counts, setCounts] = useState<ReadonlyMap<string, number>>(new Map());
  useEffect(() => {
    let cancelled = false;
    void Promise.all([fetchLoopProposals(), fetchLoopDecisions()]).then(([proposals, decisions]) => {
      if (!cancelled) setCounts(countOpenProposals(proposals, decisions));
    });
    return () => { cancelled = true; };
  }, []);
  return counts;
}
