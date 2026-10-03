// cursor-admin-usage.mjs — optional official Cursor Admin API usage enricher.
//
// Official source (Cursor docs, checked 2026-09-29):
//   POST https://api.cursor.com/teams/filtered-usage-events
//   https://prod.cursor.com/docs/account/teams/admin-api
//   Availability: an entitled account and team administrator Admin API key.
//
// What this connector will and will not do:
//   * Opt-in only via CURSOR_ADMIN_API_KEY. No credential => local parser only.
//   * Never log, export, commit, or persist the credential.
//   * Never scrape a private dashboard.
//   * Never call a model-inference endpoint. This is a documented usage-read API
//     with rate limits, not a billed completion API. Callers should still keep
//     live traffic off unless they intend to use their own team Admin key.
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

import { deduplicateCursorUsageEvents, emptyCursorUsageHistory, mergeCursorUsageHistory, readCursorUsageHistory, writeCursorUsageHistory } from './cursor-usage-history.mjs';

const DEFAULT_BASE_URL = 'https://api.cursor.com';
export const CURSOR_USAGE_POLL_INTERVAL_MS = 60 * 60 * 1000;
export const CURSOR_ADMIN_USAGE_PATH = '/teams/filtered-usage-events';
export const CURSOR_ADMIN_USAGE_AVAILABILITY = 'team-admin-api';

const KEY_SHAPE = /\b(?:crsr|key)_[A-Za-z0-9_-]+|Basic\s+[A-Za-z0-9+/=]+/gi;

