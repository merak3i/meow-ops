import { foldLatestById, readLedger } from './loop-ledger.mjs';

export const OPEN_TERMINAL = new Set(['approved', 'rejected']);

export function latestProposals(records = readLedger('proposal')) {
  return foldLatestById(records, 'proposal_id');
}

export function evidenceHasRule(proposal, ruleRef) {
  return Array.isArray(proposal.evidence)
    && proposal.evidence.some((item) => item && item.kind === 'rule' && item.ref === ruleRef);
}

export function evidenceHasRef(proposal, kind, ref) {
  return Array.isArray(proposal.evidence)
    && proposal.evidence.some((item) => item && item.kind === kind && item.ref === ref);
}

export function hasOpenProposalForRule(ruleRef, records = readLedger('proposal')) {
  return latestProposals(records)
    .some((proposal) => !OPEN_TERMINAL.has(proposal.status) && evidenceHasRule(proposal, ruleRef));
}

export function hasOpenProposalForLoop(loopId, records = readLedger('proposal')) {
  return latestProposals(records)
    .some((proposal) => proposal.loop_id === loopId && !OPEN_TERMINAL.has(proposal.status));
}

export function hasNonRejectedProposalForEvidenceRef(kind, ref, records = readLedger('proposal')) {
  return latestProposals(records)
    .some((proposal) => proposal.status !== 'rejected' && evidenceHasRef(proposal, kind, ref));
}
