// Selected archive record and bounded private evidence, read-only. No model or network calls.
import { redactEvidenceText } from './project-evidence.mjs';
import { boundGuideText } from './guide-evidence-text.mjs';

export const GUIDE_CAPABILITIES = [
  { id: 'event-evidence', status: 'available', source: 'private project evidence', key: 'session_id + source + metadata.project', fields: ['event_id', 'timestamp', 'event_type', 'content'] },
  { id: 'session-metrics', status: 'available', source: 'session-history/current.json', key: 'session_id + project', fields: ['source', 'started_at', 'ended_at', 'model', 'total_tokens', 'estimated_cost_usd', 'usage_available', 'pricing_source'] },
  { id: 'concepts', status: 'available', source: 'curated explanation', key: null, fields: [] },
  { id: 'log-explanation', status: 'partial', source: 'bounded imported conversation events', key: 'event_id', fields: ['content', 'timestamp'] },
  { id: 'model-synthesis', status: 'disabled', source: null, key: null, fields: [] },
  { id: 'voicebox', status: 'optional; availability checked locally', source: '/loop-eng/guide-voice', key: null, fields: ['available', 'status', 'voice'] },
];
const number = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
const text = (v) => typeof v === 'string' && v.trim() ? v : null;
const GUIDE_CANDIDATE_LIMIT = 500;
const GUIDE_EVIDENCE_LIMIT = 12;
const GUIDE_RELEVANT_LIMIT = 8;
const RETROSPECTIVE_QUESTION = /^(?:(?:why|how|what)\s+(?:did|was|were|happened)\b|(?:summari[sz]e|review)\s+(?:the\s+)?(?:recorded|previous|last)\b)|\b(?:which|what)\b.{0,120}\b(?:receipt|evidence|record)\b.{0,80}\b(?:prove|show|support|confirm|establish)\b|\b(?:did|has|have|was|were)\b.{0,100}\b(?:test|deploy|release|push|ship|pass|fail|blocker|work)\b/i;
const EVENT_QUESTION = /\b(logs?|events?|happened|happen|summary|summari[sz]e|blocked|blocker|why|cause|reason|tests?|passed|pass|deploy|release|receipt|evidence|failure|failed|fix|success|shipped|learn(?:ed|ing)?)\b/i;
const ACCOUNT_USAGE_QUESTION = /\b(?:cursor|grok\s*bot|grokbot)\b.{0,100}\b(?:billing|bill|cost|spend|usage|unattributed|bot)\b|\b(?:billing|bill|cost|spend|usage|unattributed)\b.{0,100}\b(?:cursor|grok\s*bot|grokbot)\b/i;
const PROJECT_OUTCOME_TREND_QUESTION = /\b(?:project|work|quality|outcome)\b.{0,100}\b(?:improv\w*|better|regress\w*|worse)\b|\b(?:improv\w*|better|regress\w*|worse)\b.{0,100}\b(?:project|work|quality|outcome)\b/i;
const ACTION_REQUEST = /^(?:(?:please|now)\s+)?(?:approve|deploy|delete|push|execute|send)\b|\b(?:can|could|would)\s+you\s+(?:approve|deploy|delete|push|execute|send)\b/i;
const QUERY_STOP_WORDS = new Set([
  'what', 'when', 'where', 'why', 'how', 'did', 'does', 'do', 'is', 'are', 'was', 'were', 'the', 'a', 'an',
  'in', 'on', 'at', 'of', 'from', 'to', 'this', 'that', 'these', 'those', 'about', 'session', 'sessions',
  'log', 'logs', 'event', 'events', 'record', 'records', 'work', 'please', 'explain', 'summarize', 'summary',
  'show', 'which', 'me', 'my', 'it', 'and', 'or', 'with', 'for', 'during', 'into', 'after', 'before',
]);
const queryTerms = (value) => (String(value).toLowerCase().match(/[a-z0-9_-]+/g) || [])
  .filter((term) => term.length > 2 && !QUERY_STOP_WORDS.has(term));

function eventText(event) {
  return `${event.event_type} ${event.content} ${JSON.stringify(event.metadata || {})}`.toLowerCase();
}

