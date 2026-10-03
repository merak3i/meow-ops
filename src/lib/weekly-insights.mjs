const DEFAULT_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

function localMonday(value) {
  const monday = new Date(value);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return monday;
}

export function weeklyEvidenceWindow(now = new Date()) {
  const current = new Date(now);
  if (!Number.isFinite(current.getTime())) throw new TypeError('A valid reference time is required.');
  const currentStart = localMonday(current);
  const previousStart = new Date(currentStart);
  previousStart.setDate(previousStart.getDate() - 7);
  const previousEnd = new Date(current);
  previousEnd.setDate(previousEnd.getDate() - 7);
  return {
    from: previousStart.toISOString(),
    to: current.toISOString(),
    currentStart: currentStart.toISOString(),
    previousStart: previousStart.toISOString(),
    previousEnd: previousEnd.toISOString(),
    timeZone: DEFAULT_TIME_ZONE,
  };
}

function activityTime(session) {
  const value = Date.parse(session.ended_at || session.started_at || '');
  return Number.isFinite(value) ? value : null;
}

function sessionKey(session) {
  return JSON.stringify([session.source || 'claude', session.session_id]);
}

function isChild(session) {
  return session.is_subagent === true || session.is_sidechain === true || Number(session.agent_depth) > 0;
}

