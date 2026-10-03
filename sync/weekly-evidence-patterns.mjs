import { createHash } from 'node:crypto';
import { stripVTControlCharacters } from 'node:util';
import { queryAgentEvidence, redactEvidenceText } from './project-evidence.mjs';
import { weeklyEvidenceWindow } from '../src/lib/weekly-insights.mjs';

const QUERY_LIMIT = 500;
const EXECUTION_TOOL = /(?:^|__|\.)(?:exec_command|write_stdin|shell_command|run_shell_command|bash|terminal)$/i;

function key(source, sessionId, project) {
  return JSON.stringify([source, sessionId, project]);
}

function child(session) {
  return session.is_subagent === true || session.is_sidechain === true || Number(session.agent_depth) > 0;
}

function sessionIndex(sessions) {
  const index = new Map();
  const projects = new Map();
  for (const session of sessions) {
    if (!session || typeof session.session_id !== 'string' || typeof session.project !== 'string') continue;
    const source = session.source || 'claude';
    const identity = JSON.stringify([source, session.session_id]);
    const known = projects.get(identity) || new Set();
    known.add(session.project);
    projects.set(identity, known);
    index.set(key(source, session.session_id, session.project), session);
  }
  // Conflicting project attribution cannot establish two independent sessions.
  for (const [identity, values] of projects) {
    if (values.size < 2) continue;
    const [source, sessionId] = JSON.parse(identity);
    for (const project of values) index.delete(key(source, sessionId, project));
  }
  return index;
}

function rootFor(event, index) {
  const project = event.metadata?.project;
  if (typeof project !== 'string') return null;
  const source = event.source;
  let session = index.get(key(source, event.session_id, project));
  const seen = new Set();
  while (session) {
    const identity = key(source, session.session_id, project);
    if (seen.has(identity)) return null;
    seen.add(identity);
    const eventParent = session.session_id === event.session_id ? event.parent_session_id : null;
    if (eventParent && session.parent_session_id && eventParent !== session.parent_session_id) return null;
    const parent = session.parent_session_id || eventParent;
    if (!parent) return child(session) ? null : { session, identity };
    session = index.get(key(source, parent, project));
  }
  return null;
}

