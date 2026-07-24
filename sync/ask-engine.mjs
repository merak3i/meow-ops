import { answerProjectQuestion, buildProjectSnapshot } from './project-intelligence.mjs';

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

function syncAnswer(sync, sessionHistory) {
  if (!sync) return 'No sync status is available. Start the local helper, then run a session sync.';
  const count = Number(sync.artifact?.sessions) || 0;
  const archiveTotal = Number(sessionHistory?.archive?.total) || 0;
  const sourceCount = asArray(sessionHistory?.facets?.sources).length
    || Object.keys(sync.artifact?.source_counts || {}).length;
  const archiveEvidence = archiveTotal > 0
    ? `The complete local archive contains ${new Intl.NumberFormat('en-US').format(archiveTotal)} sessions across ${sourceCount} sources${count > 0 && count < archiveTotal ? `; the browser compatibility preview contains the newest ${new Intl.NumberFormat('en-US').format(count)}` : ''}.`
    : null;
  if (sync.state === 'running') return `Sync is running: ${sync.phase || 'preflight'} is the current phase. ${archiveEvidence || `The last verified artifact contains ${count} sessions.`}`;
  if (sync.state === 'failed') return `Sync needs attention. It failed at ${sync.failure?.stage || sync.phase || 'an unknown phase'}: ${sync.failure?.summary || 'no failure summary was recorded'} Retry once; if it repeats, open Sync Activity and use the recorded code ${sync.failure?.code || 'unknown'}.`;
  if (sync.state === 'partial') return `${sync.warning?.summary || 'An optional follow-up step failed.'} ${archiveEvidence || `The verified session artifact is current and contains ${count} sessions.`}`;
  if (sync.state === 'succeeded') return `Sync is healthy. ${archiveEvidence || `The last run verified ${count} sessions across ${sourceCount} sources.`}`;
  return sync.artifact?.available ? `No background run is active. ${archiveEvidence || `The current artifact contains ${count} sessions.`}` : 'No session artifact exists yet. Run Sync sessions to create it.';
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

function findControlProject(question, controls) {
  const q = question.toLowerCase();
  const rows = asArray(controls);
  const match = rows.find((control) => [
    control.project?.name,
    ...(control.project?.aliases || []),
  ].filter(Boolean).some((name) => q.includes(String(name).toLowerCase())));
  return match || (rows.length === 1 ? rows[0] : null);
}

function learningEvidence(candidates) {
  return candidates.flatMap((candidate) => asArray(candidate.evidence)).slice(0, 10);
}

function activityTitle(commit) {
  if (commit.pr_number && String(commit.body || '').trim()) {
    return `PR #${commit.pr_number} — ${String(commit.body).trim().split('\n')[0]}`;
  }
  return String(commit.subject || 'Untitled change')
    .replace(/^(?:feat|fix|docs|chore|refactor|test|perf|build|ci)(?:\([^)]*\))?!?:\s*/i, '');
}