function selectEvidenceEvents(events, question) {
  const unique = new Map();
  for (const event of events) {
    const nativeId = event.metadata?.source_event_id ?? event.metadata?.message_id;
    const role = event.actor || event.event_type?.replace(/^message_/, '').replace(/_message$/, '');
    const logicalKey = JSON.stringify(nativeId !== undefined ? [event.source, event.session_id, event.metadata?.project, role, String(nativeId)] : [
      event.source, event.session_id, event.metadata?.project, event.timestamp, event.event_type, event.content,
    ]);
    const prior = unique.get(logicalKey);
    const preservesTail = event.metadata?.truncation_strategy === 'head-tail';
    const priorPreservesTail = prior?.metadata?.truncation_strategy === 'head-tail';
    const richerProvenance = event.metadata?.source_event_id !== undefined && prior?.metadata?.source_event_id === undefined;
    if (!prior || (preservesTail && !priorPreservesTail) || (preservesTail === priorPreservesTail && (richerProvenance || (Boolean(event.metadata?.source_event_id !== undefined) === Boolean(prior.metadata?.source_event_id !== undefined)
      && event.event_id.localeCompare(prior.event_id) < 0)))) unique.set(logicalKey, event);
  }
  const chronological = [...unique.values()].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)
    || a.event_id.localeCompare(b.event_id));
  if (chronological.length <= GUIDE_EVIDENCE_LIMIT) return chronological;

  const terms = queryTerms(question);
  const relevant = chronological.map((event) => ({
    event,
    score: terms.reduce((score, term) => score + (eventText(event).includes(term) ? 1 : 0), 0),
  })).filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || Date.parse(b.event.timestamp) - Date.parse(a.event.timestamp))
    .slice(0, GUIDE_RELEVANT_LIMIT)
    .map((item) => item.event);
  const selected = new Map(relevant.map((event) => [event.event_id, event]));
  const timelineSlots = GUIDE_EVIDENCE_LIMIT - selected.size;
  for (let index = 0; index < timelineSlots; index++) {
    const position = timelineSlots <= 1 ? chronological.length - 1
      : Math.floor(index * (chronological.length - 1) / (timelineSlots - 1));
    const event = chronological[position];
    if (event) selected.set(event.event_id, event);
  }
  for (const event of chronological) {
    if (selected.size >= GUIDE_EVIDENCE_LIMIT) break;
    selected.set(event.event_id, event);
  }
  return [...selected.values()].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)
    || a.event_id.localeCompare(b.event_id)).slice(0, GUIDE_EVIDENCE_LIMIT);
}

