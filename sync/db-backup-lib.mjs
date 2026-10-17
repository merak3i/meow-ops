// Helpers for the Supabase Postgres backup + restore drill (SHIP-GATE checks 16 and 17).
// Pure functions only; sync/db-backup.mjs and sync/db-restore-drill.mjs do the I/O.
// Same design as berglabs-gtm/src/lib/db-backup.js so both repos drill the same way.
//
// Never logs connection strings: use redactedDbLabel() for anything that reaches stdout.

import { createHash } from 'node:crypto';

export const DEFAULT_KEEP = 14;
export const DEFAULT_MAX_RESTORE_SECONDS = 600;

// Tables whose row counts are compared after a drill restore: the ones that would hurt most
// if they came back wrong or empty.
export const DRILL_KEY_TABLES = Object.freeze([
  'public.sessions',
  'public.daily_summaries',
  'public.meow_ops_sessions',
  'public.ss_pipelines',
  'public.ss_nodes',
  'public.ss_edges',
  'public.ss_runestones',
  'public._migrations',
]);

export function backupFileName(date = new Date()) {
  return `db-${date.toISOString().replace(/[:.]/g, '-')}.sql.gz`;
}

export function isBackupFileName(name) {
  return /^db-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.sql\.gz$/.test(String(name));
}

export function backupTimestamp(name) {
  const m = /^db-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.sql\.gz$/.exec(String(name));
  if (!m) return null;
  return new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`);
}

// Newest first.
export function sortBackups(names) {
  return [...names].filter(isBackupFileName).sort((a, b) => b.localeCompare(a));
}

export function selectBackupsToPrune(names, keep = DEFAULT_KEEP) {
  return sortBackups(names).slice(Math.max(0, keep));
}

export function latestBackup(names) {
  return sortBackups(names)[0] || null;
}

export function redactedDbLabel(url) {
  try {
    const u = new URL(String(url));
    return `${u.hostname}${u.port ? ':' + u.port : ''}${u.pathname || ''}`;
  } catch {
    return 'invalid-database-url';
  }
}

export function sameDatabase(a, b) {
  if (!a || !b) return false;
  try {
    const ua = new URL(String(a));
    const ub = new URL(String(b));
    return ua.hostname === ub.hostname && (ua.port || '5432') === (ub.port || '5432') && ua.pathname === ub.pathname;
  } catch {
    return String(a) === String(b);
  }
}

export function pgDumpArgs(url, { schemas = ['public'] } = {}) {
  return [
    '--no-owner',
    '--no-privileges',
    '--format=plain',
    '--clean',
    '--if-exists',
    ...schemas.flatMap((schema) => ['--schema', schema]),
    '--dbname', String(url),
  ];
}

export function psqlRestoreArgs(url) {
  return ['--set', 'ON_ERROR_STOP=1', '--quiet', '--no-psqlrc', '--dbname', String(url)];
}

export function psqlCsvArgs(url, sql) {
  return ['--set', 'ON_ERROR_STOP=1', '--no-psqlrc', '--csv', '--tuples-only', '--dbname', String(url), '-c', sql];
}

// Sanity checks on the plain-text dump. Cheap and deterministic.
export function inspectDump(text) {
  const head = String(text || '');
  return {
    isPgDump: /PostgreSQL database dump/.test(head),
    createTables: (head.match(/^CREATE TABLE /gm) || []).length,
    copyBlocks: (head.match(/^COPY /gm) || []).length,
    hasCompleteMarker: /PostgreSQL database dump complete/.test(head),
  };
}

export function sha256Hex(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export function rowCountSql(tables = DRILL_KEY_TABLES) {
  // One statement, one row per table. to_regclass() keeps a missing table from aborting the query.
  return tables.map((t) => {
    const safe = t.replace(/[^a-zA-Z0-9_.]/g, '');
    return `select '${safe}' as table_name, (select count(*) from ${safe}) as rows where to_regclass('${safe}') is not null`;
  }).join('\nunion all\n') + ';';
}

export function parseRowCounts(psqlCsv) {
  const out = {};
  for (const line of String(psqlCsv || '').split('\n')) {
    const m = /^([a-zA-Z0-9_.]+),(\d+)$/.exec(line.trim());
    if (m) out[m[1]] = Number(m[2]);
  }
  return out;
}

export function compareRowCounts(expected = {}, actual = {}) {
  const mismatches = [];
  for (const [table, rows] of Object.entries(expected)) {
    if (!(table in actual)) mismatches.push({ table, expected: rows, actual: null, reason: 'missing_after_restore' });
    else if (actual[table] !== rows) mismatches.push({ table, expected: rows, actual: actual[table], reason: 'count_mismatch' });
  }
  return { ok: mismatches.length === 0, mismatches };
}

export function drillVerdict({ restoreSeconds, maxRestoreSeconds = DEFAULT_MAX_RESTORE_SECONDS, counts, dumpAgeHours }) {
  const reasons = [];
  if (!counts.ok) reasons.push(`row counts differ on ${counts.mismatches.length} table(s)`);
  if (restoreSeconds > maxRestoreSeconds) reasons.push(`restore took ${Math.round(restoreSeconds)}s, over the ${maxRestoreSeconds}s RTO target`);
  return { ok: reasons.length === 0, reasons, rto_seconds: Math.round(restoreSeconds), rpo_hours: Number(dumpAgeHours.toFixed(2)) };
}
