import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DRILL_KEY_TABLES,
  backupFileName,
  backupTimestamp,
  compareRowCounts,
  drillVerdict,
  inspectDump,
  isBackupFileName,
  latestBackup,
  parseRowCounts,
  pgDumpArgs,
  psqlCsvArgs,
  psqlRestoreArgs,
  redactedDbLabel,
  rowCountSql,
  sameDatabase,
  selectBackupsToPrune,
} from '../db-backup-lib.mjs';

test('backup names are sortable UTC timestamps that round-trip', () => {
  const d = new Date('2026-10-17T01:02:03.004Z');
  const name = backupFileName(d);
  assert.equal(name, 'db-2026-10-17T01-02-03-004Z.sql.gz');
  assert.ok(isBackupFileName(name));
  assert.equal(backupTimestamp(name).toISOString(), d.toISOString());
  assert.equal(backupTimestamp('latest.json'), null);
});

test('prune keeps the newest N and ignores foreign files', () => {
  const names = ['latest.json', 'db-2026-10-15T00-00-00-000Z.sql.gz', 'db-2026-10-17T00-00-00-000Z.sql.gz', 'db-2026-10-16T00-00-00-000Z.sql.gz', 'notes.txt'];
  assert.deepEqual(selectBackupsToPrune(names, 2), ['db-2026-10-15T00-00-00-000Z.sql.gz']);
  assert.deepEqual(selectBackupsToPrune(names, 10), []);
  assert.equal(latestBackup(names), 'db-2026-10-17T00-00-00-000Z.sql.gz');
  assert.equal(latestBackup(['latest.json']), null);
});

test('connection strings are never echoed; same-database detection ignores credentials', () => {
  const prod = 'postgresql://postgres.abc:s3cret@aws-0-ap-south-1.pooler.supabase.com:5432/postgres';
  assert.equal(redactedDbLabel(prod), 'aws-0-ap-south-1.pooler.supabase.com:5432/postgres');
  assert.equal(redactedDbLabel('nope'), 'invalid-database-url');
  assert.ok(sameDatabase(prod, 'postgresql://other:pw@aws-0-ap-south-1.pooler.supabase.com/postgres'));
  assert.ok(!sameDatabase(prod, 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'));
  assert.ok(!sameDatabase('', prod));
  assert.ok(!pgDumpArgs(prod).join(' ').includes('--password'));
  assert.deepEqual(pgDumpArgs('u'), ['--no-owner', '--no-privileges', '--format=plain', '--clean', '--if-exists', '--schema', 'public', '--dbname', 'u']);
  assert.deepEqual(psqlRestoreArgs('u'), ['--set', 'ON_ERROR_STOP=1', '--quiet', '--no-psqlrc', '--dbname', 'u']);
  assert.equal(psqlCsvArgs('u', 'select 1').at(-1), 'select 1');
});

test('dump inspection recognises a complete pg_dump and rejects junk', () => {
  const good = '--\n-- PostgreSQL database dump\n--\nCREATE TABLE public.sessions (id uuid);\nCOPY public.sessions (id) FROM stdin;\n\\.\n--\n-- PostgreSQL database dump complete\n--\n';
  assert.deepEqual(inspectDump(good), { isPgDump: true, createTables: 1, copyBlocks: 1, hasCompleteMarker: true });
  assert.deepEqual(inspectDump('error: connection refused'), { isPgDump: false, createTables: 0, copyBlocks: 0, hasCompleteMarker: false });
});

test('row-count SQL covers the key tables without aborting on a missing one, and the CSV parses', () => {
  const sql = rowCountSql(['public.sessions', 'public.ss_nodes; drop table x']);
  assert.match(sql, /to_regclass\('public\.sessions'\)/);
  assert.doesNotMatch(sql, /drop table/i);
  assert.equal(DRILL_KEY_TABLES.includes('public.sessions'), true);
  assert.deepEqual(parseRowCounts('public.sessions,12\npublic.ss_nodes,0\n\ngarbage line\n'), { 'public.sessions': 12, 'public.ss_nodes': 0 });
});

test('verdict fails on count drift or a slow restore and reports RTO/RPO', () => {
  const counts = compareRowCounts({ 'public.sessions': 12, 'public.ss_nodes': 3 }, { 'public.sessions': 12 });
  assert.equal(counts.ok, false);
  assert.deepEqual(counts.mismatches, [{ table: 'public.ss_nodes', expected: 3, actual: null, reason: 'missing_after_restore' }]);
  const bad = drillVerdict({ restoreSeconds: 700, maxRestoreSeconds: 600, counts, dumpAgeHours: 5.4321 });
  assert.equal(bad.ok, false);
  assert.equal(bad.reasons.length, 2);
  assert.equal(bad.rpo_hours, 5.43);
  const good = drillVerdict({ restoreSeconds: 42.4, counts: compareRowCounts({ a: 1 }, { a: 1 }), dumpAgeHours: 1 });
  assert.deepEqual(good, { ok: true, reasons: [], rto_seconds: 42, rpo_hours: 1 });
});