function answerProjectActivity(activity) {
  if (!activity?.requested) return null;
  const requestedName = activity.requested_project;
  if (!activity.project) {
    if (!requestedName) {
      return {
        answer: 'Name the registered project or repository whose local activity you want me to inspect.',
        gate: 'known_unknown',
        confidence: 1,
        evidence: [],
        unknowns: ['Target project for the activity question'],
        next_question: 'Which registered project should I inspect?',
      };
    }
    return {
      answer: `${requestedName} is not registered in local Project Control, so I will not substitute another project's evidence. Register it with its local repository and aliases, then ask again.`,
      gate: 'known_unknown',
      confidence: 1,
      evidence: [],
      unknowns: [`Local project identity and repository for ${requestedName}`],
      next_question: `Will you register ${requestedName} in Project Control and link its local repository?`,
    };
  }

  const commits = asArray(activity.git?.commits);
  const events = asArray(activity.events);
  if (commits.length === 0 && events.length === 0) {
    const gitNote = activity.git?.available === false
      ? ' Its registered root is not a readable Git repository.'
      : '';
    return {
      answer: `I found no local evidence for ${activity.project.name} during ${activity.period?.label || 'the requested period'}.${gitNote}`,
      gate: 'known_unknown',
      confidence: 1,
      evidence: [],
      unknowns: [`Project activity for ${activity.project.name} during ${activity.period?.label || 'the requested period'}`],
      next_question: 'Have the project sessions been synced and the local Git checkout updated?',
    };
  }

  const pullRequests = commits.filter((commit) => commit.pr_number);
  const featureCommits = commits.filter((commit) => !commit.pr_number);
  const highlights = [
    ...pullRequests,
    ...featureCommits,
  ].slice(0, 6);
  const lines = highlights.map((commit) => `- ${activityTitle(commit)} (${String(commit.timestamp || '').slice(0, 10) || 'unknown date'})`);
  const eventOnly = events
    .filter((event) => !commits.some((commit) => commit.short_sha && JSON.stringify(event).includes(commit.short_sha)))
    .slice(0, Math.max(0, 6 - lines.length))
    .map((event) => `- ${event.content || event.event_type || 'Local agent activity'} (${String(event.timestamp || '').slice(0, 10) || 'unknown date'}, ${event.source || 'local'})`);
  lines.push(...eventOnly);

  const prLabel = `${pullRequests.length} merged GitHub PR${pullRequests.length === 1 ? '' : 's'}`;
  const commitLabel = `${commits.length} commit${commits.length === 1 ? '' : 's'}`;
  const evidenceTotal = Math.max(events.length, Number(activity.evidence_total) || 0);
  const evidenceLabel = evidenceTotal > events.length
    ? `${evidenceTotal} matching local agent evidence events (the detailed evidence scan was bounded to ${events.length})`
    : `${events.length} local agent evidence event${events.length === 1 ? '' : 's'}`;
  const sourceNote = commits.length > 0
    ? 'This is derived from the registered checkout’s local Git history, not a live GitHub API response.'
    : 'This is derived from the private local project evidence vault.';
  const unknowns = [];
  if (activity.git?.truncated) unknowns.push('Additional matching Git history beyond the bounded answer preview');
  if (evidenceTotal > events.length) unknowns.push(`${evidenceTotal - events.length} matching local evidence events beyond the bounded detailed scan`);
  return {
    answer: `${activity.project.name} during ${activity.period?.label || 'the requested period'}: ${commitLabel}, including ${prLabel}, plus ${evidenceLabel}.\n${lines.join('\n')}\n${sourceNote}`,
    gate: 'known_known',
    confidence: 0.98,
    evidence: [
      ...commits.slice(0, 10).map((commit) => ({
        kind: commit.pr_number ? 'git_pull_request' : 'git_commit',
        ref: `git:${activity.project.project_id}:${commit.short_sha}`,
        detail: `${String(commit.timestamp || '').slice(0, 10)}${commit.pr_number ? `, GitHub PR #${commit.pr_number}` : ''}`,
      })),
      ...events.slice(0, 10).map((event) => ({
        kind: 'project_evidence',
        ref: event.event_id,
        detail: `${event.source || 'local'} ${event.event_type || 'event'} at ${event.timestamp || 'unknown time'}`,
      })),
    ],
    unknowns,
  };
}

function learningActionLabel(action) {
  const labels = {
    lesson_opened: 'open the lesson',
    concept_preview_completed: 'finish the concept preview',
    exercise_attempted: 'attempt the exercise',
    code_changed: 'make the critical change',
    tests_passed: 'confirm the tests pass',
    broken_case_repaired: 'repair the broken case',
    product_slice_attempted: 'try the smallest useful product slice',
    acceptance_criteria_written: 'write acceptance criteria',
    acceptance_checked: 'check the result against its acceptance criteria',
    story_drafted: 'draft the evidence-led story',
    claim_evidence_checked: 'check every claim against evidence',
    audience_tested: 'test the story with its intended audience',
    experiment_designed: 'design the smallest useful go-to-market experiment',
    channel_tested: 'test the selected channel',
    signal_reviewed: 'review the experiment signal',
    qualification_practiced: 'practice the qualification conversation',
    objection_repaired: 'repair the weakest objection response',
    commitment_reviewed: 'review the next commitment for honesty and value',
    outcome_owner_confirmed: 'confirm a real-world outcome you personally checked',
    feynman_passed: 'complete the first-principles check',
    commit_verified: 'verify the local Git commit',
  };
  return labels[action] || String(action || '').replaceAll('_', ' ');
}

