import { entityIdForLoopId } from './loop-entity-map.mjs';

export function countOpenProposals(proposals, decisions) {
  const latestDecision = new Map();
  for (const decision of Array.isArray(decisions) ? decisions : []) {
    const prior = latestDecision.get(decision.proposal_id);
    if (!prior || String(decision.decided_at).localeCompare(String(prior.decided_at)) > 0) {
      latestDecision.set(decision.proposal_id, decision);
    }
  }
  const counts = new Map();
  for (const proposal of Array.isArray(proposals) ? proposals : []) {
    if (!['draft', 'simulated', 'pending_approval'].includes(proposal.status)) continue;
    if (latestDecision.has(proposal.proposal_id)) continue;
    const entityId = entityIdForLoopId(proposal.loop_id);
    if (entityId) counts.set(entityId, (counts.get(entityId) ?? 0) + 1);
  }
  return counts;
}
