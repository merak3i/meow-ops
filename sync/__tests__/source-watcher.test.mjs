import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSourceWatcher, defaultWatchRoots } from '../source-watcher.mjs';

function fakeClock() {
  let t = 0;
  const timers = new Map();
  let id = 0;
  return {
    now: () => t,
    setTimer: (fn, ms) => { timers.set(++id, { fn, at: t + ms }); return id; },
    clearTimer: (h) => timers.delete(h),
    setRepeat: () => 0,
    clearRepeat: () => {},
    advance(ms) {
      const end = t + ms;
      for (;;) {
        const next = [...timers.entries()].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        timers.delete(next[0]);
        t = next[1].at;
        next[1].fn();
      }
      t = end;
    },
  };
}

function harness(opts = {}) {
  const clock = fakeClock();
  let emit;
  const calls = [];
  const results = opts.results || [];
  const w = createSourceWatcher({
    roots: ['/r'], exists: () => true,
    watch: (_root, _o, cb) => { emit = cb; return { close() {}, on() {} }; },
    trigger: () => { calls.push(clock.now()); return results.shift() ?? { accepted: true }; },
    ...clock, quietMs: 45_000, minIntervalMs: 90_000, maxWaitMs: 180_000, busyRetryMs: 20_000,
  });
  return { clock, calls, emit: (name = 'a/b.jsonl') => emit('change', name), w };
}

test('a burst of writes triggers one sync after the quiet period', () => {
  const h = harness();
  h.emit(); h.clock.advance(10_000); h.emit(); h.clock.advance(10_000); h.emit();
  h.clock.advance(44_000);
  assert.equal(h.calls.length, 0);
  h.clock.advance(2_000);
  assert.equal(h.calls.length, 1);
});

test('continuous appends from a live session still sync within the max wait', () => {
  const h = harness();
  for (let i = 0; i < 30; i++) { h.emit(); h.clock.advance(10_000); }
  assert.ok(h.calls.length >= 1);
  assert.ok(h.calls[0] <= 180_000);
});

test('irrelevant files are ignored and busy runs are retried, not dropped', () => {
  const h = harness({ results: [{ accepted: false }, { accepted: true }] });
  h.emit('notes.txt');
  h.clock.advance(300_000);
  assert.equal(h.calls.length, 0);
  h.emit();
  h.clock.advance(45_000);
  assert.equal(h.calls.length, 1);
  h.clock.advance(20_000);
  assert.equal(h.calls.length, 2);
  assert.equal(h.w.stats().busy, 1);
});

test('syncs are spaced by the minimum interval', () => {
  const h = harness();
  h.emit(); h.clock.advance(45_000);
  assert.equal(h.calls.length, 1);
  h.emit(); h.clock.advance(80_000);
  assert.equal(h.calls.length, 1);
  h.clock.advance(15_000);
  assert.equal(h.calls.length, 2);
  assert.ok(h.calls[1] - h.calls[0] >= 90_000);
});

test('real fs.watch fires on a new session file', async () => {
  const root = mkdtempSync(join(tmpdir(), 'meow-watch-'));
  mkdirSync(join(root, 'proj'));
  let fired = 0;
  const w = createSourceWatcher({ roots: [root], trigger: () => { fired++; return { accepted: true }; }, quietMs: 50, minIntervalMs: 0, maxWaitMs: 1000 });
  try {
    await new Promise((r) => setTimeout(r, 100));
    writeFileSync(join(root, 'proj', 's.jsonl'), '{}\n');
    await new Promise((r) => setTimeout(r, 600));
    assert.equal(fired, 1);
  } finally {
    w.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test('default roots include every collected agent and extra roots', () => {
  const roots = defaultWatchRoots({ HOME: '/Users/me', MEOW_EXTRA_WATCH_ROOTS: '/Users/me/deepseek-harness' });
  for (const part of ['.claude/projects', '.codex/sessions', '.cursor/projects', '.hermes', '.gemini/antigravity', 'results/deepseek', 'deepseek-harness']) {
    assert.ok(roots.some((r) => r.includes(part)), part);
  }
});

test('DeepSeek watcher root can be configured explicitly', () => {
  const roots = defaultWatchRoots({ HOME: '/Users/me', DEEPSEEK_HARNESS_DIR: '/tmp/deepseek-fixture' });
  assert.ok(roots.includes('/tmp/deepseek-fixture'));
});