export const CURSOR_USAGE_LIMITATION = [
  'POST /teams/filtered-usage-events requires a team Admin API key and account entitlement. Cursor currently lists Admin/Analytics APIs under Enterprise; a paid or Ultra plan alone does not prove access.',
  'Cursor documents conversationId as the conversation (agent session) ID and may omit it when an event has no associated conversation.',
  'Usage records include model and chargedCents and are hourly aggregates according to Cursor.',
  'chargedCents, isChargeable, token model cost, request units, and the optional Cursor Token Rate are summarized independently; Cursor documentation examples show chargedCents alongside isChargeable=false.',
  'Local transcripts are keyed by composerId. Events are assigned to a session only on exact identifier equality.',
  'Unmatched events are kept as aggregate Cursor usage and are never attributed to a session.',
  'chargedCents is an observed provider-reported amount, not an invoice reconciliation or a token-price estimate.',
  'Grok Bot attribution requires an explicit cursor.surface=grok_bot and bot conversation identifier; model names never establish bot identity. The usage-events API alone does not establish complete per-bot billing.',
  'Events without provider IDs use exact-record fingerprints; identical records cannot be independently distinguished.',
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
  if (!['number', 'string'].includes(typeof value) || (typeof value === 'string' && !value.trim())) return null;
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
    by_product: [],
    grok_bot_billing: { status: 'unavailable', identified_events: 0, identified_bots: 0, complete: false },
    history: null,
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
    input_tokens_events: 0,
    output_tokens_events: 0,
    cache_creation_tokens_events: 0,
    cache_read_tokens_events: 0,
    token_usage_events: 0,
    charged_cents: 0,
    charged_cents_events: 0,
    observed_cost_usd: null,
    estimated_cost_usd: null,
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
  for (const field of USAGE_SUM_FIELDS) if (field !== 'estimated_cost_usd') target[field] += usage[field] || 0;
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
  const tokenEvidence = [tokenUsage.inputTokens, tokenUsage.outputTokens, tokenUsage.cacheWriteTokens, tokenUsage.cacheReadTokens].map(value => optionalNumber(value) != null && optionalNumber(value) >= 0);
  return {
    events: 1,
    input_tokens: input,
    output_tokens: output,
    cache_creation_tokens: cacheWrite,
    cache_read_tokens: cacheRead,
    total_tokens: input + output + cacheWrite + cacheRead,
    input_tokens_events: Number(tokenEvidence[0]),
    output_tokens_events: Number(tokenEvidence[1]),
    cache_creation_tokens_events: Number(tokenEvidence[2]),
    cache_read_tokens_events: Number(tokenEvidence[3]),
    token_usage_events: Number(tokenEvidence.some(Boolean)),
    charged_cents: chargedCents ?? 0,
    charged_cents_events: chargedCents == null ? 0 : 1,
    observed_cost_usd: chargedCents == null ? null : centsToUsd(chargedCents),
    estimated_cost_usd: null,
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
    product: event?.product || null,
    botId: event?.product === 'grok_bot' ? event.botId : null,
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
  if (status < 200 || status >= 300) return 'error';
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
  const pageSize = Math.floor(Math.min(1000, Math.max(1, Number(options.pageSize) || 1000)));
  const maxPages = Math.floor(Math.min(100, Math.max(1, Number(options.maxPages) || 20)));
  const window = {
    startDate: options.startDate == null ? defaultWindow(options.now).startDate : Number(options.startDate),
    endDate: options.endDate == null ? defaultWindow(options.now).endDate : Number(options.endDate),
  };
  if (!Number.isFinite(window.startDate) || !Number.isFinite(window.endDate) || window.startDate < 0 || window.endDate < window.startDate) {
    return { ok: false, status: 'invalid-period', events: [], error: 'invalid usage period' };
  }
  const auth = Buffer.from(`${apiKey}:`, 'utf8').toString('base64');
  const events = [];
  const deadline = Date.now() + Math.min(60000, Math.max(1, Number(options.totalTimeoutMs) || 45000));

  for (let page = 1; page <= maxPages; page += 1) {
    let response;
    let payload;
    const controller = new AbortController();
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) return { ok: false, status: 'timeout', events: [], error: 'Cursor usage collection timed out' };
    const timeoutMs = Math.min(remainingMs, 30000, Math.max(1, Number(options.timeoutMs) || 15000));
    let timer;
    try {
      await Promise.race([(async () => {
        response = await fetchImpl(`${baseUrl}${CURSOR_ADMIN_USAGE_PATH}`, {
          method: 'POST',
          redirect: 'error',
          signal: controller.signal,
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
        if (response?.redirected) throw new Error('redirect rejected');
        if (classifyHttpStatus(Number(response?.status) || 0) === 'ok') {
          payload = typeof response.json === 'function' ? await response.json() : JSON.parse(String(response.body || ''));
        }
      })(), new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('request timed out')); }, timeoutMs); })]);
    } catch {
      return {
        ok: false,
        status: controller.signal.aborted ? 'timeout' : 'error',
        events: [],
        error: controller.signal.aborted ? 'Cursor usage request timed out' : 'Cursor usage request failed or returned invalid JSON',
      };
    } finally {
      clearTimeout(timer);
    }

    const httpStatus = Number(response?.status) || 0;
    const kind = classifyHttpStatus(httpStatus);
    if (kind !== 'ok') {
      return {
        ok: false,
        status: kind,
        events: [],
        error: `Cursor usage request returned HTTP ${httpStatus}`,
      };
    }

    if (!isUsageEventsPayload(payload)) {
      return { ok: false, status: 'malformed', events: [], error: 'usageEvents array missing' };
    }
    if (payload.usageEvents.some(event => !event || typeof event !== 'object' || Array.isArray(event))) {
      return { ok: false, status: 'malformed', events: [], error: 'usageEvents contains an invalid record' };
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
  const byProduct = new Map();
  for (const event of events) {
    if (!event || typeof event !== 'object') continue;
    const usage = summarizeCursorEvent(event);
    addUsage(totals, usage);
    const modelKey = usage.model || 'unknown';
    if (!byModel.has(modelKey)) byModel.set(modelKey, { key: modelKey, ...emptyUsageTotals() });
    addUsage(byModel.get(modelKey), usage);
    if (!byKind.has(usage.kind)) byKind.set(usage.kind, { key: usage.kind, ...emptyUsageTotals() });
    addUsage(byKind.get(usage.kind), usage);
    const product = usage.product || 'unknown';
    if (!byProduct.has(product)) byProduct.set(product, { key: product, ...emptyUsageTotals() });
    addUsage(byProduct.get(product), usage);
  }
  for (const row of [totals, ...byModel.values(), ...byKind.values(), ...byProduct.values()]) {
    if (!row.charged_cents_events) row.observed_cost_usd = null;
  }
  const sortRows = (rows) => [...rows.values()].sort((a, b) => b.charged_cents - a.charged_cents || a.key.localeCompare(b.key));
  return {
    totals,
    by_model: sortRows(byModel),
    by_kind: sortRows(byKind),
    by_product: sortRows(byProduct),
  };
}

function applyUsageToSession(session, usages) {
  const totals = emptyUsageTotals();
  const models = new Set();
  for (const usage of usages) {
    addUsage(totals, usage);
    if (usage.model) models.add(usage.model);
  }
  for (const field of ['input_tokens', 'output_tokens', 'cache_creation_tokens', 'cache_read_tokens']) {
    session[field] = totals[`${field}_events`] ? totals[field] : null;
  }
  session.total_tokens = totals.token_usage_events ? totals.total_tokens : null;
  session.estimated_cost_usd = null;
  session.observed_cost_usd = totals.charged_cents_events ? Number(totals.observed_cost_usd.toFixed(6)) : null;
  session.cost_available = session.observed_cost_usd !== null;
  session.cost_kind = session.cost_available ? 'observed' : 'unavailable';
  session.provider_cost_coverage = { observed_events: totals.charged_cents_events, total_events: totals.events, complete: totals.charged_cents_events === totals.events };
  session.usage_available = totals.token_usage_events > 0;
  session.pricing_source = 'cursor-admin-api';
  session.usage_source = 'cursor-admin-api';
  session.model = models.size === 1 ? [...models][0] : null;
  session.provider_usage_state = 'verified-events';
}

