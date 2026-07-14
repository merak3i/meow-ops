export const FALLBACK_ANSWER = "I don't know how to answer that from local evidence yet. Try: what changed today, sync health, what should I fix next, pending, cost, or activity.";

const asArray = (value) => (Array.isArray(value) ? value : []);
const money = (value) => `$${value.toFixed(2)}`;
const hasKeyword = (question, keywords) => keywords.some((keyword) => question.includes(keyword));

function latestProposals(proposals) {
  const byId = new Map();
  for (const proposal of proposals) byId.set(proposal.proposal_id, proposal);
  return [...byId.values()];
}

function date(value) {
  if (!value) return 'unknown date';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString().slice(0, 10);
}

function listTitles(items) {
  if (items.length === 0) return '.';
  const lines = items.slice(0, 5).map((item) => `- ${item.title || item.proposal_id || 'Untitled proposal'}`);
  if (items.length > 5) lines.push(`and ${items.length - 5} more`);
  return `:\n${lines.join('\n')}`;
}

function proposalsByStatus(proposals, statuses, label) {
  const matches = proposals.filter((proposal) => statuses.includes(proposal.status));
  return `${matches.length} ${label}${matches.length === 1 ? '' : 's'}${listTitles(matches)}`;
}

function sumCost(runs, key) {
  return runs.reduce((total, run) => total + (Number(run.metrics?.[key]) || 0), 0);
}

function syncAnswer(sync) {
  if (!sync) return 'No sync status is available. Start the local helper, then run a session sync.';
  const count = Number(sync.artifact?.sessions) || 0;
  if (sync.state === 'running') return `Sync is running: ${sync.phase || 'preflight'} is the current phase. The last verified artifact contains ${count} sessions.`;
  if (sync.state === 'failed') return `Sync needs attention. It failed at ${sync.failure?.stage || sync.phase || 'an unknown phase'}: ${sync.failure?.summary || 'no failure summary was recorded'} Retry once; if it repeats, open Sync Activity and use the recorded code ${sync.failure?.code || 'unknown'}.`;
  if (sync.state === 'partial') return `${sync.warning?.summary || 'An optional follow-up step failed.'} The verified session artifact is current and contains ${count} sessions.`;
  if (sync.state === 'succeeded') return `Sync is healthy. The last run verified ${count} sessions across ${Object.keys(sync.artifact?.source_counts || {}).length} sources.`;
  return sync.artifact?.available ? `No background run is active. The current artifact contains ${count} sessions.` : 'No session artifact exists yet. Run Sync sessions to create it.';
}

function nextFix({ proposals, digest, sync }) {
  if (sync?.state === 'failed') return syncAnswer(sync);
  const flagged = asArray(digest?.health?.agents).filter((agent) => asArray(agent.flags).length > 0);
  if (flagged.length > 0) return `Fix ${flagged[0].label} first: ${flagged[0].flags.join(', ')}. Confirm the process and its latest log before changing code.`;
  const pending = latestProposals(asArray(proposals)).filter((proposal) => proposal.status === 'pending_approval');
  if (pending.length > 0) return `Review “${pending[0].title || pending[0].proposal_id}” next. It is the first of ${pending.length} pending proposals; inspect evidence and simulation before approving.`;
  return 'Nothing is currently flagged or awaiting approval. Run the daily review to look for a new blind spot.';
}

function repairPrompt(sync) {
  if (sync?.state !== 'failed') return 'No failed sync is recorded, so a repair prompt would be guesswork. Run Sync sessions first and ask again only if it fails.';
  return [
    'Repair brief:',
    `- Reproduce the failure in phase: ${sync.failure?.stage || sync.phase || 'unknown'}`,
    `- Evidence code: ${sync.failure?.code || 'unknown'}`,
    `- Observed summary: ${sync.failure?.summary || 'none'}`,
    '- Inspect only the runner, launch configuration, and referenced script for that phase.',
    '- Make the smallest fix, rerun the phase, then verify sessions.json metadata and all sync-runner tests.',
    '- Do not expose transcript content or add a git push path.',
  ].join('\n');
}