function answerLearningQuest(question, learningQuest) {
  const q = String(question || '').toLowerCase();
  const isRecall = hasKeyword(q, ['recall is due', 'recall due', 'what recall', 'memory refresh']);
  const isNext = hasKeyword(q, [
    'what should i learn', 'learn next', 'learning next', 'resume workshop',
    'resume learning', "builder's journey", 'builder journey',
  ]);
  if (!isRecall && !isNext) return null;
  if (!learningQuest || !Array.isArray(learningQuest.topics)) {
    return {
      answer: "The safe Builder's Journey snapshot is unavailable. Refresh the local helper, then ask again.",
      gate: 'known_unknown', confidence: 1, evidence: [],
      unknowns: ['Current Builder’s Journey snapshot'],
      next_question: 'Is the local learning helper current?',
    };
  }

  if (isRecall) {
    const due = learningQuest.topics.filter((topic) =>
      Number(topic.progress?.action_count) > 0 && topic.recall?.refresh_due);
    return {
      answer: due.length > 0
        ? `${due.length} recall check${due.length === 1 ? ' is' : 's are'} due: ${due.slice(0, 5).map((topic) => topic.title).join(', ')}. Open Builder's Journey → Recall to continue.`
        : 'No recall check is due. Your current learning memory is up to date.',
      gate: 'known_known', confidence: 1,
      evidence: [{ kind: 'learning_quest', ref: 'recall-summary', detail: 'Safe aggregate recall projection' }],
      unknowns: [],
    };
  }

  const focusId = learningQuest.workshop?.focus_topic_id;
  const focus = learningQuest.topics.find((topic) => topic.topic_id === focusId)
    || learningQuest.topics.find((topic) => topic.progress?.next_actions?.length > 0)
    || learningQuest.topics[0];
  if (!focus) {
    return {
      answer: "Your Builder's Journey has no approved learning topic yet.",
      gate: 'known_unknown', confidence: 1, evidence: [],
      unknowns: ['An approved learning topic'],
      next_question: 'Which capability would create the most value if you understood it from first principles?',
    };
  }
  const action = focus.progress?.next_actions?.[0];
  return {
    answer: action
      ? `Continue ${focus.title}: ${learningActionLabel(action)} next. Open Builder's Journey to record the proof explicitly.`
      : `${focus.title} has no unfinished mastery action. Open Builder's Journey → Recall to keep it durable.`,
    gate: 'known_known', confidence: 1,
    evidence: [{
      kind: 'learning_quest',
      ref: focus.topic_id,
      detail: `Safe aggregate stage: ${focus.stage || 'not started'}; workshop: ${learningQuest.workshop?.state || 'none'}`,
    }],
    unknowns: [],
  };
}

