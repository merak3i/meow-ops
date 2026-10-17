// Operator failure alerts (SHIP-GATE check 19). Opt-in, local-first, best effort.
//
// Configure MEOW_TELEGRAM_BOT_TOKEN and MEOW_TELEGRAM_CHAT_ID to receive a Telegram message
// when an agent fails, a sync run ends in `failed`, or the daily operator crashes. Unset →
// every call returns { status: 'unconfigured' } and nothing leaves the machine.
//
// Rules:
//   - Text passes through sync/log.mjs redact(): no keys, JWTs, or home paths.
//   - Only summaries are sent (agent label, flags, exit status, error signature). Never
//     transcripts, proposal bodies, or ledger rows.
//   - Dedupe: the same dedupe_key is sent at most once per MEOW_ALERT_DEDUPE_HOURS (6).
//     State lives in <intake dir>/alerts-state.json, outside the worktree like other intake.
//   - notify() never throws. A failed delivery is logged and returned, not raised.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createLogger, redact } from './log.mjs';

// This module is imported by sync-runner.mjs, which vite.config.js loads at config time and
// which the Vercel allowlist (.vercelignore) ships. Keep its imports to node builtins and
// log.mjs; the intake-dir rules are mirrored here instead of importing intake-local.mjs,
// whose dependency chain (loop-ledger, lmstudio-client) must stay out of that bundle.

const STATE_FILE = 'alerts-state.json';
const MAX_TEXT = 3500; // Telegram caps messages at 4096 chars

// Same guard as loop-ledger.assertOutsideWorktree: alert state never lands inside a git checkout.
function assertOutsideWorktree(dir) {
  let current = resolve(dir);
  while (true) {
    if (existsSync(join(current, '.git'))) {
      throw new Error(`[worktree-guard] alert state dir ${dir} is inside a git worktree (${current}) — refusing`);
    }
    const parent = dirname(current);
    if (parent === current) return dir;
    current = parent;
  }
}

export function resolveAlertStateDir(env = process.env) {
  const dir = resolve(env.MEOW_INTAKE_DIR || join(homedir(), '.meow-ops', 'intake'));
  return assertOutsideWorktree(dir);
}

export function notificationConfigured(env = process.env) {
  return Boolean(String(env.MEOW_TELEGRAM_BOT_TOKEN || '').trim() && String(env.MEOW_TELEGRAM_CHAT_ID || '').trim());
}

export function dedupeKeyFor(parts) {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 16);
}

export function formatAlert({ event, severity = 'high', title, lines = [], hostname = 'local' }) {
  const head = redact(`[meow-ops] ${severity.toUpperCase()} ${event}${title ? `: ${title}` : ''}`);
  const foot = redact(`host=${redact(hostname)} at=${new Date().toISOString()}`);
  // Trim the body, never the header or footer: a truncated alert must still say where and when.
  const budget = Math.max(0, MAX_TEXT - head.length - foot.length - 2);
  let body = lines.filter(Boolean).map((line) => `• ${redact(line)}`).join('\n');
  if (body.length > budget) body = `${body.slice(0, Math.max(0, budget - 2))}…`;
  return `${head}\n${body}${body ? '\n' : ''}${foot}`;
}

function readState(path) {
  try {
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
  } catch {
    return {};
  }
}

function writeState(path, state) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2) + '\n');
}

export function createNotifier({
  env = process.env,
  fetchImpl = globalThis.fetch,
  stateDir = null,
  now = () => Date.now(),
  logger = createLogger({ component: 'notify' }),
  timeoutMs = 10_000,
} = {}) {
  const dedupeHours = Number.parseFloat(env.MEOW_ALERT_DEDUPE_HOURS || '6') || 6;

  async function send(text) {
    const token = String(env.MEOW_TELEGRAM_BOT_TOKEN || '').trim();
    const chatId = String(env.MEOW_TELEGRAM_CHAT_ID || '').trim();
    const response = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`telegram sendMessage failed (${response.status})`);
    return { status: 'sent' };
  }

  return {
    configured: () => notificationConfigured(env),

    async notify({ event, severity = 'high', title = '', lines = [], dedupeKey = null, force = false }) {
      if (!notificationConfigured(env)) return { status: 'unconfigured', event };
      const key = dedupeKey || dedupeKeyFor([event, title]);
      const statePath = join(stateDir || resolveAlertStateDir(env), STATE_FILE);
      const state = readState(statePath);
      const last = Number(state[key] || 0);
      if (!force && last && now() - last < dedupeHours * 3_600_000) {
        return { status: 'deduped', event, dedupe_key: key };
      }
      const text = formatAlert({ event, severity, title, lines, hostname: env.HOSTNAME || env.HOST || 'local' });
      try {
        const result = await send(text);
        state[key] = now();
        writeState(statePath, state);
        logger.info('alert.sent', { event, dedupe_key: key });
        return { ...result, event, dedupe_key: key };
      } catch (error) {
        logger.warn('alert.failed', { event, dedupe_key: key, error });
        return { status: 'failed', event, dedupe_key: key, error: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}

let defaultNotifier = null;
export function notifier() {
  if (!defaultNotifier) defaultNotifier = createNotifier();
  return defaultNotifier;
}

export async function notify(alert) {
  return notifier().notify(alert);
}
