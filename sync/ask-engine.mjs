export const FALLBACK_ANSWER = "I don't know how to answer that yet. Try: pending, cost, health, digest, runs, activity, or drafts.";

const asArray = (value) => (Array.isArray(value) ? value : []);
const money = (value) => `$${value.toFixed(2)}`;
const hasKeyword = (question, keywords) => keywords.some((keyword) => question.includes(keyword));

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

export function ask(question, { proposals, decisions, runs, digest } = {}) {
  const q = String(question || '').toLowerCase();
  const proposalRows = asArray(proposals);
  const decisionRows = asArray(decisions);
  const runRows = asArray(runs);
  const proposalMap = new Map(proposalRows.map((proposal) => [proposal.proposal_id, proposal]));
  const proposalTitle = (id) => proposalMap.get(id)?.title || id || 'Unknown proposal';

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
