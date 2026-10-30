// sync/claude-roots.mjs — every local directory Claude Code may write session JSONL to.
//
// Claude Code has used ~/.claude/projects and the XDG location
// ~/.config/claude/projects, and CLAUDE_CONFIG_DIR (comma-separated) moves the
// config root. Reading only one of them silently drops recent sessions.
import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export function claudeProjectRoots({ env = process.env, home = env.HOME || homedir(), exists = existsSync, real = realpathSync } = {}) {
  const configured = String(env.CLAUDE_CONFIG_DIR || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => join(resolve(value.replace(/^~(?=$|\/)/, home)), 'projects'));
  const candidates = [
    ...configured,
    join(home, '.config', 'claude', 'projects'),
    join(home, '.claude', 'projects'),
  ];
  const seen = new Set();
  const roots = [];
  for (const candidate of candidates) {
    if (!exists(candidate)) continue;
    let key = candidate;
    try { key = real(candidate); } catch { /* keep the literal path */ }
    if (seen.has(key)) continue;
    seen.add(key);
    roots.push(candidate);
  }
  // Keep the legacy default so missing-source coverage is still reported.
  return roots.length ? roots : [join(home, '.claude', 'projects')];
}
