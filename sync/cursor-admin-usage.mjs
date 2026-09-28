// cursor-admin-usage.mjs — optional official Cursor Admin API usage enricher.
//
// Official source (Cursor docs, checked 2026-09-29):
//   POST https://api.cursor.com/teams/filtered-usage-events
//   https://prod.cursor.com/docs/account/teams/admin-api
//   Availability: team administrators with an Admin API key.
//
// What this connector will and will not do:
//   * Opt-in only via CURSOR_ADMIN_API_KEY. No credential => local parser only.
//   * Never log, export, commit, or persist the credential.
//   * Never scrape a private dashboard.
//   * Never call a model-inference endpoint. This is a documented usage-read API
//     with rate limits, not a billed completion API. Callers should still keep
//     live traffic off unless they intend to use their own Enterprise key.
//   * Cursor documents conversationId as the conversation (agent session) ID;
//     the field can be omitted for events without an associated conversation.
//     Join only when that returned ID exactly equals a locally observed ID:
//         === session.composer_id | session.conversation_id | session.cloud_agent_id
//   * The endpoint returns the model and chargedCents; Cursor says its usage
//     records are hourly aggregates. No time-window, model-name, or Task-argument
//     matching is used to join records.
//   * Events that lack a join key, or whose key does not equal a local id,
//     stay in unmatched aggregate Cursor usage. They are never assigned to a
//     session.
//   * Mixed official models on one matched conversation do not pick a winner.
//     Tokens and charged cents still apply; model stays null.
//
// Cloud Agents GET /v1/agents/:id/usage is official and all-plans, but it
// returns tokens only (no model, no cost) and only for bc- cloud-agent ids.
// It cannot enrich local composer transcripts, so it is not used here.

const DEFAULT_BASE_URL = 'https://api.cursor.com';
export const CURSOR_ADMIN_USAGE_PATH = '/teams/filtered-usage-events';
export const CURSOR_ADMIN_USAGE_AVAILABILITY = 'team-admin-api';

const KEY_SHAPE = /\b(?:crsr|key)_[A-Za-z0-9_-]+|Basic\s+[A-Za-z0-9+/=]+/gi;

export const CURSOR_USAGE_LIMITATION = [
  'POST /teams/filtered-usage-events is the official usage-events API and requires a team Admin API key.',
  'Cursor documents conversationId as the conversation (agent session) ID and may omit it when an event has no associated conversation.',
  'Usage records include model and chargedCents and are hourly aggregates according to Cursor.',
  'chargedCents, isChargeable, token model cost, request units, and the optional Cursor Token Rate are summarized independently; Cursor documentation examples show chargedCents alongside isChargeable=false.',
  'Local transcripts are keyed by composerId. Events are assigned to a session only on exact identifier equality.',
  'Unmatched events are kept as aggregate Cursor usage and are never attributed to a session.',
].join(' ');

function normalizeKey(value) {
  if (value == null) return '';
  const text = String(value).trim();
  return text || '';
}

export function sanitizeCursorText(value, apiKey = '') {
  let text = value == null ? '' : String(value);
  if (apiKey) text = text.split(apiKey).join('[redacted]');
  return text.replace(KEY_SHAPE, '[redacted]');
}

function numberOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function centsToUsd(cents) {
  const n = Number(cents);
  return Number.isFinite(n) ? n / 100 : 0;
}

function optionalNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function flagCounts(value, name) {
  return {
    [`${name}_true_events`]: value === true ? 1 : 0,
    [`${name}_false_events`]: value === false ? 1 : 0,
    [`${name}_unknown_events`]: typeof value === 'boolean' ? 0 : 1,
  };
}

export function emptyCursorUsageReport(overrides = {}) {
  return {
    enabled: false,
    status: 'skipped',
    endpoint: `POST ${DEFAULT_BASE_URL}${CURSOR_ADMIN_USAGE_PATH}`,
    availability: CURSOR_ADMIN_USAGE_AVAILABILITY,
    join_key: 'explicit conversation/cloud-agent id exact-match to local composer_id|conversation_id|cloud_agent_id',
    limitation: CURSOR_USAGE_LIMITATION,
    period: null,
    matched_sessions: 0,
    matched_events: 0,
    unmatched_events: 0,
    totals: emptyUsageTotals(),
    by_model: [],
    by_kind: [],
    unmatched: {
      totals: emptyUsageTotals(),
      by_model: [],
      by_kind: [],
    },
    error: null,
    ...overrides,
  };
}

