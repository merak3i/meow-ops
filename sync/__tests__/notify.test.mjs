import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNotifier, formatAlert, notificationConfigured, dedupeKeyFor } from '../notify.mjs';

const quiet = { info() {}, warn() {}, error() {}, debug() {} };

function fakeFetch(status = 200) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), signal: init.signal });
    return { ok: status < 400, status };
  };
  return { fn, calls };
}

test('unconfigured notifier is a silent no-op and nothing leaves the machine', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'meow-notify-'));
  const fetch = fakeFetch();
  const n = createNotifier({ env: {}, fetchImpl: fetch.fn, stateDir: dir, logger: quiet });
  assert.equal(notificationConfigured({}), false);
  assert.equal(n.configured(), false);
  const result = await n.notify({ event: 'sync_failed', title: 'x' });
  assert.equal(result.status, 'unconfigured');
  assert.equal(fetch.calls.length, 0);
  rmSync(dir, { recursive: true, force: true });
});

test('configured notifier sends a redacted summary once per dedupe window, with a bounded timeout', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'meow-notify-'));
  const env = { MEOW_TELEGRAM_BOT_TOKEN: '123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef0123456789', MEOW_TELEGRAM_CHAT_ID: '42', MEOW_ALERT_DEDUPE_HOURS: '1', HOSTNAME: 'mba' };
  let clock = 1_000_000;
  const fetch = fakeFetch();
  const n = createNotifier({ env, fetchImpl: fetch.fn, stateDir: dir, now: () => clock, logger: quiet, timeoutMs: 1234 });

  const first = await n.notify({ event: 'sync_failed', severity: 'high', title: 'scheduled sync failed', lines: ['error at /Users/napster/x with key sk-abcdefghijklmnop'] });
  assert.equal(first.status, 'sent');
  assert.equal(fetch.calls.length, 1);
  assert.equal(fetch.calls[0].body.chat_id, '42');
  assert.match(fetch.calls[0].url, /^https:\/\/api\.telegram\.org\/bot123456789:/);
  assert.match(fetch.calls[0].body.text, /^\[meow-ops\] HIGH sync_failed: scheduled sync failed\n• error at ~\/x with key \[redacted\]\nhost=mba at=/);
  assert.ok(fetch.calls[0].signal instanceof AbortSignal);

  const second = await n.notify({ event: 'sync_failed', severity: 'high', title: 'scheduled sync failed', lines: ['again'] });
  assert.equal(second.status, 'deduped');
  assert.equal(fetch.calls.length, 1);

  clock += 2 * 3_600_000;
  const third = await n.notify({ event: 'sync_failed', severity: 'high', title: 'scheduled sync failed', lines: ['later'] });
  assert.equal(third.status, 'sent');
  assert.equal(fetch.calls.length, 2);

  const state = JSON.parse(readFileSync(join(dir, 'alerts-state.json'), 'utf8'));
  assert.deepEqual(Object.keys(state), [dedupeKeyFor(['sync_failed', 'scheduled sync failed'])]);
  rmSync(dir, { recursive: true, force: true });
});

test('delivery failures are returned, never thrown, and do not consume the dedupe slot', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'meow-notify-'));
  const env = { MEOW_TELEGRAM_BOT_TOKEN: 't', MEOW_TELEGRAM_CHAT_ID: 'c' };
  const failing = fakeFetch(500);
  const n = createNotifier({ env, fetchImpl: failing.fn, stateDir: dir, logger: quiet });
  const result = await n.notify({ event: 'agent_unhealthy', title: 'x' });
  assert.equal(result.status, 'failed');
  assert.match(result.error, /500/);
  const again = await n.notify({ event: 'agent_unhealthy', title: 'x' });
  assert.equal(again.status, 'failed');
  assert.equal(failing.calls.length, 2);
  rmSync(dir, { recursive: true, force: true });
});

test('formatAlert caps length and strips secrets from every part', () => {
  const text = formatAlert({ event: 'e', severity: 'medium', title: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.x.y', lines: Array.from({ length: 400 }, (_, i) => `line ${i} ghp_abcdefghijklmnopqrstuvwxyz0123456789`), hostname: '/Users/napster' });
  assert.ok(text.length <= 3500);
  assert.doesNotMatch(text, /ghp_abcdefghijklmnopqrstuvwxyz/);
  assert.doesNotMatch(text, /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9/);
  assert.match(text, /host=~ /);
});
