// Replay current local sources into a new private candidate, never the active
// installation. A second pass verifies incremental collection and reconciliation.
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadEnv } from '../sync/load-env.mjs';
import { assertHistoryOutsideWorktree, querySessionHistory } from '../sync/session-history.mjs';
import { readSnapshot } from '../sync/snapshot-generation.mjs';
import { runSync } from '../sync/sync-runner.mjs';

const repoRoot = resolve(import.meta.dirname, '..');
const [destination, seed] = process.argv.slice(2);
if (!destination || !seed) throw new Error('Provide a new private validation directory and an existing seed archive directory.');
const root = resolve(destination);
assertHistoryOutsideWorktree(root);
if (existsSync(root)) throw new Error('The validation directory already exists; choose a new directory.');
for (const file of ['current.json', 'sessions.jsonl']) {
  if (!existsSync(join(seed, file))) throw new Error('The seed archive is incomplete.');
}
mkdirSync(root, { recursive: true, mode: 0o700 });
mkdirSync(join(root, 'session-history'), { mode: 0o700 });
for (const file of ['current.json', 'sessions.jsonl']) copyFileSync(join(seed, file), join(root, 'session-history', file));
const env = { ...process.env };
loadEnv(repoRoot, { env });
Object.assign(env, {
  MEOW_CONFIG_FILE: '', CURSOR_ADMIN_API_KEY: '', MEOW_SKIP_CURSOR: '0', MEOW_REFRESH_LIMITS: '0',
  MEOW_DATA_DIR: join(root, 'data'), MEOW_SESSION_HISTORY_DIR: join(root, 'session-history'),
  MEOW_EVIDENCE_DIR: join(root, 'evidence'), MEOW_RUNTIME_DIR: join(root, 'runtime'),
  MEOW_LOOP_DIR: join(root, 'loop-ledger'),
});
const runs = [];
for (let pass = 1; pass <= 2; pass++) {
  const started = performance.now();
  const result = await runSync({ repoRoot, env, refreshLimits: false, trigger: 'private-validation' });
  const report = { pass, state: result.state, elapsedMs: Math.round(performance.now() - started), failure: result.failure || null };
  if (result.state === 'succeeded') {
    const snapshot = readSnapshot(env.MEOW_DATA_DIR);
    const scope = { dir: env.MEOW_SESSION_HISTORY_DIR, expectedVersion: snapshot.summary.archive.version, snapshotBytes: snapshot.summary.archive.snapshotBytes, limit: 500 };
    const identities = new Set();
    let cursor = null;
    let total;
    do {
      const page = querySessionHistory({ ...scope, cursor });
      total = page.total;
      for (const row of page.items) identities.add(JSON.stringify([row.source, row.session_id]));
      cursor = page.nextCursor;
    } while (cursor);
    assert.equal(identities.size, total);
    assert.equal(total, snapshot.summary.allTime.sessions);
    assert.equal(total, snapshot.summary.archive.total);
    Object.assign(report, { reconciledSessions: total, generation: snapshot.generation.id,
      sourceHealth: snapshot.summary.sourceHealth, evidenceCoverage: snapshot.summary.guideEvidenceCoverage,
      cursorApi: snapshot.summary.cursorUsage?.status });
  }
  runs.push(report);
  writeFileSync(join(root, 'validation.json'), JSON.stringify({ schemaVersion: 1, recordedAt: new Date().toISOString(), runs }, null, 2), { mode: 0o600 });
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (result.state !== 'succeeded') { process.exitCode = 1; break; }
}
