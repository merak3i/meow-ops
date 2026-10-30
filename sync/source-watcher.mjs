// sync/source-watcher.mjs — start a sync when any agent writes new session data.
//
// The 5-minute harness-sync LaunchAgent stays as a backstop. This watcher runs
// inside the always-on helper so new Claude Code, Codex, Cursor, Hermes,
// Antigravity and extra (e.g. DeepSeek harness) sessions land within about a
// minute without anyone pressing Sync. Disable with MEOW_WATCH_SOURCES=0.
import { existsSync, watch as fsWatch } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { claudeProjectRoots } from './claude-roots.mjs';

const RELEVANT = /\.(jsonl|json|db|db-wal|sqlite|sqlite-wal|md|pb)$/i;

export function defaultWatchRoots(env = process.env) {
  const home = env.HOME || homedir();
  const extra = String(env.MEOW_EXTRA_WATCH_ROOTS || '')
    .split(':').map((value) => value.trim()).filter(Boolean);
  return [...new Set([
    ...claudeProjectRoots({ env, home }),
    join(home, '.codex', 'sessions'),
    env.CURSOR_PROJECTS_DIR || join(home, '.cursor', 'projects'),
    env.HERMES_STATE_DB ? join(env.HERMES_STATE_DB, '..') : join(home, '.hermes'),
    env.ANTIGRAVITY_DIR || join(home, '.gemini', 'antigravity'),
    ...extra,
  ])];
}

/**
 * Debounced trigger: waits for writes to settle (quietMs), never runs more
 * often than minIntervalMs, and retries later when a sync is already running.
 */
export function createSourceWatcher({
  roots = defaultWatchRoots(),
  trigger,
  quietMs = 45_000,
  minIntervalMs = 90_000,
  maxWaitMs = 180_000,
  busyRetryMs = 20_000,
  rescanMs = 600_000,
  watch = fsWatch,
  exists = existsSync,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  setRepeat = setInterval,
  clearRepeat = clearInterval,
  log = () => {},
} = {}) {
  const watchers = new Map();
  let timer = null;
  let lastRun = -Infinity;
  let pendingSince = null;
  let stopped = false;
  const stats = { events: 0, triggers: 0, busy: 0 };

  // Active sessions append continuously, so a pure debounce would never fire.
  // maxWaitMs caps how long a pending change can be deferred.
  function schedule(delay = quietMs) {
    if (stopped) return;
    if (pendingSince === null) pendingSince = now();
    if (timer) clearTimer(timer);
    const capped = Math.min(delay, Math.max(0, pendingSince + maxWaitMs - now()));
    timer = setTimer(fire, Math.max(capped, minIntervalMs - (now() - lastRun), 0));
  }

  function fire() {
    timer = null;
    if (stopped) return;
    const result = trigger();
    if (result?.accepted === false) {
      // A run is in progress (dashboard, timer or a previous trigger). Check
      // again shortly instead of spinning against the max-wait cap.
      stats.busy++;
      timer = setTimer(fire, busyRetryMs);
      return;
    }
    lastRun = now();
    pendingSince = null;
    stats.triggers++;
  }

  function attach() {
    for (const root of roots) {
      if (watchers.has(root) || !exists(root)) continue;
      try {
        const handle = watch(root, { recursive: true, persistent: false }, (_event, name) => {
          if (name && !RELEVANT.test(String(name))) return;
          stats.events++;
          schedule();
        });
        handle.on?.('error', () => { watchers.delete(root); handle.close?.(); });
        watchers.set(root, handle);
      } catch {
        log(`watch unavailable for one source root`);
      }
    }
  }

  attach();
  const rescan = setRepeat(attach, rescanMs);
  rescan?.unref?.();

  return {
    roots: () => [...watchers.keys()],
    stats: () => ({ ...stats, watching: watchers.size }),
    stop() {
      stopped = true;
      if (timer) clearTimer(timer);
      clearRepeat(rescan);
      for (const handle of watchers.values()) handle.close?.();
      watchers.clear();
    },
  };
}