export function ask(question, { proposals, decisions, runs, digest, sync } = {}) {
  const q = String(question || '').toLowerCase();
  const proposalRows = latestProposals(asArray(proposals));
  const decisionRows = asArray(decisions);
  const runRows = asArray(runs);
  const proposalMap = new Map(proposalRows.map((proposal) => [proposal.proposal_id, proposal]));
  const proposalTitle = (id) => proposalMap.get(id)?.title || id || 'Unknown proposal';

  if (hasKeyword(q, ['repair prompt', 'fix prompt'])) return { answer: repairPrompt(sync) };
  if (hasKeyword(q, ['sync', 'fresh', 'stale'])) return { answer: syncAnswer(sync) };
  if (hasKeyword(q, ['fix next', 'should i fix', 'next priority', 'next move'])) {
    return { answer: nextFix({ proposals: proposalRows, digest, sync }) };
  }
  if (hasKeyword(q, ['changed today', 'today change', 'what changed'])) {
    if (!digest) return { answer: 'No daily digest is available yet. Run the daily review, then ask again.' };
    return {
      answer: `Today: ${digest.capture?.sessions || 0} sessions captured, ${digest.intake?.stored || 0} useful intake items stored, ${digest.health?.flagged || 0} automations flagged, and ${digest.proposals?.new_drafts || 0} new review drafts.`,
    };
  }

  if (hasKeyword(q, ['pending'])) {
    return { answer: proposalsByStatus(proposalRows, ['pending_approval'], 'pending proposal') };
  }
  if (hasKeyword(q, ['approved'])) {
    return { answer: proposalsByStatus(proposalRows, ['approved'], 'approved proposal') };
  }
  if (hasKeyword(q, ['rejected'])) {
    return { answer: proposalsByStatus(proposalRows, ['rejected'], 'rejected proposal') };
  }
  if (hasKeyword(q, ['cost', 'spend', 'money'])) {
    return {
      answer: `${money(sumCost(runRows, 'cost_usd_real'))} real / ${money(sumCost(runRows, 'cost_usd_notional'))} notional across ${runRows.length} runs.`,
    };
  }
  if (hasKeyword(q, ['health', 'agent', 'failing'])) {
    const health = digest?.health;
    if (!health) return { answer: 'No digest health data available.' };
    const flagged = asArray(health.agents).filter((agent) => asArray(agent.flags).length > 0);
    const lines = flagged.slice(0, 5).map((agent) => `- ${agent.label}: ${agent.flags.join(', ')}`);
    if (flagged.length > 5) lines.push(`and ${flagged.length - 5} more`);
    return {
      answer: `Health: ${health.agents_total || 0} agents, ${health.flagged || 0} flagged${lines.length ? `\n${lines.join('\n')}` : '.'}`,
    };
  }
  if (hasKeyword(q, ['session', 'capture'])) {
    return { answer: `Latest digest captured ${digest?.capture?.sessions || 0} sessions.` };
  }
  if (hasKeyword(q, ['digest', 'summary'])) {
    if (!digest) return { answer: 'No digest available.' };
    const period = digest.period ? `${date(digest.period.since)} to ${date(digest.period.until)}` : 'unknown period';
    return {
      answer: `Digest ${period}: ${digest.capture?.sessions || 0} sessions, ${digest.intake?.stored || 0} intake stored, ${digest.health?.flagged || 0} flagged, ${digest.proposals?.new_drafts || 0} new proposals, ${digest.proposals?.pending || 0} pending.`,
    };
  }
  if (hasKeyword(q, ['run', 'runs'])) {
    const latest = [...runRows].sort((a, b) => String(b.captured_at).localeCompare(String(a.captured_at)))[0];
    return { answer: `${runRows.length} runs. Latest run: ${latest ? date(latest.captured_at) : 'none'}.` };
  }
  if (hasKeyword(q, ['decision', 'activity', 'recent'])) {
    const lines = [...decisionRows]
      .sort((a, b) => String(b.decided_at).localeCompare(String(a.decided_at)))
      .slice(0, 5)
      .map((decision) => `- ${date(decision.decided_at)} ${decision.decision}: ${proposalTitle(decision.proposal_id)}`);
    return { answer: lines.length ? `Recent decisions:\n${lines.join('\n')}` : 'No recent decisions.' };
  }
  if (hasKeyword(q, ['draft'])) {
    return { answer: proposalsByStatus(proposalRows, ['draft', 'simulated'], 'draft proposal') };
  }
  if (hasKeyword(q, ['execute', 'applied'])) {
    return { answer: proposalsByStatus(proposalRows, ['applied'], 'applied proposal') };
  }
  return { answer: FALLBACK_ANSWER };
}