function independentSessions(sessions, from, to, sourceFilter) {
  const seen = new Set();
  return sessions.filter((session) => {
    if (!session || typeof session.session_id !== 'string' || isChild(session)) return false;
    if (sourceFilter && (session.source || 'claude') !== sourceFilter) return false;
    const time = activityTime(session);
    if (time === null || time < from || time > to) return false;
    const key = sessionKey(session);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function matchingSessions(sessions, predicate) {
  return sessions.filter(predicate);
}

function topProjects(sessions) {
  const counts = new Map();
  for (const session of sessions) {
    const project = typeof session.project === 'string' && session.project.trim() ? session.project.trim() : 'Unknown project';
    counts.set(project, (counts.get(project) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 2).map(([name]) => name);
}

function evidenceFor(sessions) {
  return sessions.slice(0, 4).map((session) => ({
    sessionId: session.session_id,
    source: session.source || 'claude',
    project: typeof session.project === 'string' && session.project.trim() ? session.project.trim() : 'Unknown project',
    activityAt: session.ended_at || session.started_at,
  }));
}

function card(id, title, what, why, action, matches, previousMatches, previousTotal) {
  return {
    id,
    title,
    what,
    why,
    action,
    sessionCount: matches.length,
    previousCount: previousMatches.length,
    previousTotal,
    projects: topProjects(matches),
    evidence: evidenceFor(matches),
  };
}

function normalizedTitle(session) {
  const value = String(session.session_title || '').trim().toLocaleLowerCase().replace(/\s+/g, ' ');
  return value.length >= 8 ? value : '';
}

function childWorkflowParents(sessions) {
  const childParents = new Set();
  const parents = new Set(sessions.map(sessionKey));
  for (const session of sessions) {
    const parent = session.parent_session_id;
    if (typeof parent !== 'string' || !parent) continue;
    const candidate = JSON.stringify([session.source || 'claude', parent]);
    if (parents.has(candidate)) childParents.add(candidate);
  }
  return childParents;
}

function sourceWarnings(sourceCoverage) {
  if (!sourceCoverage || typeof sourceCoverage !== 'object') return ['Harness collection coverage was not included with this snapshot.'];
  return Object.entries(sourceCoverage)
    .filter(([, item]) => !item || !['collected'].includes(item.state))
    .map(([source, item]) => `${source}: ${item?.state || 'coverage unavailable'}`);
}

function receiptCards(snapshot, window, archiveVersion, sourceFilter, warnings) {
  if (!snapshot) return [];
  const matches = snapshot.schemaVersion === 1 && archiveVersion && snapshot.archiveVersion === archiveVersion
    && Object.keys(window).every((field) => snapshot.window?.[field] === window[field]);
  if (!matches) {
    warnings.push('Detailed receipt patterns do not match this archive version and exact weekly period. They were excluded.');
    return [];
  }
  warnings.push(...(snapshot.coverage?.limitations || []));
  if (snapshot.coverage?.status !== 'available') return [];
  const cards = snapshot.scopes?.[sourceFilter || 'all']?.cards;
  return Array.isArray(cards) ? cards.filter((item) => item?.evidenceKind === 'tool-receipt' && item.sessionCount >= 2) : [];
}

export function buildWeeklyInsights(sessions, {
  now = new Date(),
  sourceFilter = null,
  completeness = 'archive',
  sourceCoverage = null,
  weeklyEvidencePatterns = null,
  archiveVersion = null,
} = {}) {
  const window = weeklyEvidenceWindow(now);
  const currentStart = Date.parse(window.currentStart);
  const previousStart = Date.parse(window.previousStart);
  const previousEnd = Date.parse(window.previousEnd);
  const currentEnd = Date.parse(window.to);
  const coverageWarnings = sourceWarnings(sourceCoverage);
  if (completeness !== 'archive') {
    return {
      status: 'incomplete', window, timeZone: window.timeZone, coverageWarnings,
      cards: [], observedSessions: 0,
      message: 'The complete, version-pinned local archive is unavailable. I cannot verify recurring weekly patterns from a preview.',
    };
  }
  const rows = Array.isArray(sessions) ? sessions : [];
  const current = independentSessions(rows, currentStart, currentEnd, sourceFilter);
  const previous = independentSessions(rows, previousStart, previousEnd, sourceFilter);
  const cards = receiptCards(weeklyEvidencePatterns, window, archiveVersion, sourceFilter, coverageWarnings);
  const add = (currentMatches, previousMatches, details) => {
    if (currentMatches.length < 2) return;
    cards.push(card(...details, currentMatches, previousMatches, previous.length));
  };

  const currentGhosts = matchingSessions(current, (session) => session.is_ghost === true);
  const previousGhosts = matchingSessions(previous, (session) => session.is_ghost === true);
  add(currentGhosts, previousGhosts, [
    'no-assistant-output', 'Sessions without assistant output',
    `${currentGhosts.length} independent sessions were marked as producing no assistant output.`,
    'This can point to cancelled starts, failed collection, or work that moved elsewhere; the session count alone cannot tell which.',
    'Open one example and check whether it was cancelled, a test run, or a collection gap.',
  ]);

  const currentLongTurns = matchingSessions(current, (session) => Number(session.user_message_count) >= 8);
  const previousLongTurns = matchingSessions(previous, (session) => Number(session.user_message_count) >= 8);
  add(currentLongTurns, previousLongTurns, [
    'many-user-turns', 'Long back-and-forth sessions',
    `${currentLongTurns.length} independent sessions contain at least eight user messages.`,
    'Several turns can mean the request changed, details were added, or a difficult problem needed discussion. This does not prove rework.',
    'Compare the first request with the final scope in one session before deciding whether a reusable brief would help.',
  ]);

  const currentSearch = matchingSessions(current, (session) => {
    const tools = session.tools && typeof session.tools === 'object' ? session.tools : {};
    const total = Object.values(tools).reduce((sum, value) => sum + (Number(value) || 0), 0);
    const search = (Number(tools.Grep) || 0) + (Number(tools.Glob) || 0);
    return total >= 4 && search >= 3 && search / total >= 0.25;
  });
  const previousSearch = matchingSessions(previous, (session) => {
    const tools = session.tools && typeof session.tools === 'object' ? session.tools : {};
    const total = Object.values(tools).reduce((sum, value) => sum + (Number(value) || 0), 0);
    const search = (Number(tools.Grep) || 0) + (Number(tools.Glob) || 0);
    return total >= 4 && search >= 3 && search / total >= 0.25;
  });
  add(currentSearch, previousSearch, [
    'search-led-work', 'Search-heavy sessions',
    `Code search made up at least a quarter of the recorded tool calls in ${currentSearch.length} independent sessions.`,
    'Search activity can help locate the right files before editing. Tool counts do not show whether the search found the cause.',
    'Check one example to see whether the search path is worth keeping as a short repeatable check.',
  ]);

  const currentParents = childWorkflowParents(rows.filter((session) => {
    const time = activityTime(session);
    return time !== null && time >= currentStart && time <= currentEnd
      && (!sourceFilter || (session.source || 'claude') === sourceFilter);
  }));
  const previousParents = childWorkflowParents(rows.filter((session) => {
    const time = activityTime(session);
    return time !== null && time >= previousStart && time <= previousEnd
      && (!sourceFilter || (session.source || 'claude') === sourceFilter);
  }));
  const currentOrchestration = current.filter((session) => currentParents.has(sessionKey(session)));
  const previousOrchestration = previous.filter((session) => previousParents.has(sessionKey(session)));
  add(currentOrchestration, previousOrchestration, [
    'parent-child-work', 'Work split across child agents',
    `${currentOrchestration.length} independent parent sessions have at least one linked child-agent session.`,
    'Splitting work can help parallelize a task, but counts do not establish that the returned work was reviewed or combined.',
    'Review one parent and child pair for a clear handoff and a verified final result.',
  ]);

  const currentTitles = new Map();
  const previousTitles = new Map();
  for (const session of current) {
    const title = normalizedTitle(session);
    if (!title) continue;
    const key = JSON.stringify([session.project || '', title]);
    currentTitles.set(key, [...(currentTitles.get(key) || []), session]);
  }
  for (const session of previous) {
    const title = normalizedTitle(session);
    if (!title) continue;
    const key = JSON.stringify([session.project || '', title]);
    previousTitles.set(key, [...(previousTitles.get(key) || []), session]);
  }
  const repeatedTopics = [...currentTitles.entries()]
    .filter(([, matches]) => matches.length >= 2)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .flatMap(([, matches]) => matches);
  const priorRepeatedTopics = [...previousTitles.values()].filter((matches) => matches.length >= 2).flatMap((matches) => matches);
  add(repeatedTopics, priorRepeatedTopics, [
    'repeated-session-title', 'A session title appeared more than once',
    `The same session title was used in ${repeatedTopics.length} independent sessions in the same project.`,
    'This may be a repeated task or a continuation. Titles are labels and do not prove that the work was duplicated.',
    'Compare the two sessions before treating them as a repeat or making a template.',
  ]);

  const currentProjects = new Map();
  const previousProjects = new Map();
  for (const session of current) currentProjects.set(session.project || 'Unknown project', [...(currentProjects.get(session.project || 'Unknown project') || []), session]);
  for (const session of previous) previousProjects.set(session.project || 'Unknown project', [...(previousProjects.get(session.project || 'Unknown project') || []), session]);
  const topProject = [...currentProjects.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))[0];
  if (topProject && topProject[1].length >= 2 && topProject[1].length / Math.max(1, current.length) >= 0.35) {
    cards.push(card(
      'project-focus', 'Most recorded sessions were in one project',
      `${topProject[1].length} of ${current.length} independent sessions were recorded under ${topProject[0]}.`,
      'This describes where the archive recorded activity. It does not measure importance or time spent.',
      'Choose one next step for this project and write down what would count as finished.',
      topProject[1], previousProjects.get(topProject[0]) || [], previous.length,
    ));
  }

  const order = new Map([
    ['receipt-tool-timeout', -2], ['receipt-test-failure', -1],
    ['no-assistant-output', 0], ['repeated-session-title', 1], ['parent-child-work', 2],
    ['many-user-turns', 3], ['search-led-work', 4], ['project-focus', 5],
  ]);
  cards.sort((a, b) => order.get(a.id) - order.get(b.id) || b.sessionCount - a.sessionCount);
  return {
    status: cards.length ? 'observed' : 'no-repeated-patterns',
    window,
    timeZone: window.timeZone,
    sourceFilter,
    coverageWarnings,
    observedSessions: current.length,
    cards: cards.slice(0, 5),
    message: cards.length
      ? 'These are patterns in recorded metadata and any available tool receipts, not proof that work succeeded or that a skill was learned.'
      : 'No repeated pattern met the two-independent-session minimum for this week’s covered window.',
  };
}
