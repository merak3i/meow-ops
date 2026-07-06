import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DAY_MS = 86_400_000;
const RECENT_DAYS = 14;
const M1_MIN_SESSIONS = 5;
const M2_MIN_SESSIONS = 8;

function asDateMs(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : null;
}

function recentCutoff(now, days = RECENT_DAYS) {
  return new Date(now).getTime() - days * DAY_MS;
}

function sessionTime(session) {
  return asDateMs(session.started_at) ?? asDateMs(session.ended_at);
}

function isRecentSession(session, now, days = RECENT_DAYS) {
  const time = sessionTime(session);
  return time !== null && time >= recentCutoff(now, days) && time <= new Date(now).getTime();
}

function toolCount(tools, name) {
  const value = Number(tools?.[name]);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function positiveToolNames(tools) {
  if (!tools || typeof tools !== 'object' || Array.isArray(tools)) return [];
  return Object.entries(tools)
    .filter(([, value]) => Number(value) > 0)
    .map(([name]) => name)
    .sort((a, b) => a.localeCompare(b));
}

function combinationsOfThree(items) {
  const combos = [];
  for (let a = 0; a < items.length - 2; a++) {
    for (let b = a + 1; b < items.length - 1; b++) {
      for (let c = b + 1; c < items.length; c++) {
        combos.push([items[a], items[b], items[c]]);
      }
    }
  }
  return combos;
}

function slug(value) {
  return String(value || 'unknown')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72) || 'unknown';
}

function metric(ref, value) {
  return { kind: 'metric', ref, value };
}

export function loadSessionMetadata(repoRoot) {
  const path = join(repoRoot, 'public', 'data', 'sessions.json');
  if (!existsSync(path)) return [];
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  return Array.isArray(parsed) ? parsed : [];
}

export function mineEditBeforeReadImbalance(sessions, { now = new Date(), days = RECENT_DAYS } = {}) {
  const qualifying = sessions.filter((session) => {
    if (!isRecentSession(session, now, days)) return false;
    const edits = toolCount(session.tools, 'Edit') + toolCount(session.tools, 'Write');
    const reads = toolCount(session.tools, 'Read');
    return edits > 0 && edits >= reads * 3;
  });
  if (qualifying.length < M1_MIN_SESSIONS) return null;

  const editWriteTotal = qualifying.reduce(
    (sum, session) => sum + toolCount(session.tools, 'Edit') + toolCount(session.tools, 'Write'),
    0,
  );
  const readTotal = qualifying.reduce((sum, session) => sum + toolCount(session.tools, 'Read'), 0);
  const ratio = Number((editWriteTotal / Math.max(1, readTotal)).toFixed(2));

  return {
    pattern_id: 'read-before-edit-discipline',
    title: 'read-before-edit discipline',
    evidence: [
      metric('sessions-with-edit-before-read-imbalance', qualifying.length),
      metric('edit-write-tool-count', editWriteTotal),
      metric('read-tool-count', readTotal),
      metric('edit-write-to-read-ratio', ratio),
    ],
    session_count: qualifying.length,
  };
}

export function mineDominantToolTrios(sessions, { now = new Date(), days = RECENT_DAYS } = {}) {
  const byProject = new Map();
  for (const session of sessions) {
    if (!isRecentSession(session, now, days)) continue;
    const tools = positiveToolNames(session.tools);
    if (tools.length < 3) continue;
    const project = String(session.project || 'unknown-project');
    if (!byProject.has(project)) byProject.set(project, { sessionCount: 0, counts: new Map() });
    const bucket = byProject.get(project);
    bucket.sessionCount += 1;
    const seen = new Set();
    for (const trio of combinationsOfThree(tools)) {
      const key = trio.join('+');
      if (seen.has(key)) continue;
      seen.add(key);
      bucket.counts.set(key, (bucket.counts.get(key) || 0) + 1);
    }
  }

  const candidates = [];
  for (const [project, bucket] of byProject.entries()) {
    const [trioKey, count] = [...bucket.counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] || [];
    if (!trioKey || count < M2_MIN_SESSIONS) continue;
    const trio = trioKey.split('+');
    const projectSlug = slug(project);
    const trioSlug = trio.map(slug).join('-');
    candidates.push({
      pattern_id: `recurring-${projectSlug}-${trioSlug}-workflow`,
      title: `recurring ${project} workflow`,
      evidence: [
        metric(`tool-trio:${trioKey}`, count),
        metric(`project-sessions:${projectSlug}`, bucket.sessionCount),
        metric('distinct-tools-in-trio', trio.length),
      ],
      session_count: count,
    });
  }
  return candidates.sort((a, b) => a.pattern_id.localeCompare(b.pattern_id));
}

export function minePromptPatterns(sessions, options = {}) {
  return [
    mineEditBeforeReadImbalance(sessions, options),
    ...mineDominantToolTrios(sessions, options),
  ].filter(Boolean);
}