function emptyUsageTotals() {
  return {
    events: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_tokens: 0,
    cache_read_tokens: 0,
    total_tokens: 0,
    charged_cents: 0,
    charged_cents_events: 0,
    estimated_cost_usd: 0,
    token_model_cost_cents: 0,
    token_model_cost_events: 0,
    cursor_token_fee_cents: 0,
    cursor_token_fee_events: 0,
    requests_cost_units: 0,
    requests_cost_events: 0,
    chargeable_true_events: 0,
    chargeable_false_events: 0,
    chargeable_unknown_events: 0,
    charged_cents_when_chargeable_true: 0,
    charged_cents_when_chargeable_false: 0,
    charged_cents_when_chargeability_unknown: 0,
    token_based_true_events: 0,
    token_based_false_events: 0,
    token_based_unknown_events: 0,
    headless_true_events: 0,
    headless_false_events: 0,
    headless_unknown_events: 0,
  };
}

const USAGE_SUM_FIELDS = Object.keys(emptyUsageTotals());

function addUsage(target, usage) {
  for (const field of USAGE_SUM_FIELDS) target[field] += usage[field] || 0;
}

export function summarizeCursorEvent(event) {
  const tokenUsage = event && typeof event.tokenUsage === 'object' && event.tokenUsage
    ? event.tokenUsage
    : {};
  const input = Math.max(0, numberOrZero(tokenUsage.inputTokens));
  const output = Math.max(0, numberOrZero(tokenUsage.outputTokens));
  const cacheWrite = Math.max(0, numberOrZero(tokenUsage.cacheWriteTokens));
  const cacheRead = Math.max(0, numberOrZero(tokenUsage.cacheReadTokens));
  const chargedCents = optionalNumber(event?.chargedCents);
  const modelCostCents = optionalNumber(tokenUsage.totalCents);
  const cursorTokenFee = optionalNumber(event?.cursorTokenFee);
  const requestsCosts = optionalNumber(event?.requestsCosts);
  const chargeability = flagCounts(event?.isChargeable, 'chargeable');
  const tokenBased = flagCounts(event?.isTokenBasedCall, 'token_based');
  const headless = flagCounts(event?.isHeadless, 'headless');
  return {
    events: 1,
    input_tokens: input,
    output_tokens: output,
    cache_creation_tokens: cacheWrite,
    cache_read_tokens: cacheRead,
    total_tokens: input + output + cacheWrite + cacheRead,
    charged_cents: chargedCents ?? 0,
    charged_cents_events: chargedCents == null ? 0 : 1,
    estimated_cost_usd: centsToUsd(chargedCents ?? 0),
    token_model_cost_cents: modelCostCents ?? 0,
    token_model_cost_events: modelCostCents == null ? 0 : 1,
    cursor_token_fee_cents: cursorTokenFee ?? 0,
    cursor_token_fee_events: cursorTokenFee == null ? 0 : 1,
    requests_cost_units: requestsCosts ?? 0,
    requests_cost_events: requestsCosts == null ? 0 : 1,
    ...chargeability,
    charged_cents_when_chargeable_true: event?.isChargeable === true ? chargedCents ?? 0 : 0,
    charged_cents_when_chargeable_false: event?.isChargeable === false ? chargedCents ?? 0 : 0,
    charged_cents_when_chargeability_unknown: typeof event?.isChargeable === 'boolean' ? 0 : chargedCents ?? 0,
    ...tokenBased,
    ...headless,
    model: typeof event?.model === 'string' && event.model.trim() ? event.model.trim() : null,
    kind: typeof event?.kind === 'string' && event.kind.trim() ? event.kind.trim().slice(0, 120) : 'unknown',
  };
}

export function localCursorJoinIds(session) {
  if (!session || typeof session !== 'object') return [];
  const ids = [
    session.composer_id,
    session.conversation_id,
    session.cloud_agent_id,
  ];
  return [...new Set(ids.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim()))];
}

export function eventCursorJoinIds(event) {
  if (!event || typeof event !== 'object') return [];
  const ids = [
    event.conversationId,
    event.conversation_id,
    // Cursor staff used this misspelling when announcing the field. Keep it
    // explicit so a real response remains exact-match rather than heuristic.
    event.coversation_id,
    event.cloudAgentId,
    event.cloud_agent_id,
  ];
  return [...new Set(ids.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim()))];
}

