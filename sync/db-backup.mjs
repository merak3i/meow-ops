#!/usr/bin/env node
// Supabase Postgres logical backup (SHIP-GATE check 16).
//
//   DATABASE_URL=postgresql://... node sync/db-backup.mjs
//
// Writes <intake dir>/backups/db/db-<utc>.sql.gz plus latest.json, verifies the dump, records
// key-table row counts for the restore drill, prunes to MEOW_DB_BACKUP_KEEP (14). The intake dir
// is outside the worktree by construction (see resolveIntakeDir), so dumps never land in git.
// Needs `pg_dump` and `psql` on PATH (Postgres.app or `brew install libpq`).
//
// A Free-tier Supabase project has NO managed backups; this dump is the only copy. The launchd
// agent com.meowops.db-backup runs it nightly; docs/BACKUP_RESTORE.md covers off-machine copies.

import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createGzip, gunzipSync } from 'node:zlib';
import { loadEnv } from './load-env.mjs';
import { resolveIntakeDir } from './intake-local.mjs';
import { createLogger, newRunId } from './log.mjs';
import { notify } from './notify.mjs';
import {
  DEFAULT_KEEP,
  DRILL_KEY_TABLES,
  backupFileName,
  inspectDump,
  parseRowCounts,
  pgDumpArgs,
  psqlCsvArgs,
  redactedDbLabel,
  rowCountSql,
  selectBackupsToPrune,
  sha256Hex,
} from './db-backup-lib.mjs';

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

function env(name, fallback = '') {
  return String(process.env[name] || fallback).trim();
}

function run(cmd, args, { captureStdout = false } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', captureStdout ? 'pipe' : 'inherit', 'pipe'], env: process.env });
    let out = '';
    let err = '';
    child.stdout?.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { err += chunk; });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolvePromise(out) : reject(new Error(`${cmd} exited ${code}: ${err.trim().slice(0, 500)}`))));
  });
}

export function backupDir(environment = process.env) {
  const override = String(environment.MEOW_DB_BACKUP_DIR || '').trim();
  return override ? resolve(override) : join(resolveIntakeDir(environment), 'backups', 'db');
}

async function keyTableCounts(url) {
  const csv = await run('psql', psqlCsvArgs(url, rowCountSql(DRILL_KEY_TABLES)), { captureStdout: true });
  return parseRowCounts(csv);
}

export async function runBackup({ log = createLogger({ component: 'db-backup', run_id: process.env.MEOW_RUN_ID || newRunId() }) } = {}) {
  const url = env('DATABASE_URL');
  if (!url) throw new Error('DATABASE_URL is not set (Supabase → Project Settings → Database → Connection string, URI, session mode)');
  if (!/^postgres(ql)?:\/\//.test(url)) throw new Error('DATABASE_URL must be a postgresql:// connection string, not the project REST URL');

  const dir = backupDir();
  const keep = Number.parseInt(env('MEOW_DB_BACKUP_KEEP', String(DEFAULT_KEEP)), 10) || DEFAULT_KEEP;
  mkdirSync(dir, { recursive: true, mode: 0o700 });

  const name = backupFileName(new Date());
  const target = join(dir, name);
  const label = redactedDbLabel(url);
  const startedAt = Date.now();
  log.info('backup.start', { database: label, target: name, keep });

  // pg_dump → gzip → file. Streamed, so the database never sits in memory.
  await new Promise((resolvePromise, reject) => {
    const dump = spawn('pg_dump', pgDumpArgs(url), { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
    const gzip = createGzip({ level: 6 });
    const file = createWriteStream(target, { mode: 0o600 });
    let err = '';
    dump.stderr.on('data', (chunk) => { err += chunk; });
    dump.on('error', reject);
    file.on('error', reject);
    gzip.on('error', reject);
    file.on('finish', () => resolvePromise());
    dump.on('exit', (code) => {
      if (code !== 0) reject(new Error(`pg_dump exited ${code}: ${err.trim().slice(0, 500)}`));
    });
    dump.stdout.pipe(gzip).pipe(file);
  });

  const bytes = statSync(target).size;
  const gz = readFileSync(target);
  const stats = inspectDump(gunzipSync(gz).toString('utf8'));
  if (bytes < 1024 || !stats.isPgDump || !stats.hasCompleteMarker || stats.createTables === 0) {
    unlinkSync(target);
    throw new Error(`dump failed verification (bytes=${bytes}, pg_dump=${stats.isPgDump}, complete=${stats.hasCompleteMarker}, tables=${stats.createTables})`);
  }

  let counts = {};
  try {
    counts = await keyTableCounts(url);
  } catch (error) {
    log.warn('backup.counts_unavailable', { error });
  }

  const manifest = {
    file: name,
    created_at: new Date().toISOString(),
    database: label,
    bytes,
    sha256: sha256Hex(gz),
    create_tables: stats.createTables,
    copy_blocks: stats.copyBlocks,
    key_table_counts: counts,
    duration_ms: Date.now() - startedAt,
  };
  writeFileSync(join(dir, 'latest.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
  writeFileSync(join(dir, `${name}.json`), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });

  for (const old of selectBackupsToPrune(readdirSync(dir), keep)) {
    unlinkSync(join(dir, old));
    if (existsSync(join(dir, `${old}.json`))) unlinkSync(join(dir, `${old}.json`));
    log.info('backup.pruned', { file: old });
  }

  log.info('backup.complete', { file: name, bytes, create_tables: stats.createTables, copy_blocks: stats.copyBlocks, duration_ms: manifest.duration_ms });
  return { dir, manifest };
}

export async function main() {
  loadEnv(REPO_ROOT);
  const log = createLogger({ component: 'db-backup', run_id: process.env.MEOW_RUN_ID || newRunId() });
  try {
    const { dir, manifest } = await runBackup({ log });
    console.log(`backup written: ${join(dir, manifest.file)} (${(manifest.bytes / 1024 / 1024).toFixed(2)} MiB, ${manifest.create_tables} tables)`);
  } catch (error) {
    log.error('backup.failed', { error });
    await notify({
      event: 'db_backup_failed',
      severity: 'high',
      title: 'nightly Postgres backup failed',
      lines: [error instanceof Error ? error.message : String(error)],
      dedupeKey: 'db-backup:failed',
    });
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