function retainArchivedCursorUsage(sessions, previousSessions) {
  const previous = new Map();
  for (const session of Array.isArray(previousSessions) ? previousSessions : []) {
    if (session?.source === 'cursor' && typeof session.session_id === 'string') previous.set(session.session_id, session);
  }
  for (const session of sessions) {
    if (session?.source !== 'cursor' || typeof session.session_id !== 'string') continue;
    const old = previous.get(session.session_id);
    if (!old || old.pricing_source !== 'cursor-admin-api') continue;
    const observed = optionalNumber(old.observed_cost_usd) ?? optionalNumber(old.estimated_cost_usd);
    if (observed == null && old.usage_available !== true) continue;
    for (const field of ['input_tokens', 'output_tokens', 'cache_creation_tokens', 'cache_read_tokens', 'total_tokens']) {
      session[field] = optionalNumber(old[field]);
    }
    session.model ??= old.model ?? null;
    session.usage_available = old.usage_available === true;
    session.observed_cost_usd = observed;
    session.estimated_cost_usd = null;
    session.cost_available = observed !== null;
    session.cost_kind = observed !== null ? 'observed' : 'unavailable';
    session.pricing_source = 'cursor-admin-api';
    session.usage_source = 'cursor-admin-api';
    session.provider_usage_state = 'retained-archive';
    session.provider_cost_coverage = { observed_events: null, total_events: null, complete: false, limitation: 'Retained from an earlier local archive; original query interval and events are unavailable.' };
  }
}

export function applyCursorUsageEvents(sessions, events, report = emptyCursorUsageReport(), { normalized = false } = {}) {
  const list = Array.isArray(sessions) ? sessions : [];
  const incoming = deduplicateCursorUsageEvents(Array.isArray(events) ? events : [], { normalized });
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
  report.by_product = allAggregates.by_product;
  const identifiedBotEvents = incoming.filter(event => event.product === 'grok_bot' && event.botId);
  report.grok_bot_billing = { status: identifiedBotEvents.length ? 'partial-evidence' : 'unavailable', identified_events: identifiedBotEvents.length, identified_bots: new Set(identifiedBotEvents.map(event => event.botId)).size, complete: false };
  report.deduplication = { input_events: Array.isArray(events) ? events.length : 0, retained_events: incoming.length, fingerprint_events: incoming.filter(event => event.identityQuality === 'exact-record-fingerprint').length };
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

  const now = Number(options.now ?? Date.now());
  let history = emptyCursorUsageHistory();
  let persisted = false;
  const finish = (status, error = null) => {
    const list = Array.isArray(sessions) ? sessions : [];
    retainArchivedCursorUsage(list, options.previousSessions);
    const result = history.lastSuccessAt == null ? { sessions: list, report } : applyCursorUsageEvents(list, history.events, report, { normalized: true });
    result.report.enabled = Boolean(apiKey);
    result.report.status = status;
    result.report.error = error;
    result.report.period = history.periods.length === 1 ? history.periods[0] : null;
    result.report.scope = 'retained verified usage history';
    result.report.retained_archive_sessions = list.filter(session => session.provider_usage_state === 'retained-archive').length;
    result.report.history = {
      persisted, last_success_at: history.lastSuccessAt,
      last_attempt_at: history.lastAttemptAt, periods: history.periods,
      retained_events: history.events.length, freshness: status === 'ok' ? 'fresh' : history.lastSuccessAt == null ? 'unavailable' : 'retained',
      undated_events: history.events.filter(event => event.timestamp == null).length,
      next_poll_at: history.lastAttemptAt == null ? null : history.lastAttemptAt + CURSOR_USAGE_POLL_INTERVAL_MS,
    };
    return result;
  };
  if (options.historyPath) {
    try { history = readCursorUsageHistory(options.historyPath); persisted = history.lastAttemptAt != null; } catch { return finish('history-error', 'Private Cursor usage history needs recovery; existing file preserved'); }
  }
  if (!apiKey) return finish('missing-credential');
  if (history.lastAttemptAt != null && now - history.lastAttemptAt < CURSOR_USAGE_POLL_INTERVAL_MS) return finish(history.lastSuccessAt == null ? 'waiting-to-retry' : 'cached');
  history = { ...history, lastAttemptAt: now, lastStatus: 'pending' };
  if (options.historyPath) {
    try { writeCursorUsageHistory(options.historyPath, history); persisted = true; } catch { return finish('history-error', 'Unable to save private Cursor usage checkpoint; no request sent'); }
  }
  const fetched = await fetchCursorUsageEvents({ ...options, apiKey, now });
  const previousHistory = history;
  if (fetched.ok) history = mergeCursorUsageHistory(history, fetched.events, fetched.period, now);
  else history.lastStatus = fetched.status;
  if (options.historyPath) {
    try { writeCursorUsageHistory(options.historyPath, history); } catch { history = previousHistory; return finish('history-error', 'Cursor usage fetched but private history could not be saved; prior data retained'); }
  }
  report.requested_period = fetched.period || null;
  return finish(fetched.status, fetched.error);
}
