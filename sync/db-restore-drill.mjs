#!/usr/bin/env node
// Backup restore drill (SHIP-GATE check 17). Proves the newest dump restores, measures RTO
// (restore seconds) and RPO (dump age), and compares key-table row counts against the counts
// recorded at backup time.
//
//   MEOW_DRILL_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
//     node sync/db-restore-drill.mjs [--file db-....sql.gz]
//
// The drill target must be DISPOSABLE: a local `supabase start` stack or a Supabase branch. The
// script refuses to run against DATABASE_URL. Writes <intake dir>/reports/restore-drill-db-<date>.json.
// Needs `psql` on PATH. Run quarterly; docs/BACKUP_RESTORE.md has the checklist.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { loadEnv } from './load-env.mjs';
import { resolveIntakeDir } from './intake-local.mjs';
import { createLogger, newRunId } from './log.mjs';
import { backupDir } from './db-backup.mjs';
import {
  DEFAULT_MAX_RESTORE_SECONDS,
  DRILL_KEY_TABLES,
  backupTimestamp,
  compareRowCounts,
  drillVerdict,
  latestBackup,
  parseRowCounts,
  psqlCsvArgs,
  psqlRestoreArgs,
  redactedDbLabel,
  rowCountSql,
  sameDatabase,
} from './db-backup-lib.mjs';

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

function env(name, fallback = '') {
  return String(process.env[name] || fallback).trim();
}

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && i < process.argv.length - 1 ? process.argv[i + 1] : '';
}

function run(cmd, args, { input = null, captureStdout = false } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, { stdio: [input ? 'pipe' : 'ignore', captureStdout ? 'pipe' : 'inherit', 'pipe'], env: process.env });
    let out = '';
    let err = '';
    child.stdout?.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { err += chunk; });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolvePromise(out) : reject(new Error(`${cmd} exited ${code}: ${err.trim().slice(0, 800)}`))));
    if (input) child.stdin.end(input);
  });
}

export async function main() {
  loadEnv(REPO_ROOT);
  const log = createLogger({ component: 'db-restore-drill', run_id: process.env.MEOW_RUN_ID || newRunId() });
  try {
    const drillUrl = env('MEOW_DRILL_DATABASE_URL');
    const prodUrl = env('DATABASE_URL');
    if (!drillUrl) throw new Error('MEOW_DRILL_DATABASE_URL is not set (use a local supabase stack or a Supabase branch, never production)');
    if (sameDatabase(drillUrl, prodUrl)) throw new Error('refusing to restore onto DATABASE_URL: the drill target must be disposable');
    if (/supabase\.co/.test(drillUrl) && !/^(1|true|yes)$/i.test(env('MEOW_DRILL_ALLOW_HOSTED'))) {
      throw new Error('drill target looks like a hosted Supabase database; set MEOW_DRILL_ALLOW_HOSTED=true only for a branch you intend to wipe');
    }

    const dir = backupDir();
    const chosen = argValue('--file');
    const file = chosen || (existsSync(dir) ? latestBackup(readdirSync(dir)) : null);
    if (!file) throw new Error(`no backup found in ${dir}; run \`npm run backup:db\` first`);
    const path = resolve(file.includes('/') ? file : join(dir, file));
    const manifestPath = `${path}.json`;
    const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null;
    const dumpAt = backupTimestamp(basename(path)) || (manifest ? new Date(manifest.created_at) : new Date());
    const maxRestoreSeconds = Number.parseInt(env('MEOW_DRILL_MAX_SECONDS', String(DEFAULT_MAX_RESTORE_SECONDS)), 10) || DEFAULT_MAX_RESTORE_SECONDS;

    log.info('drill.start', { file: basename(path), target: redactedDbLabel(drillUrl), dump_age_hours: Number(((Date.now() - dumpAt.getTime()) / 36e5).toFixed(2)) });

    const sql = gunzipSync(readFileSync(path));
    const t0 = Date.now();
    await run('psql', psqlRestoreArgs(drillUrl), { input: sql });
    const restoreSeconds = (Date.now() - t0) / 1000;
    log.info('drill.restored', { restore_seconds: Number(restoreSeconds.toFixed(1)) });

    const csv = await run('psql', psqlCsvArgs(drillUrl, rowCountSql(DRILL_KEY_TABLES)), { captureStdout: true });
    const actual = parseRowCounts(csv);
    const expected = manifest?.key_table_counts || {};
    const counts = compareRowCounts(expected, actual);
    const verdict = drillVerdict({ restoreSeconds, maxRestoreSeconds, counts, dumpAgeHours: (Date.now() - dumpAt.getTime()) / 36e5 });

    const report = {
      drilled_at: new Date().toISOString(),
      backup_file: basename(path),
      backup_created_at: dumpAt.toISOString(),
      target: redactedDbLabel(drillUrl),
      restore_seconds: Number(restoreSeconds.toFixed(1)),
      rto_target_seconds: maxRestoreSeconds,
      expected_counts: expected,
      actual_counts: actual,
      mismatches: counts.mismatches,
      verdict,
    };
    const reportsDir = join(resolveIntakeDir(), 'reports');
    mkdirSync(reportsDir, { recursive: true, mode: 0o700 });
    const reportPath = join(reportsDir, `restore-drill-db-${new Date().toISOString().slice(0, 10)}.json`);
    writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });

    if (verdict.ok) {
      log.info('drill.pass', { rto_seconds: verdict.rto_seconds, rpo_hours: verdict.rpo_hours, report: reportPath });
      console.log(`restore drill PASS: RTO ${verdict.rto_seconds}s, RPO ${verdict.rpo_hours}h, ${Object.keys(actual).length} key tables verified → ${reportPath}`);
    } else {
      log.error('drill.fail', { reasons: verdict.reasons.join('; '), report: reportPath });
      console.error(`restore drill FAIL: ${verdict.reasons.join('; ')} → ${reportPath}`);
      process.exitCode = 1;
    }
  } catch (error) {
    log.error('drill.error', { error });
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