function defaultWindow(now = Date.now()) {
  const endDate = Number(now);
  const startDate = endDate - 30 * 24 * 60 * 60 * 1000;
  return { startDate, endDate };
}

function classifyHttpStatus(status) {
  if (status === 429) return 'rate-limit';
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status >= 400) return 'error';
  return 'ok';
}

function isUsageEventsPayload(payload) {
  return Boolean(payload && typeof payload === 'object' && Array.isArray(payload.usageEvents));
}

export async function fetchCursorUsageEvents(options = {}) {
  const apiKey = normalizeKey(options.apiKey);
  if (!apiKey) {
    return { ok: false, status: 'missing-credential', events: [], error: null };
  }

  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return { ok: false, status: 'error', events: [], error: 'fetch is not available' };
  }

  // Keep the credential pinned to Cursor's documented API host. Tests can
  // replace fetchImpl without routing the Authorization header elsewhere.
  const baseUrl = DEFAULT_BASE_URL;
  // Cursor's Admin API accepts up to 1,000 usage events per page. Use the
  // maximum by default so a normal 30-day team window fits within the page cap.
  const pageSize = Math.min(1000, Math.max(1, Number(options.pageSize) || 1000));
  const maxPages = Math.min(100, Math.max(1, Number(options.maxPages) || 20));
  const window = {
    startDate: Number(options.startDate) || defaultWindow(options.now).startDate,
    endDate: Number(options.endDate) || defaultWindow(options.now).endDate,
  };
  const auth = Buffer.from(`${apiKey}:`, 'utf8').toString('base64');
  const events = [];

  for (let page = 1; page <= maxPages; page += 1) {
    let response;
    try {
      response = await fetchImpl(`${baseUrl}${CURSOR_ADMIN_USAGE_PATH}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${auth}`,
        },
        body: JSON.stringify({
          startDate: window.startDate,
          endDate: window.endDate,
          page,
          pageSize,
        }),
      });
    } catch (err) {
      return {
        ok: false,
        status: 'error',
        events: [],
        error: sanitizeCursorText(err?.message || 'request failed', apiKey),
      };
    }

    const httpStatus = Number(response?.status) || 0;
    const kind = classifyHttpStatus(httpStatus);
    if (kind !== 'ok') {
      return {
        ok: false,
        status: kind,
        events: [],
        error: sanitizeCursorText(response?.statusText || kind, apiKey),
      };
    }

    let payload;
    try {
      payload = typeof response.json === 'function'
        ? await response.json()
        : JSON.parse(String(response.body || ''));
    } catch (err) {
      return {
        ok: false,
        status: 'malformed',
        events: [],
        error: sanitizeCursorText(err?.message || 'invalid JSON', apiKey),
      };
    }

    if (!isUsageEventsPayload(payload)) {
      return { ok: false, status: 'malformed', events: [], error: 'usageEvents array missing' };
    }

    for (const event of payload.usageEvents) {
      if (event && typeof event === 'object') events.push(event);
    }

    const pagination = payload.pagination;
    if (!pagination || typeof pagination !== 'object' || Array.isArray(pagination)) {
      return { ok: false, status: 'malformed', events: [], error: 'pagination object missing' };
    }
    const declaredHasNext = typeof pagination.hasNextPage === 'boolean' ? pagination.hasNextPage : null;
    const numPages = optionalNumber(pagination.numPages);
    if (declaredHasNext == null && numPages == null) {
      return { ok: false, status: 'malformed', events: [], error: 'pagination completeness is unknown' };
    }
    if (numPages != null && (!Number.isInteger(numPages) || numPages < page || (declaredHasNext != null && declaredHasNext !== (numPages > page)))) {
      return { ok: false, status: 'malformed', events: [], error: 'pagination fields disagree' };
    }
    const hasNext = declaredHasNext ?? numPages > page;
    if (!hasNext) {
      return { ok: true, status: 'ok', events, period: window, error: null };
    }
  }

  return {
    ok: false,
    status: 'page-limit',
    events: [],
    period: window,
    error: 'pagination limit reached; refusing to summarize an incomplete result',
  };
}

function indexSessionsByJoinId(sessions) {
  const index = new Map();
  for (const session of sessions) {
    for (const id of localCursorJoinIds(session)) {
      if (!index.has(id)) index.set(id, []);
      index.get(id).push(session);
    }
  }
  return index;
}

