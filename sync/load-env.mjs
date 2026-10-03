import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const PROCESS_ONLY_KEYS = new Set(['CURSOR_ADMIN_API_KEY']);

function stripOptionalQuotes(value) {
  if (value.length < 2) return value;
  const first = value[0];
  const last = value[value.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return value.slice(1, -1);
  }
  return value;
}

function loadFile(path, env) {
  if (!path || !existsSync(path)) return false;
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!KEY_RE.test(key) || PROCESS_ONLY_KEYS.has(key) || env[key] !== undefined) continue;
    const value = stripOptionalQuotes(line.slice(eq + 1).trim());
    env[key] = value;
  }
  return true;
}

// Environment overrides win, then shared owner config, then checkout fallback.
// Empty MEOW_CONFIG_FILE isolates fixtures from an installed app.
export function loadEnv(repoRoot, { env = process.env, home = env.HOME || homedir(), configFile = env.MEOW_CONFIG_FILE } = {}) {
  const shared = configFile === undefined ? join(home, '.config', 'meow-ops', 'local.env') : configFile;
  const sharedLoaded = loadFile(shared, env);
  const checkoutLoaded = loadFile(join(repoRoot, '.env'), env);
  return { sharedLoaded, checkoutLoaded };
}
