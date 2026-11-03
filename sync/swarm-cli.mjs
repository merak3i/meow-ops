// sync/swarm-cli.mjs: how the helper talks to AutoSwarm.
//
// Meow Ops never speaks a native agent protocol itself. Every orchestration
// action becomes one AutoSwarm CLI command, spawned with an argv array (never
// a shell) and parsed from its JSON envelope ({ ok, data, error }).
//
// Launcher resolution, first match wins:
//   1. AUTOSWARM_BIN: an absolute path, or a JSON argv array
//   2. `autoswarm` on the helper PATH plus the usual install folders
//   3. the launcher argv AutoSwarm wrote into an installed SKILL.md

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { findExecutable, toolPath } from './swarm-status.mjs';

const SKILL_DIRS = (home, env) => [
  join(home, '.agents', 'skills', 'autoswarm'),
  join(home, '.claude', 'skills', 'autoswarm'),
  join(home, '.cursor', 'skills', 'autoswarm'),
  join(env.HERMES_HOME || join(home, '.hermes'), 'skills', 'autoswarm'),
  join(env.DSH_AGENTS_HOME || join(home, '.agents'), 'skills', 'autoswarm'),
  join(env.XDG_CONFIG_HOME || join(home, '.config'), 'opencode', 'skills', 'autoswarm'),
  join(home, '.copilot', 'skills', 'autoswarm'),
  join(home, '.grok', 'skills', 'autoswarm'),
  join(env.KIMI_CODE_HOME || join(home, '.kimi-code'), 'skills', 'autoswarm'),
];

function launcherFromSkill(dir) {
  try {
    const text = readFileSync(join(dir, 'SKILL.md'), 'utf8');
    const block = text.split('Installed launcher argv').pop()?.match(/```json\s*(\[[\s\S]*?\])\s*```/);
    const argv = block ? JSON.parse(block[1]) : null;
    return Array.isArray(argv) && argv.length && argv.every((part) => typeof part === 'string') && existsSync(argv[0]) ? argv : null;
  } catch {
    return null;
  }
}

/** The argv prefix that runs AutoSwarm on this machine, with where it came from. */
export function resolveLauncher({ env = process.env, home = homedir() } = {}) {
  const raw = String(env.AUTOSWARM_BIN || '').trim();
  if (raw) {
    if (raw.startsWith('[')) {
      try {
        const argv = JSON.parse(raw);
        if (Array.isArray(argv) && argv.length && argv.every((part) => typeof part === 'string')) return { argv, source: 'AUTOSWARM_BIN' };
      } catch { /* fall through to the error below */ }
      return { argv: null, source: 'AUTOSWARM_BIN', error: 'AUTOSWARM_BIN is not a JSON argv array.' };
    }
    const path = findExecutable(raw, { env, home });
    return path ? { argv: [path], source: 'AUTOSWARM_BIN' } : { argv: null, source: 'AUTOSWARM_BIN', error: `AUTOSWARM_BIN does not point at an executable: ${raw}` };
  }
  const onPath = findExecutable('autoswarm', { env, home });
  if (onPath) return { argv: [onPath], source: 'path' };
  for (const dir of SKILL_DIRS(home, env)) {
    const argv = launcherFromSkill(dir);
    if (argv) return { argv, source: 'skill' };
  }
  return { argv: null, source: null, error: 'AutoSwarm is not installed where the helper can run it.' };
}

// AutoSwarm binds a call to the host session it finds in these variables. The
// helper is its own controller, so a run must never inherit a Codex thread or a
// parent call from whatever terminal started the helper.
const HOST_IDENTITY = ['AUTOSWARM_CALL_ID', 'AUTOSWARM_PARENT', 'CODEX_THREAD_ID', 'AUTOSWARM_CODEX_ENDPOINT'];

/** The environment an AutoSwarm command runs with: tool PATH, explicit home, no host identity. */
export function autoswarmEnv(env, home) {
  const clean = { ...env, PATH: toolPath({ env }), AUTOSWARM_HOME: home };
  for (const name of HOST_IDENTITY) delete clean[name];
  return clean;
}

/**
 * Run one AutoSwarm command. Resolves to the parsed envelope, never rejects:
 * failures come back as { ok: false, error: { code, message } }.
 */
export function execAutoswarm(args, { launcher, home, controller = null, env = process.env, cwd, timeoutMs = 60_000 } = {}) {
  return new Promise((resolve) => {
    if (!launcher?.length) {
      resolve({ ok: false, error: { code: 'autoswarm_unavailable', message: 'AutoSwarm is not installed where the helper can run it.' } });
      return;
    }
    const [command, ...prefix] = launcher;
    const globals = [...(prefix.includes('--home') ? [] : ['--home', home]), ...(controller ? ['--controller', controller] : [])];
    const child = spawn(command, [...prefix, ...globals, ...args], {
      cwd: cwd || home,
      env: autoswarmEnv(env, home),
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.stdout.on('data', (chunk) => { stdout = (stdout + chunk).slice(-4_000_000); });
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-20_000); });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ ok: false, error: { code: 'spawn_failed', message: error.message } });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      for (const text of [stdout.trim(), stderr.trim()]) {
        const line = text.split('\n').reverse().find((candidate) => candidate.trim().startsWith('{'));
        if (!line) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed && typeof parsed === 'object' && 'ok' in parsed) {
            resolve(parsed.ok ? parsed : { ok: false, error: parsed.error ?? { code: 'autoswarm_failed', message: 'AutoSwarm reported a failure.' } });
            return;
          }
        } catch { /* try the next stream */ }
      }
      resolve({ ok: false, error: { code: signal ? 'timeout' : 'autoswarm_failed', message: (stderr.trim() || stdout.trim() || `AutoSwarm exited with ${code ?? signal}`).slice(-600) } });
    });
  });
}
