import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

import { scanCodexSessions } from './parse-codex.mjs';
import {
  appendIntakeSummary, cleanIntakeSummary, cursorIds, DEFAULT_LIMIT,
  newIntakeId, readIntakeCursor, resolveIntakeDir, writeIntakeCursor,
} from './intake-local.mjs';

const execFileAsync = promisify(execFile);
const CODEX_CURSOR_FIELD = 'processed_codex_log_keys';
const DEFAULT_SQLITE = join(homedir(), '.codex', 'logs_2.sqlite');
const DEFAULT_CODEX_SESSIONS = join(homedir(), '.codex', 'sessions');
const CODEX_QUERY = `
SELECT level, target, COUNT(*) AS count, MIN(ts) AS first_ts, MAX(ts) AS last_ts
FROM logs
WHERE level IN ('ERROR', 'WARN')
GROUP BY level, target
ORDER BY CASE level WHEN 'ERROR' THEN 0 ELSE 1 END, count DESC, target ASC;
`;

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

function keyFor(row) {
  return createHash('sha256')
    .update(`${row.level || ''}\0${row.target || ''}`)
    .digest('hex')
    .slice(0, 16);
}

function countBucket(count) {
  if (count >= 1000) return 'count-critical';
  if (count >= 100) return 'count-high';
  if (count >= 10) return 'count-medium';
  return 'count-low';
}

function frictionScore(row, totalCount) {
  const count = Number(row.count) || 0;
  const density = totalCount > 0 ? count / totalCount : 0;
  const base = row.level === 'ERROR' ? 3 : 1;
  const densityBoost = density >= 0.25 ? 2 : density >= 0.1 ? 1 : 0;
  return Math.min(5, base + densityBoost);
}

function sortedRows(rows) {
  return [...rows]
    .filter((row) => ['ERROR', 'WARN'].includes(String(row.level || '').toUpperCase()))
    .map((row) => ({
      level: String(row.level).toUpperCase(),
      target: String(row.target || 'unknown-target').trim() || 'unknown-target',
      count: Number(row.count) || 0,
    }))
    .sort((a, b) => {
      const levelDelta = (a.level === 'ERROR' ? 0 : 1) - (b.level === 'ERROR' ? 0 : 1);
      if (levelDelta) return levelDelta;
      if (b.count !== a.count) return b.count - a.count;
      return a.target.localeCompare(b.target);
    });
}

export async function readCodexLogRows({
  sqlitePath = DEFAULT_SQLITE,
  sqliteBin = 'sqlite3',
} = {}) {
  if (!existsSync(sqlitePath)) return [];
  const uri = `file:${sqlitePath}?mode=ro`;
  const { stdout } = await execFileAsync(sqliteBin, ['-json', uri, CODEX_QUERY], {
    maxBuffer: 10 * 1024 * 1024,
  });
  const text = stdout.trim();
  return text ? JSON.parse(text) : [];
}

function codexContextIndicator(codexSessionsDir) {
  if (!codexSessionsDir || !existsSync(codexSessionsDir)) return 'codex-sessions-absent';
  try {
    return scanCodexSessions(codexSessionsDir).length > 0
      ? 'codex-sessions-indexed'
      : 'codex-sessions-empty';
  } catch {
    return 'codex-sessions-unreadable';
  }
}

export function codexSummaryFromRow(row, { now, totalCount, codexContext }) {
  const key = keyFor(row);
  return {
    intake_id: newIntakeId(),
    session_id: `codex-log-${key}`,
    source: 'codex',
    summarized_at: new Date(now).toISOString(),
    task_kind: 'ops',
    outcome: 'unknown',
    failure_signatures: [row.target],
    waste_indicators: [
      row.level.toLowerCase(),
      countBucket(row.count),
      codexContext,
    ],
    friction_score: frictionScore(row, totalCount),
    model_calls: 0,
  };
}

export async function runCodexIntake(options = {}) {
  const now = options.now || new Date();
  const limit = options.limit ?? DEFAULT_LIMIT;
  const intakeDir = options.intakeDir || resolveIntakeDir(options.env || process.env);
  const rows = sortedRows(options.rows || await readCodexLogRows(options));
  const totalCount = rows.reduce((sum, row) => sum + row.count, 0);
  const cursor = readIntakeCursor(intakeDir);
  const seen = new Set(cursorIds(cursor, CODEX_CURSOR_FIELD));
  const codexContext = options.codexContext || codexContextIndicator(
    options.codexSessionsDir || DEFAULT_CODEX_SESSIONS,
  );
  const storedRecords = [];
  const stats = {
    scanned: rows.length,
    processed: 0,
    stored: 0,
    dropped: 0,
    skipped: 0,
    warnings: [],
    records: storedRecords,
  };

  for (const row of rows) {
    if (stats.processed >= limit) break;
    const key = keyFor(row);
    if (seen.has(key)) continue;
    try {
      const summary = cleanIntakeSummary(
        codexSummaryFromRow(row, { now, totalCount, codexContext }),
        { now, modelCalls: 0 },
      );
      appendIntakeSummary(intakeDir, summary);
      storedRecords.push(summary);
      stats.stored += 1;
    } catch (err) {
      stats.dropped += 1;
      stats.warnings.push(err.message.replace(/"[^"]+"/g, '"content not shown"'));
    }
    seen.add(key);
    stats.processed += 1;
  }

  if (stats.processed > 0) {
    writeIntakeCursor(intakeDir, { ...cursor, [CODEX_CURSOR_FIELD]: [...seen] });
  }
  return stats;
}

export async function main(argv = process.argv.slice(2)) {
  const stats = await runCodexIntake(parseArgs(argv));
  for (const warning of stats.warnings) console.warn(`warning: ${warning}`);
  console.log(`intake:codex scanned=${stats.scanned} processed=${stats.processed} stored=${stats.stored} dropped=${stats.dropped} skipped=${stats.skipped}`);
  for (const record of stats.records) console.log(JSON.stringify(record));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
