import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function stripOptionalQuotes(value) {
  if (value.length < 2) return value;
  const first = value[0];
  const last = value[value.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return value.slice(1, -1);
  }
  return value;
}

export function loadEnv(repoRoot) {
  const path = join(repoRoot, '.env');
  if (!existsSync(path)) return;
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!KEY_RE.test(key) || process.env[key] !== undefined) continue;
    const value = stripOptionalQuotes(line.slice(eq + 1).trim());
    process.env[key] = value;
  }
}
