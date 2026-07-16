const NUMERIC_FIELDS = {
  tokens: 'total_tokens',
  input_tokens: 'input_tokens',
  output_tokens: 'output_tokens',
  cache_creation_tokens: 'cache_creation_tokens',
  cache_read_tokens: 'cache_read_tokens',
  cost: 'estimated_cost_usd',
  duration_seconds: 'duration_seconds',
};

function emptyBucket(key) {
  return {
    ...(key === undefined ? {} : { key }),
    sessions: 0,
    tokens: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_tokens: 0,
    cache_read_tokens: 0,
    cost: 0,
    duration_seconds: 0,
    ghost_count: 0,
    first_activity_at: null,
    last_activity_at: null,
    _projects: new Set(),
  };
}

function add(bucket, session) {
  bucket.sessions += 1;
  for (const [target, source] of Object.entries(NUMERIC_FIELDS)) {
    bucket[target] += Number(session[source]) || 0;
  }
  if (session.is_ghost) bucket.ghost_count += 1;
  if (session.project) bucket._projects.add(session.project);
  const activity = session.ended_at || session.started_at || null;
  if (activity && (!bucket.first_activity_at || activity < bucket.first_activity_at)) bucket.first_activity_at = activity;
  if (activity && (!bucket.last_activity_at || activity > bucket.last_activity_at)) bucket.last_activity_at = activity;
}

function finish(bucket) {
  const { _projects, ...values } = bucket;
  return { ...values, distinct_projects: _projects.size, projects: [..._projects].sort() };
}

function dateParts(iso, timeZone) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  const year = get('year');
  const month = get('month');
  const day = get('day');
  return year && month && day ? { year, month: `${year}-${month}`, day: `${year}-${month}-${day}` } : null;
}

function addToMap(map, key, session) {
  if (!key) return;
  if (!map.has(key)) map.set(key, emptyBucket(key));
  add(map.get(key), session);
}

function rows(map) {
  return [...map.values()].map(finish).sort((a, b) => String(a.key).localeCompare(String(b.key)));
}

export function buildSessionRollups(sessions, options = {}) {
  const timeZone = options.timeZone
    || process.env.MEOW_TZ
    || Intl.DateTimeFormat().resolvedOptions().timeZone
    || 'UTC';
  const generatedAt = options.generatedAt || new Date().toISOString();
  const allTime = emptyBucket();
  const daily = new Map();
  const monthly = new Map();
  const yearly = new Map();
  const byProject = new Map();
  const byModel = new Map();
  const bySource = new Map();

  for (const session of sessions) {
    add(allTime, session);
    const parts = dateParts(session.ended_at || session.started_at, timeZone);
    if (parts) {
      addToMap(daily, parts.day, session);
      addToMap(monthly, parts.month, session);
      addToMap(yearly, parts.year, session);
    }
    addToMap(byProject, session.project || 'unknown', session);
    addToMap(byModel, session.model || 'unknown', session);
    addToMap(bySource, session.source || 'claude', session);
  }

  return {
    schemaVersion: 1,
    generatedAt,
    timeZone,
    allTime: finish(allTime),
    daily: rows(daily),
    monthly: rows(monthly),
    yearly: rows(yearly),
    byProject: rows(byProject).sort((a, b) => b.sessions - a.sessions || a.key.localeCompare(b.key)),
    byModel: rows(byModel).sort((a, b) => b.sessions - a.sessions || a.key.localeCompare(b.key)),
    bySource: rows(bySource).sort((a, b) => b.sessions - a.sessions || a.key.localeCompare(b.key)),
  };
}