function answerProjectControl(question, controls) {
  const q = question.toLowerCase();
  const isCoverage = hasKeyword(q, ['which agents', 'agents know', 'agent coverage', 'blind spot']);
  const isSkill = hasKeyword(q, ['become a skill', 'should be a skill', 'skill candidate']);
  const isLearning = (
    hasKeyword(q, ['project learned', 'project learning', 'what does'])
    || (q.includes('what') && hasKeyword(q, ['learned', 'learnt', 'know']))
  ) && hasKeyword(q, ['learn', 'learnt', 'know']);
  if (!isCoverage && !isSkill && !isLearning) return null;
  const control = findControlProject(q, controls);
  if (!control) {
    return {
      answer: 'I can answer that after you name the governed project.',
      gate: 'known_unknown', confidence: 1, evidence: [], unknowns: ['Target governed project'],
      next_question: 'Which project should I inspect, and why does that project matter for this decision?',
    };
  }
  const name = control.project.name;
  if (isCoverage) {
    const observed = asArray(control.agents?.observed);
    const blind = asArray(control.agents?.blind_spots);
    return {
      answer: `${name} has verified local evidence from ${observed.join(', ') || 'no agents yet'}. Blind spots: ${blind.join(', ') || 'none'}.`,
      gate: 'known_known', confidence: 1,
      evidence: [{ kind: 'project_control', ref: control.project.project_id, detail: 'Observed source coverage from local evidence' }],
      unknowns: blind.map((agent) => `${agent} project evidence`),
    };
  }
  const candidates = asArray(control.learning?.candidates);
  if (isSkill) {
    const skills = candidates.filter((candidate) => candidate.kind === 'skill');
    return skills.length > 0 ? {
      answer: `${name} has ${skills.length} skill candidate${skills.length === 1 ? '' : 's'}: ${skills.map((candidate) => `${candidate.title} (${candidate.status})`).join('; ')}.`,
      gate: 'known_known', confidence: 1, evidence: learningEvidence(skills), unknowns: [],
    } : {
      answer: `${name} has no evidence-backed skill candidate yet.`,
      gate: 'known_unknown', confidence: 1, evidence: [], unknowns: ['A recurring or high-impact capability pattern'],
      next_question: 'Which repeated project task feels valuable enough to standardize, and what outcome would it improve?',
    };
  }
  const published = candidates.filter((candidate) => candidate.status === 'published');
  const pending = candidates.filter((candidate) => candidate.status === 'proposed' || candidate.status === 'deferred');
  if (published.length === 0) {
    return {
      answer: `${name} has no published learning yet${pending.length ? ` and ${pending.length} candidate${pending.length === 1 ? ' is' : 's are'} awaiting owner review` : ''}.`,
      gate: 'known_unknown', confidence: 1, evidence: learningEvidence(pending),
      unknowns: ['Owner-approved project learning'],
      next_question: 'What is the highest-value lesson you want this project to retain, and which outcome would it protect?',
    };
  }
  return {
    answer: `${name} has published ${published.length} learning item${published.length === 1 ? '' : 's'}: ${published.map((candidate) => candidate.title).join('; ')}. ${pending.length} pending owner review.`,
    gate: 'known_known', confidence: 1, evidence: learningEvidence(published),
    unknowns: pending.map((candidate) => `Decision on ${candidate.title}`),
  };
}

export function ask(question, {
  proposals, decisions, runs, digest, sync, sessionHistory, sessions, claims, now,
  projectControls, projectActivity, learningQuest,
} = {}) {
  const q = String(question || '').toLowerCase();
  const proposalRows = latestProposals(asArray(proposals));
  const decisionRows = asArray(decisions);
  const runRows = asArray(runs);
  const proposalMap = new Map(proposalRows.map((proposal) => [proposal.proposal_id, proposal]));
  const proposalTitle = (id) => proposalMap.get(id)?.title || id || 'Unknown proposal';

  const learningQuestAnswer = answerLearningQuest(question, learningQuest);
  if (learningQuestAnswer) return learningQuestAnswer;

  const projectActivityAnswer = answerProjectActivity(projectActivity);
  if (projectActivityAnswer) return projectActivityAnswer;

  const projectAnswer = answerProjectQuestion(
    question,
    buildProjectSnapshot({ sessions, claims }),
    { now: now || new Date() },
  );
  if (projectAnswer) return projectAnswer;

  const projectControlAnswer = answerProjectControl(question, projectControls);
  if (projectControlAnswer) return projectControlAnswer;

  if (hasKeyword(q, ['repair prompt', 'fix prompt'])) return { answer: repairPrompt(sync) };
  if (hasKeyword(q, ['sync', 'fresh', 'stale'])) return { answer: syncAnswer(sync, sessionHistory) };
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
  return {
    answer: FALLBACK_ANSWER,
    gate: 'unknown_unknown',
    confidence: 0,
    evidence: [],
    unknowns: ['The evidence and reasoning path required to answer this question'],
    next_question: 'What local evidence source should Companion use to learn this?',
  };
}
