// sync/node-binary.mjs — pick a Node binary that still exists.
//
// process.execPath is the resolved real path, e.g.
// /opt/homebrew/Cellar/node/22.23.1/bin/node. `brew upgrade node` deletes that
// directory while a long-running helper keeps executing from the old inode, so
// every later child spawn fails with ENOENT. Resolve per spawn, and prefer
// version-independent shims for anything written to disk (LaunchAgents).

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

export const STABLE_NODE_PATHS = ['/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node'];

function whichNode(run) {
  try {
    const found = run('/usr/bin/env', ['which', 'node'], { encoding: 'utf8' }).trim();
    return found || null;
  } catch {
    return null;
  }
}

/** For child processes of a running helper: current binary first, if it still exists. */
export function resolveRuntimeNode({ execPath = process.execPath, exists = existsSync, run = execFileSync } = {}) {
  for (const candidate of [execPath, ...STABLE_NODE_PATHS]) {
    if (candidate && exists(candidate)) return candidate;
  }
  return whichNode(run) || 'node';
}

/** For LaunchAgent plists: a shim that survives Node upgrades. */
export function resolveStableNode({ execPath = process.execPath, exists = existsSync, run = execFileSync } = {}) {
  for (const candidate of STABLE_NODE_PATHS) {
    if (exists(candidate)) return candidate;
  }
  return (execPath && exists(execPath) ? execPath : null) || whichNode(run) || 'node';
}

/** Sanitized, non-private failure code for a finished child process. */
export function childFailureCode({ timedOut, code, signal, error }) {
  if (timedOut) return 'timeout';
  if (signal) return `signal_${String(signal).toLowerCase()}`;
  if (code !== null && code !== undefined) return `exit_${code}`;
  return `spawn_${String(error || 'failed').toLowerCase().replace(/[^a-z0-9_-]/g, '')}`;
}
