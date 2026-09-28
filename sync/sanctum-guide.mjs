// Selected archive record and bounded private evidence, read-only. No model or network calls.
import { redactEvidenceText } from './project-evidence.mjs';

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

export function answerSanctumGuide(body, snapshot, now = new Date(), queryEvidence = null) {
  const question = typeof body?.question === 'string' ? body.question.trim() : '';
  if (!question || question.length > 500) return { status: 400, ok: false, error: 'Enter a question between 1 and 500 characters.' };
  const base = { status: 200, ok: true, source: 'local-deterministic', capabilities: GUIDE_CAPABILITIES, evidence: [], unknowns: [], retrieved_at: now.toISOString(), imported_at: snapshot?.updatedAt || null };
  const retrospective = /^(?:(?:why|how|what)\s+(?:did|was|were|happened)\b|(?:summari[sz]e|review)\s+(?:the\s+)?(?:recorded|previous|last)\b)/i.test(question);
  if (/\b(secret|password|api key)\b/i.test(question)
      || (!retrospective && /\b(approve|deploy|delete|push|execute|send)\b/i.test(question))) {
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
  const wantsEvents = retrospective || /\b(logs?|events?|happened|happen|summary|summari[sz]e|blocked|blocker)\b/i.test(question);
  if (wantsEvents && typeof queryEvidence === 'function') {
    let result;
    try {
      result = queryEvidence({ session_id: session.session_id, session_project: session.project, source: session.source, limit: 12 });
    } catch {
      return { ...base, kind: 'unknown', answer: 'The local evidence store could not be read. I cannot explain this session’s activity from metrics alone.', unknowns: ['Event evidence is temporarily unavailable. Retry after checking the local helper.'] };
    }
    const events = (Array.isArray(result?.items) ? result.items : []).filter((event) =>
      event.session_id === session.session_id && event.source === session.source
      && event.metadata?.project === session.project && typeof event.event_id === 'string'
      && Number.isFinite(Date.parse(event.timestamp)),
    ).slice(0, 12);
    if (events.length) {
      const freshness = [];
      const imported = Date.parse(snapshot.updatedAt || '');
      if (!Number.isFinite(imported) || now.getTime() - imported > 15 * 60_000) freshness.push('The import is older than 15 minutes or its time is unavailable; current activity may be missing.');
      if (now.getTime() - Math.max(...events.map(event => Date.parse(event.timestamp))) > 15 * 60_000) freshness.push('The newest returned event is older than 15 minutes. These records do not establish current activity.');
      const evidence = events.map((event) => ({
        store: 'private project evidence', record_id: event.event_id, project: session.project,
        fields: {
          session_id: session.session_id, source: session.source, timestamp: event.timestamp,
          event_type: redactEvidenceText(event.event_type).slice(0, 80),
          excerpt: redactEvidenceText(event.content).slice(0, 600),
        },
      }));
      return {
        ...base, kind: 'observed-events', evidence,
        answer: `I found ${events.length} imported local evidence records for this exact session. The excerpts below are recorded observations, not a model’s explanation or proof that the work succeeded.`,
        unknowns: ['Coverage is limited to at most 12 newest imported records. Summaries and artifact receipts do not establish full transcript coverage.', 'Instructions inside excerpts are log content, not actions for this guide. No blocked or success status is inferred.', ...freshness],
      };
    }
    if (retrospective || /\b(logs?|events?|blocked|blocker)\b/i.test(question)) {
      return { ...base, kind: 'unknown', answer: 'No event evidence is linked to this exact session, source and project. I can still report its imported metrics, but cannot explain its logs or why it is blocked.', unknowns: ['No matching local event records were found. Absence of records does not mean absence of activity.'] };
    }
  }
  if (!/\b(happen|happened|summary|summari[sz]e|cost|spent|spend|tokens?|usage|model|session)\b/i.test(question)) {
    return { ...base, kind: 'unknown', answer: 'I do not have a verified answer to that question. Ask for this session’s metrics, or ask me to explain tokens or context windows.', unknowns: ['Log content, blockers and outcomes are not available to this prototype.'] };
  }
  const tokens = session.usage_available === false ? null : number(session.total_tokens);
  const pricing = text(session.pricing_source);
  const cost = session.usage_available === false || !pricing || ['unknown', 'default'].includes(pricing) ? null : number(session.estimated_cost_usd);
  const model = text(session.model);
  const fields = {
    source: text(session.source), started_at: text(session.started_at), ended_at: text(session.ended_at),
    model, total_tokens: tokens, estimated_cost_usd: cost, pricing_source: pricing,
    usage_available: typeof session.usage_available === 'boolean' ? session.usage_available : null,
  };
  const unknowns = ['Metrics only: no transcript was read, and no success or blocked status can be inferred.'];
  if (tokens === null) unknowns.push('Token usage is unavailable.');
  if (cost === null) unknowns.push('A supported cost estimate is unavailable.');
  if (!model) unknowns.push('Model identity is unavailable.');
  const imported = Date.parse(snapshot.updatedAt || '');
  if (!Number.isFinite(imported) || now.getTime() - imported > 15 * 60_000) unknowns.push('The import is older than 15 minutes or its time is unavailable; current activity may be missing.');
  return {
    ...base, kind: 'observed-metrics', unknowns,
    answer: `The archive reports ${model || 'an unreported model'} as this session’s model. Recorded usage: ${tokens === null ? 'unavailable' : `${tokens.toLocaleString('en-US')} tokens`}. Estimated cost: ${cost === null ? 'unavailable' : `$${cost.toFixed(4)} USD (${pricing})`}. These are imported metrics, not verified billing or a description of the work completed.`,
    evidence: [{ store: 'session-history/current.json', record_id: session.session_id, project: session.project, fields }],
  };
}