function receiptFacts(event) {
  const text = stripVTControlCharacters(String(event.content || ''));
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  // Recognize execution envelopes, not prose that happens to say "tests failed".
  // In particular, text in an assistant message is never passed here.
  const exit = lines.find((line) => /^(?:Process|Command) exited with code -?\d+\.?$/.test(line));
  const code = exit ? Number(exit.match(/-?\d+\.?$/)[0].replace(/\.$/, '')) : null;
  const execution = EXECUTION_TOOL.test(String(event.metadata?.tool_name || ''));
  const timeout = execution && lines.find((line) => /^(?:Command failed because it timed out\.?|Error: (?:command|process|tool execution) timed out after \d+(?:\.\d+)?\s*(?:ms|milliseconds?|s|seconds?)\.?)$/i.test(line));
  const failed = lines.find((line) => /^(?:# fail [1-9]\d*|Tests:\s+.*\b[1-9]\d* failed(?:[, .]|$).*|(?:=+\s*)?[1-9]\d* failed(?:, \d+ (?:passed|skipped|warnings?))* in \d+(?:\.\d+)?s(?:\s*=+)?)$/.test(line));
  const passed = lines.find((line) => /^# fail 0$/.test(line));
  const facts = [];
  if (timeout) facts.push({ kind: 'tool-timeout', outcome: 'failure', excerpt: timeout });
  if (execution && exit && code !== 0 && failed) facts.push({ kind: 'test-failure', outcome: 'failure', excerpt: `${exit}\n${failed}` });
  if (execution && exit && code === 0 && passed && lines.some((line) => /^# tests [1-9]\d*$/.test(line))) {
    facts.push({ kind: 'test-failure', outcome: 'counterexample', excerpt: `${exit}\n${lines.find((line) => /^# tests [1-9]\d*$/.test(line))}\n${passed}` });
  }
  if (exit && execution) facts.push({ kind: 'tool-timeout', outcome: 'counterexample', excerpt: exit });
  return facts;
}

function evidenceFor(record) {
  return {
    sessionId: record.event.session_id,
    rootSessionId: record.root.session.session_id,
    source: record.event.source,
    project: record.event.metadata.project,
    activityAt: record.event.timestamp,
    recordId: record.event.event_id,
    excerpt: redactEvidenceText(record.excerpt).slice(0, 600),
  };
}

function uniqueRoots(records) {
  const roots = new Map();
  for (const record of records) if (!roots.has(record.root.identity)) roots.set(record.root.identity, record);
  return [...roots.values()];
}

function scopeCards(records, window, truncated, source = null) {
  const scoped = source ? records.filter((record) => record.event.source === source) : records;
  const current = scoped.filter((record) => record.time >= Date.parse(window.currentStart));
  const previous = scoped.filter((record) => record.time <= Date.parse(window.previousEnd));
  const cards = [];
  for (const kind of ['tool-timeout', 'test-failure']) {
    const matches = uniqueRoots(current.filter((record) => record.kind === kind && record.outcome === 'failure'));
    if (matches.length < 2) continue;
    const prior = uniqueRoots(previous.filter((record) => record.kind === kind && record.outcome === 'failure'));
    const projects = new Set(matches.map((record) => record.event.metadata.project));
    const counterexamples = uniqueRoots(current.filter((record) => record.kind === kind && record.outcome === 'counterexample' && projects.has(record.event.metadata.project))).slice(0, 4);
    const timeout = kind === 'tool-timeout';
    cards.push({
      id: `receipt-${kind}`,
      evidenceKind: 'tool-receipt',
      title: timeout ? 'Tool runs reached a time limit' : 'Test runs reported failures',
      what: `${truncated ? 'At least ' : ''}${matches.length} independent work sessions contain ${timeout ? 'a recorded tool timeout' : 'a test summary reporting failures with a nonzero process exit'}.`,
      why: 'These are observations in recorded tool results. They do not establish the cause, whether all tests ran, or whether the work was later fixed.',
      action: timeout ? 'Open one timeout receipt and check the command and any later retry before changing its limit.' : 'Open one failing run, identify its failing check, and inspect a later result before calling it resolved.',
      sessionCount: matches.length,
      previousCount: truncated ? null : prior.length,
      previousTotal: truncated ? null : uniqueRoots(previous).length,
      comparison: truncated ? 'The bounded evidence sample cannot support a previous-week comparison.' : 'Previous counts cover sessions with recognized tool receipts; evidence coverage may differ between weeks.',
      projects: [...projects].slice(0, 2),
      evidence: matches.slice(0, 4).map(evidenceFor),
      counterexamples: counterexamples.map(evidenceFor),
      limitations: [
        'Only exact session, harness and project matches with message timestamps count. Repeated outputs and child work are consolidated.',
        timeout ? 'Other completed tool calls are counterexamples to a blanket timeout claim; they do not prove a timed-out command recovered.' : 'Passing test receipts can be from different checks; they do not prove these failures were repaired.',
      ],
    });
  }
  return cards;
}

/** One vault scan per snapshot, with bounded returned records. Never reads credentials or writes evidence. */
export function buildWeeklyEvidencePatterns(sessions, { now = new Date(), archiveVersion, queryEvidence = queryAgentEvidence } = {}) {
  const window = weeklyEvidenceWindow(now);
  const coverage = {
    status: 'available', limit: QUERY_LIMIT, returnedRecords: 0, totalRecords: null,
    acceptedRecords: 0, excludedRecords: 0, duplicateRecords: 0, truncated: false,
    limitations: ['Detailed evidence covers registered projects with collected tool results, not every recorded session. Only recognized execution receipt formats are classified.'],
  };
  const result = { schemaVersion: 1, archiveVersion: archiveVersion || null, window, coverage, scopes: { all: { cards: [] } } };
  const rows = Array.isArray(sessions) ? sessions : [];
  let response;
  try {
    response = queryEvidence({ event_type: 'tool_result', from: window.from, to: window.to, limit: QUERY_LIMIT });
    if (!Array.isArray(response?.items) || !Number.isSafeInteger(response?.total) || response.total < response.items.length) throw new TypeError('Invalid evidence response');
  } catch {
    coverage.status = 'unavailable';
    coverage.limitations.push('Detailed tool evidence could not be read; no receipt-based patterns were inferred.');
    return result;
  }
  coverage.returnedRecords = Math.min(response.items.length, QUERY_LIMIT);
  coverage.totalRecords = response.total;
  coverage.truncated = response.total > coverage.returnedRecords;
  if (coverage.truncated) coverage.limitations.push(`Only the newest ${coverage.returnedRecords} of ${response.total} tool results were scanned. Pattern counts are observed lower bounds; absence is not evidence of no failures.`);
  const index = sessionIndex(rows);
  const seenIds = new Set();
  const seenEvents = new Set();
  const records = [];
  for (const event of response.items.slice(0, QUERY_LIMIT)) {
    const time = Date.parse(event?.timestamp);
    const root = event && rootFor(event, index);
    if (event?.event_type !== 'tool_result' || event.actor !== 'tool' || event.metadata?.timestamp_basis !== 'message'
      || typeof event.event_id !== 'string' || !event.event_id || !root || !Number.isFinite(time)
      || time < Date.parse(window.from) || time > Date.parse(window.to)
      || (time > Date.parse(window.previousEnd) && time < Date.parse(window.currentStart))) {
      coverage.excludedRecords++;
      continue;
    }
    const logicalId = key(event.source, event.session_id, event.metadata.project)
      + ':' + (event.metadata.source_event_id || event.metadata.tool_call_id || '')
      + ':' + createHash('sha256').update(String(event.content || '')).digest('hex');
    if (seenIds.has(event.event_id) || seenEvents.has(logicalId)) {
      coverage.duplicateRecords++;
      continue;
    }
    seenIds.add(event.event_id);
    seenEvents.add(logicalId);
    coverage.acceptedRecords++;
    for (const fact of receiptFacts(event)) records.push({ event, root, time, ...fact });
  }
  result.scopes.all.cards = scopeCards(records, window, coverage.truncated);
  for (const source of new Set(records.map((record) => record.event.source))) {
    result.scopes[source] = { cards: scopeCards(records, window, coverage.truncated, source) };
  }
  return result;
}
