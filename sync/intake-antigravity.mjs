import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import {
  DEFAULT_ANTIGRAVITY_DIR, scanAntigravitySessions,
} from './parse-antigravity.mjs';
import {
  appendIntakeSummary, cleanIntakeSummary, cursorIds, DEFAULT_LIMIT,
  newIntakeId, readIntakeCursor, resolveIntakeDir, writeIntakeCursor,
} from './intake-local.mjs';

const ANTIGRAVITY_CURSOR_FIELD = 'processed_antigravity_session_ids';

function parseArgs(argv) {
  const out = { limit: DEFAULT_LIMIT };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--limit') {
      const parsed = Number(argv[i + 1]);
      out.limit = Number.isInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_LIMIT;
      i += 1;
    }
  }
  return out;
}

function topTools(tools) {
  return Object.entries(tools || {})
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([name]) => `tool-${String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`)
    .filter((name) => name !== 'tool-');
}

function frictionScore(session) {
  const toolCount = Object.values(session.tools || {}).reduce((sum, count) => sum + count, 0);
  const duration = Number(session.duration_seconds) || 0;
  let score = 0;
  if (duration > 900) score += 1;
  if (duration > 3600) score += 1;
  if (toolCount > 20) score += 1;
  if (toolCount > 80) score += 1;
  if (session.is_ghost) score += 1;
  return Math.min(5, score);
}

export function antigravitySummaryFromSession(session, now = new Date()) {
  const tools = topTools(session.tools);
  const duration = Number(session.duration_seconds) || 0;
  return {
    intake_id: newIntakeId(),
    session_id: session.session_id,
    source: 'antigravity',
    summarized_at: new Date(now).toISOString(),
    task_kind: 'ops',
    outcome: 'unknown',
    failure_signatures: tools.length ? tools : ['metadata-only'],
    waste_indicators: [
      'metadata-only',
      duration > 3600 ? 'long-session' : 'bounded-session',
    ],
    friction_score: frictionScore(session),
    model_calls: 0,
  };
}

export async function runAntigravityIntake(options = {}) {
  const now = options.now || new Date();
  const limit = options.limit ?? DEFAULT_LIMIT;
  const intakeDir = options.intakeDir || resolveIntakeDir(options.env || process.env);
  const antigravityDir = options.antigravityDir || DEFAULT_ANTIGRAVITY_DIR;
  const storedRecords = [];
  const stats = {
    scanned: 0,
    processed: 0,
    stored: 0,
    dropped: 0,
    skipped: 0,
    warnings: [],
    records: storedRecords,
  };

  if (!antigravityDir || !existsSync(antigravityDir)) {
    stats.skipped = 1;
    stats.warnings.push('antigravity skipped: data dir absent');
    return stats;
  }

  const sessions = options.sessions || scanAntigravitySessions(antigravityDir);
  stats.scanned = sessions.length;
  const cursor = readIntakeCursor(intakeDir);
  const seen = new Set(cursorIds(cursor, ANTIGRAVITY_CURSOR_FIELD));

  for (const session of sessions) {
    if (stats.processed >= limit) break;
    if (!session?.session_id || seen.has(session.session_id)) continue;
    try {
      const summary = cleanIntakeSummary(
        antigravitySummaryFromSession(session, now),
        { expectedSessionId: session.session_id, now, modelCalls: 0 },
      );
      appendIntakeSummary(intakeDir, summary);
      storedRecords.push(summary);
      stats.stored += 1;
    } catch (err) {
      stats.dropped += 1;
      stats.warnings.push(err.message.replace(/"[^"]+"/g, '"content not shown"'));
    }
    seen.add(session.session_id);
    stats.processed += 1;
  }

  if (stats.processed > 0) {
    writeIntakeCursor(intakeDir, { ...cursor, [ANTIGRAVITY_CURSOR_FIELD]: [...seen] });
  }
  return stats;
}

export async function main(argv = process.argv.slice(2)) {
  const stats = await runAntigravityIntake(parseArgs(argv));
  for (const warning of stats.warnings) console.warn(`warning: ${warning}`);
  console.log(`intake:antigravity scanned=${stats.scanned} processed=${stats.processed} stored=${stats.stored} dropped=${stats.dropped} skipped=${stats.skipped}`);
  for (const record of stats.records) console.log(JSON.stringify(record));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