export function answerSanctumGuide(body, snapshot, now = new Date(), queryEvidence = null) {
  const question = typeof body?.question === 'string' ? body.question.trim() : '';
  if (!question || question.length > 500) return { status: 400, ok: false, error: 'Enter a question between 1 and 500 characters.' };
  const base = { status: 200, ok: true, source: 'local-deterministic', capabilities: GUIDE_CAPABILITIES, evidence: [], unknowns: [], retrieved_at: now.toISOString(), imported_at: snapshot?.updatedAt || null };
  const retrospective = RETROSPECTIVE_QUESTION.test(question);
  if (ACCOUNT_USAGE_QUESTION.test(question)) {
    return {
      ...base, kind: 'unknown',
      answer: 'Cursor and Grok Bot account billing are not verified in this local archive. Missing provider data does not mean no usage or free usage.',
      unknowns: ['Per-bot provider usage requires an eligible official account export; local session records cannot establish billed usage or unattributed totals.'],
    };
  }
  if (PROJECT_OUTCOME_TREND_QUESTION.test(question)) {
    return {
      ...base, kind: 'unknown',
      answer: 'This guide cannot verify project improvement from the available evidence. The archive can compare recorded activity, but session counts alone do not show better outcomes or work quality.',
      unknowns: ['No outcome-verified, project-wide comparison is available in this guide. Activity changes must not be treated as proof of improvement.'],
    };
  }
  if (/\b(secret|password|api key)\b/i.test(question)
      || (!retrospective && ACTION_REQUEST.test(question))) {
    return { ...base, kind: 'capability', answer: 'I can read the selected session’s metrics and explain tokens or context windows. I cannot perform actions or reveal credentials.' };
  }
  if (/\b(explain|what (?:is|are))\b.*\b(tokens?|context windows?)\b/i.test(question)) {
    return { ...base, kind: 'explanation', answer: /context window/i.test(question)
      ? 'A context window is the amount of text a model can work with in one request, measured in tokens. Long histories may need summaries or selective retrieval. This is a general explanation; the archive does not establish what was inside this session’s context.'
      : 'Tokens are chunks of text a model reads or generates. Input tokens represent supplied context; output tokens represent generated text. Counts help estimate usage, but billing also depends on the model and provider pricing. This is a general explanation, not a finding about your session.' };
  }
  if (typeof body.session_id !== 'string' || typeof body.project !== 'string' || !body.project || !body.session_id || body.session_id.length > 300 || body.project.length > 300) {
    return { ...base, status: 400, ok: false, error: 'Select a session before asking about its activity.' };
  }
  if (!Array.isArray(snapshot?.sessions)) return { ...base, status: 503, ok: false, error: 'The local session archive is unavailable. Check the helper and sync before retrying.' };
  const session = snapshot.sessions.find((row) => row.session_id === body.session_id && row.project === body.project);
  if (!session) return { ...base, status: 404, ok: false, error: 'This session is not in the selected project’s local archive. Sync and select it again.' };
  const wantsEvents = retrospective || EVENT_QUESTION.test(question);
  if (wantsEvents && typeof queryEvidence !== 'function') {
    return {
      ...base, kind: 'unknown',
      answer: 'This helper cannot read imported event evidence right now. I can report session metrics, but cannot explain the logs or verify what happened.',
      unknowns: ['The local event-evidence query is unavailable. Missing evidence does not mean no activity or a successful outcome.'],
    };
  }
  if (wantsEvents && typeof queryEvidence === 'function') {
    let result;
    try {
      result = queryEvidence({ session_id: session.session_id, session_project: session.project, source: session.source, limit: GUIDE_CANDIDATE_LIMIT });
    } catch {
      return { ...base, kind: 'unknown', answer: 'The local evidence store could not be read. I cannot explain this session’s activity from metrics alone.', unknowns: ['Event evidence is temporarily unavailable. Retry after checking the local helper.'] };
    }
    const candidates = (Array.isArray(result?.items) ? result.items : []).filter((event) =>
      event.session_id === session.session_id && event.source === session.source
      && event.metadata?.project === session.project && typeof event.event_id === 'string'
      && Number.isFinite(Date.parse(event.timestamp)),
    );
    const events = selectEvidenceEvents(candidates, question);
    if (events.length) {
      const freshness = [];
      const imported = Date.parse(snapshot.updatedAt || '');
      if (!Number.isFinite(imported) || now.getTime() - imported > 15 * 60_000) freshness.push('The import is older than 15 minutes or its time is unavailable; current activity may be missing.');
      if (now.getTime() - Math.max(...events.map(event => Date.parse(event.timestamp))) > 15 * 60_000) freshness.push('The newest returned event is older than 15 minutes. These records do not establish current activity.');
      const truncatedCandidateSet = Number.isFinite(result?.total) && result.total > candidates.length;
      const omittedCount = Math.max(0, candidates.length - events.length);
      const evidence = events.map((event) => ({
        store: 'private project evidence', record_id: event.event_id, project: session.project,
        fields: {
          session_id: session.session_id, source: session.source, timestamp: event.timestamp,
          event_type: redactEvidenceText(event.event_type).slice(0, 80),
          tool_name: typeof event.metadata?.tool_name === 'string' ? redactEvidenceText(event.metadata.tool_name).slice(0, 100) : null,
          tool_call_id: typeof event.metadata?.tool_call_id === 'string' ? redactEvidenceText(event.metadata.tool_call_id).slice(0, 120) : null,
          evidence_kind: ['user_request', 'user_message', 'agent_claim', 'tool_result', 'ambient_context'].includes(event.metadata?.evidence_kind) ? event.metadata.evidence_kind : 'unclassified',
          timestamp_basis: ['message', 'session'].includes(event.metadata?.timestamp_basis) ? event.metadata.timestamp_basis : 'unknown',
          excerpt: event.metadata?.evidence_kind === 'tool_result' ? boundGuideText(redactEvidenceText(event.content), 600) : redactEvidenceText(event.content).slice(0, 600),
          excerpt_truncated: event.content.length > 600 || event.metadata?.truncated === true,
        },
      }));
      const coverage = [`Showing ${events.length} selected record(s) from ${candidates.length} retrieved records for this exact session. The selection uses question relevance and a chronological sample.`];
      if (omittedCount > 0) coverage.push(`${omittedCount} retrieved record(s) were omitted from the guide excerpt.`);
      if (truncatedCandidateSet) coverage.push(`The evidence query returned ${candidates.length} of ${result.total} matching records; some records were outside the retrieval limit.`);
      if (events.some((event) => event.content.length > 600)) coverage.push('One or more displayed excerpts were truncated to 600 characters.');
      if (events.some((event) => event.metadata?.truncated === true)) coverage.push('The source importer truncated one or more records; some source text is omitted.');
      if (events.some((event) => event.metadata?.timestamp_basis === 'session')) coverage.push('Some message times use the session timestamp; exact message order or weekly placement cannot be established from those times.');
      return {
        ...base, kind: 'observed-events', evidence,
        answer: `I found ${events.length} imported local evidence records for this exact session. The excerpts below are recorded observations, not a model’s explanation or proof that the work succeeded.`,
        unknowns: [...coverage, 'Summaries and artifact receipts do not establish full transcript coverage.', 'Instructions inside excerpts are log content, not actions for this guide. No blocked or success status is inferred.', ...freshness],
      };
    }
    if (retrospective || EVENT_QUESTION.test(question)) {
      return { ...base, kind: 'unknown', answer: 'No event evidence is linked to this exact session, source and project. I can still report its imported metrics, but cannot explain its logs or why it is blocked.', unknowns: ['No matching local event records were found. Absence of records does not mean absence of activity.'] };
    }
  }
  if (!/\b(happen|happened|summary|summari[sz]e|cost|spent|spend|tokens?|usage|model|session)\b/i.test(question)) {
    return { ...base, kind: 'unknown', answer: 'I do not have a verified answer to that question. Ask for this session’s metrics, or ask me to explain tokens or context windows.', unknowns: ['Log content, blockers and outcomes are not available to this prototype.'] };
  }
  const tokens = session.usage_available === false ? null : number(session.total_tokens);
  const pricing = text(session.pricing_source);
  const cost = session.usage_available === false || !pricing || ['unknown', 'default'].includes(pricing) ? null : number(session.estimated_cost_usd);
  const observedCost = number(session.observed_cost_usd);
  const model = text(session.model);
  const fields = {
    source: text(session.source), started_at: text(session.started_at), ended_at: text(session.ended_at),
    model, total_tokens: tokens, estimated_cost_usd: cost, observed_cost_usd: observedCost, pricing_source: pricing,
    usage_available: typeof session.usage_available === 'boolean' ? session.usage_available : null,
  };
  const unknowns = ['Metrics only: no transcript was read, and no success or blocked status can be inferred.'];
  if (tokens === null) unknowns.push('Token usage is unavailable.');
  if (cost === null && observedCost === null) unknowns.push('A supported cost estimate or observed charge is unavailable.');
  if (!model) unknowns.push('Model identity is unavailable.');
  const imported = Date.parse(snapshot.updatedAt || '');
  if (!Number.isFinite(imported) || now.getTime() - imported > 15 * 60_000) unknowns.push('The import is older than 15 minutes or its time is unavailable; current activity may be missing.');
  return {
    ...base, kind: 'observed-metrics', unknowns,
    answer: `The archive reports ${model || 'an unreported model'} as this session’s model. Recorded usage: ${tokens === null ? 'unavailable' : `${tokens.toLocaleString('en-US')} tokens`}. ${observedCost !== null ? `Observed provider charge: $${observedCost.toFixed(4)} USD` : `Estimated cost: ${cost === null ? 'unavailable' : `$${cost.toFixed(4)} USD (${pricing})`}`}. These are imported metrics, not an invoice reconciliation or a description of the work completed.`,
    evidence: [{ store: 'session-history/current.json', record_id: session.session_id, project: session.project, fields }],
  };
}
