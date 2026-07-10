import { execFile } from 'node:child_process';
import {
  existsSync, readFileSync, readdirSync, statSync,
} from 'node:fs';
import { basename, join } from 'node:path';
import { homedir } from 'node:os';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

import { assertRedacted } from './loop-ledger.mjs';
import { resolveIntakeDir, writeIntakeJson } from './intake-local.mjs';

const execFileAsync = promisify(execFile);
const HEALTH_FILE = 'automation-health.json';
const ANSI_RE = new RegExp(String.raw`\x1b\[[0-9;]*m`, 'g');
const ABS_HOME_RE = new RegExp(`/${'Users'}/[^\\s'"<>]+`, 'g');
const ABS_PATH_RE = /(?:\/private\/var|\/var|\/tmp|\/opt|\/Applications)\/[^\s'"<>]+/g;
const SECRET_REPLACERS = [
  /\bsk-[A-Za-z0-9_-]{8,}/g,
  /\bghp_[A-Za-z0-9]{10,}/g,
  new RegExp(`${'GOCSPX'}-[A-Za-z0-9_-]+`, 'g'),
  new RegExp(`\\b${'sb_secret'}_[A-Za-z0-9_-]+`, 'g'),
  /\bre_[A-Za-z0-9]{16,}/g,
  /\beyJ[A-Za-z0-9_-]{20,}/g,
  /[A-Za-z0-9+/]{41,}={0,2}/g,
];
const ERROR_RE = /error|warn|fail|exception|module_not_found|traceback|denied/i;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--json') out.json = true;
  }
  return out;
}

function extractPlistString(xml, key) {
  const re = new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`);
  return xml.match(re)?.[1] || null;
}

function readLaunchAgents(dir = join(homedir(), 'Library', 'LaunchAgents')) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith('.plist'))
    .sort()
    .map((file) => {
      const path = join(dir, file);
      let xml = '';
      try { xml = readFileSync(path, 'utf8'); } catch {}
      return {
        label: extractPlistString(xml, 'Label') || basename(file, '.plist'),
        stdout: extractPlistString(xml, 'StandardOutPath'),
        stderr: extractPlistString(xml, 'StandardErrorPath'),
      };
    });
}

function parseLaunchctl(text) {
  const byLabel = new Map();
  for (const line of String(text || '').split(/\r?\n/).slice(1)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\s+/);
    const label = parts.slice(2).join(' ');
    if (!label) continue;
    byLabel.set(label, {
      pid: parts[0] === '-' ? null : Number(parts[0]),
      status: parts[1] === '-' ? 0 : Number(parts[1]),
    });
  }
  return byLabel;
}

async function launchctlMap(text) {
  if (text !== undefined) return parseLaunchctl(text);
  try {
    const result = await execFileAsync('launchctl', ['list'], { maxBuffer: 2 * 1024 * 1024 });
    return parseLaunchctl(result.stdout);
  } catch {
    return new Map();
  }
}

function walkFiles(root) {
  if (!root || !existsSync(root)) return [];
  const out = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(path));
    else if (entry.isFile()) out.push(path);
  }
  return out;
}

function scrubSignature(line) {
  let out = String(line || '')
    .replace(ANSI_RE, ' ')
    .replace(ABS_HOME_RE, '<path>')
    .replace(ABS_PATH_RE, '<path>');
  for (const re of SECRET_REPLACERS) out = out.replace(re, '<redacted>');
  out = out.replace(/\s+/g, ' ').trim().slice(0, 180);
  if (!out) return null;
  try {
    assertRedacted({ signature: out }, 'automation-health-signature');
    return out;
  } catch {
    return '<redacted>';
  }
}

function lastInterestingLine(path) {
  let text;
  try {
    const content = readFileSync(path, 'utf8');
    text = content.slice(Math.max(0, content.length - 32_000));
  } catch {
    return null;
  }
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const interesting = [...lines].reverse().find((line) => ERROR_RE.test(line));
  return scrubSignature(interesting || lines.at(-1) || '');
}

function candidateLogFiles(agent, logsDir) {
  const candidates = new Set();
  for (const path of [agent.stdout, agent.stderr]) {
    if (path && existsSync(path)) candidates.add(path);
  }
  const haystack = [agent.label, agent.label.split('.').at(-1)].join(' ').toLowerCase();
  for (const file of walkFiles(logsDir)) {
    const lower = file.toLowerCase();
    if (haystack.split(/\s+/).some((part) => part.length > 3 && lower.includes(part))) {
      candidates.add(file);
    }
  }
  return [...candidates];
}

function summarizeAgent(agent, launchctl, logsDir, now) {
  const status = launchctl.get(agent.label) || null;
  const logFiles = candidateLogFiles(agent, logsDir);
  let latestMtime = null;
  let signature = null;
  for (const file of logFiles) {
    let stat;
    try { stat = statSync(file); } catch { continue; }
    if (!latestMtime || stat.mtimeMs > latestMtime) latestMtime = stat.mtimeMs;
    if (!signature) signature = lastInterestingLine(file);
  }
  const staleness = latestMtime === null
    ? null
    : Math.max(0, Math.round((new Date(now).getTime() - latestMtime) / 36_000) / 100);
  const flags = [];
  if (status?.status && status.status !== 0) flags.push('failed');
  if (staleness === null) flags.push('no-log');
  else if (staleness > 24) flags.push('stale-log');
  return {
    label: agent.label,
    running: Boolean(status?.pid),
    last_exit_status: status ? status.status : null,
    log_staleness_hours: staleness,
    last_error_signature: signature || null,
    flags,
  };
}

function cleanSnapshot(snapshot) {
  const clean = {
    generated_at: snapshot.generated_at,
    agents: snapshot.agents.map((agent) => ({
      label: String(agent.label),
      running: Boolean(agent.running),
      last_exit_status: agent.last_exit_status === null ? null : Number(agent.last_exit_status),
      log_staleness_hours: agent.log_staleness_hours === null ? null : Number(agent.log_staleness_hours),
      last_error_signature: agent.last_error_signature === null ? null : String(agent.last_error_signature),
      flags: Array.isArray(agent.flags) ? agent.flags.map(String) : [],
    })),
  };
  assertRedacted(clean, 'automation-health');
  return clean;
}

export async function runAutomationHealth(options = {}) {
  const now = options.now || new Date();
  const intakeDir = options.intakeDir || resolveIntakeDir(options.env || process.env);
  const agents = options.agents || readLaunchAgents(options.launchAgentsDir);
  const launchctl = await launchctlMap(options.launchctlText);
  const logsDir = options.logsDir || join(homedir(), 'Library', 'Logs');
  const snapshot = cleanSnapshot({
    generated_at: new Date(now).toISOString(),
    agents: agents
      .sort((a, b) => a.label.localeCompare(b.label))
      .map((agent) => summarizeAgent(agent, launchctl, logsDir, now)),
  });
  writeIntakeJson(intakeDir, HEALTH_FILE, snapshot);
  return snapshot;
}

export async function main(argv = process.argv.slice(2)) {
  parseArgs(argv);
  const snapshot = await runAutomationHealth();
  console.log(JSON.stringify(snapshot, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
