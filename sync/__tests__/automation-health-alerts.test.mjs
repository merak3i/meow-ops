import test from 'node:test';
import assert from 'node:assert/strict';
import { alertOnFlags, flaggedAgents } from '../automation-health.mjs';
import { dedupeKeyFor } from '../notify.mjs';

const quiet = { info() {}, warn() {}, error() {}, debug() {} };

const healthy = { label: 'com.meowops.dashboard', flags: [], last_exit_status: 0, log_staleness_hours: 0.2, last_error_signature: null };
const failed = { label: 'com.meowops.harness-sync', flags: ['failed'], last_exit_status: 1, log_staleness_hours: 0.1, last_error_signature: 'sig-abc' };
const stale = { label: 'com.meowops.db-backup', flags: ['stale-log'], last_exit_status: 0, log_staleness_hours: 30, last_error_signature: null };

test('a clear snapshot sends nothing', async () => {
  const sent = [];
  const result = await alertOnFlags({ agents: [healthy] }, { notify: async (alert) => { sent.push(alert); return { status: 'sent' }; }, logger: quiet });
  assert.deepEqual(result, { status: 'clear', flagged: 0 });
  assert.equal(sent.length, 0);
  assert.deepEqual(flaggedAgents({ agents: [healthy, failed] }), [failed]);
});

test('flagged agents produce one summarized alert with a stable dedupe key; severity follows the worst flag', async () => {
  const sent = [];
  const notify = async (alert) => { sent.push(alert); return { status: 'sent', dedupe_key: alert.dedupeKey }; };
  const result = await alertOnFlags({ agents: [healthy, failed, stale] }, { notify, logger: quiet });
  assert.equal(result.status, 'sent');
  assert.equal(result.flagged, 2);
  assert.equal(sent.length, 1);
  const [alert] = sent;
  assert.equal(alert.event, 'agent_unhealthy');
  assert.equal(alert.severity, 'high');
  assert.equal(alert.title, '2 launchd agents flagged');
  assert.deepEqual(alert.lines, [
    'com.meowops.harness-sync: failed exit=1 stale=0.1h sig=sig-abc',
    'com.meowops.db-backup: stale-log exit=0 stale=30h',
  ]);
  assert.equal(alert.dedupeKey, dedupeKeyFor([['com.meowops.harness-sync', ['failed'], 'sig-abc'], ['com.meowops.db-backup', ['stale-log'], null]]));

  const again = [];
  await alertOnFlags({ agents: [stale] }, { notify: async (a) => { again.push(a); return { status: 'sent' }; }, logger: quiet });
  assert.equal(again[0].severity, 'medium');
  assert.equal(again[0].title, '1 launchd agent flagged');
});

test('alerts can be disabled per call and never throw into the health run', async () => {
  const result = await alertOnFlags({ agents: [failed] }, { alerts: false, notify: async () => { throw new Error('must not be called'); }, logger: quiet });
  assert.deepEqual(result, { status: 'clear', flagged: 0 });
  const failing = await alertOnFlags({ agents: [failed] }, { notify: async () => ({ status: 'failed', error: 'telegram 500' }), logger: quiet });
  assert.equal(failing.status, 'failed');
  assert.equal(failing.flagged, 1);
});