function resolveExactSession(event, index) {
  const matches = [];
  const seen = new Set();
  for (const id of eventCursorJoinIds(event)) {
    for (const session of index.get(id) || []) {
      if (seen.has(session)) continue;
      seen.add(session);
      matches.push(session);
    }
  }
  if (matches.length === 1) return matches[0];
  return null;
}

function aggregateEvents(events) {
  const totals = emptyUsageTotals();
  const byModel = new Map();
  const byKind = new Map();
  for (const event of events) {
    if (!event || typeof event !== 'object') continue;
    const usage = summarizeCursorEvent(event);
    addUsage(totals, usage);
    const modelKey = usage.model || 'unknown';
    if (!byModel.has(modelKey)) byModel.set(modelKey, { key: modelKey, ...emptyUsageTotals() });
    addUsage(byModel.get(modelKey), usage);
    if (!byKind.has(usage.kind)) byKind.set(usage.kind, { key: usage.kind, ...emptyUsageTotals() });
    addUsage(byKind.get(usage.kind), usage);
  }
  const sortRows = (rows) => [...rows.values()].sort((a, b) => b.charged_cents - a.charged_cents || a.key.localeCompare(b.key));
  return {
    totals,
    by_model: sortRows(byModel),
    by_kind: sortRows(byKind),
  };
}

function applyUsageToSession(session, usages) {
  const totals = emptyUsageTotals();
  const models = new Set();
  for (const usage of usages) {
    addUsage(totals, usage);
    if (usage.model) models.add(usage.model);
  }
  session.input_tokens = totals.input_tokens;
  session.output_tokens = totals.output_tokens;
  session.cache_creation_tokens = totals.cache_creation_tokens;
  session.cache_read_tokens = totals.cache_read_tokens;
  session.total_tokens = totals.total_tokens;
  session.estimated_cost_usd = Number(totals.estimated_cost_usd.toFixed(6));
  session.usage_available = true;
  session.pricing_source = 'cursor-admin-api';
  session.usage_source = 'cursor-admin-api';
  session.model = models.size === 1 ? [...models][0] : null;
}

export function applyCursorUsageEvents(sessions, events, report = emptyCursorUsageReport()) {
  const list = Array.isArray(sessions) ? sessions : [];
  const incoming = Array.isArray(events) ? events : [];
  const index = indexSessionsByJoinId(list);
  const matched = new Map();
  const unmatchedEvents = [];

  for (const event of incoming) {
    if (!event || typeof event !== 'object') {
      unmatchedEvents.push(event);
      continue;
    }
    const joinIds = eventCursorJoinIds(event);
    if (joinIds.length === 0) {
      unmatchedEvents.push(event);
      continue;
    }
    const session = resolveExactSession(event, index);
    if (!session) {
      unmatchedEvents.push(event);
      continue;
    }
    if (!matched.has(session)) matched.set(session, []);
    matched.get(session).push(summarizeCursorEvent(event));
  }

  for (const [session, usages] of matched) {
    applyUsageToSession(session, usages);
  }

  const allAggregates = aggregateEvents(incoming);
  const unmatched = aggregateEvents(unmatchedEvents);
  report.enabled = true;
  report.status = 'ok';
  report.matched_sessions = matched.size;
  report.matched_events = [...matched.values()].reduce((sum, rows) => sum + rows.length, 0);
  report.unmatched_events = unmatched.totals.events;
  report.totals = allAggregates.totals;
  report.by_model = allAggregates.by_model;
  report.by_kind = allAggregates.by_kind;
  report.unmatched = unmatched;
  report.error = null;
  return { sessions: list, report };
}

export async function enrichCursorSessions(sessions, options = {}) {
  const apiKey = normalizeKey(options.apiKey ?? options.env?.CURSOR_ADMIN_API_KEY ?? process.env.CURSOR_ADMIN_API_KEY);
  const report = emptyCursorUsageReport({
    enabled: Boolean(apiKey),
    status: apiKey ? 'ok' : 'missing-credential',
  });

  if (!apiKey) return { sessions: Array.isArray(sessions) ? sessions : [], report };

  const fetched = await fetchCursorUsageEvents({ ...options, apiKey });
  if (!fetched.ok) {
    report.status = fetched.status;
    report.error = fetched.error;
    return { sessions: Array.isArray(sessions) ? sessions : [], report };
  }

  report.period = fetched.period;
  return applyCursorUsageEvents(sessions, fetched.events, report);
}
