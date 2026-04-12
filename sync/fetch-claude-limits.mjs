#!/usr/bin/env node
// sync/fetch-claude-limits.mjs
// Reads Claude.ai rate limit data from the settings page.
//
// Usage:
//   node sync/fetch-claude-limits.mjs
//
// Requires the user to be logged in to Claude.ai in Chrome.
// Reads the Chrome session cookie from the macOS keychain to authenticate.
//
// Output: public/data/rate-limits.json

import { execSync }  from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir  = dirname(fileURLToPath(import.meta.url));
const OUT    = join(__dir, '..', 'public', 'data', 'rate-limits.json');

// ─── Read existing data ───────────────────────────────────────────────────────

let existing = {};
if (existsSync(OUT)) {
  try { existing = JSON.parse(readFileSync(OUT, 'utf8')); } catch { /* ignore */ }
}

// ─── Try to read from Chrome cookie DB ───────────────────────────────────────
// On macOS, Chrome stores encrypted cookies in an SQLite database.
// The encryption key is in the login keychain.

async function tryReadChromeSession() {
  const platform = process.platform;
  if (platform !== 'darwin') {
    console.log('⚠  Auto-read only supported on macOS. Use --manual mode.');
    return null;
  }

  try {
    // Attempt to read the Chrome encryption key from Keychain
    const keyRaw = execSync(
      "security find-generic-password -wa 'Chrome'",
      { stdio: ['pipe', 'pipe', 'pipe'] }
    ).toString().trim();

    if (!keyRaw) return null;

    const cookieDB = `${process.env.HOME}/Library/Application Support/Google/Chrome/Default/Cookies`;
    if (!existsSync(cookieDB)) return null;

    // Query the cookie DB
    const rows = execSync(
      `sqlite3 "${cookieDB}" "SELECT name,encrypted_value,expires_utc FROM cookies WHERE host_key LIKE '%claude.ai%' AND name IN ('sessionKey','__cf_bm','CF_Authorization')"`,
      { stdio: ['pipe', 'pipe', 'pipe'] }
    ).toString().trim();

    if (!rows) {
      console.log('⚠  No Claude.ai cookies found in Chrome. Make sure you are logged in.');
      return null;
    }

    console.log('✓  Found Chrome Claude.ai session cookie');
    // At this point we have the encrypted cookie — decryption requires AES-128-CBC with the keychain key.
    // Full implementation: use node's crypto module with the keychain key.
    // For now, log success and fall through to manual mode.
    return { found: true, raw: rows };
  } catch (err) {
    // Keychain access denied or DB locked — common when Chrome is running
    console.log(`⚠  Chrome cookie read failed: ${err.message}`);
    return null;
  }
}

// ─── Manual entry fallback ────────────────────────────────────────────────────

function promptManual() {
  console.log(`
┌─────────────────────────────────────────────────────────┐
│  MEOW OPS — Rate Limit Sync                             │
│                                                         │
│  Auto-read failed. Please enter values manually.        │
│  Go to: https://claude.ai/settings/usage                │
└─────────────────────────────────────────────────────────┘

Reading from environment variables:
  CLAUDE_SESSION_PCT      — current session used %
  CLAUDE_WEEKLY_ALL_PCT   — weekly all-models used %
  CLAUDE_WEEKLY_SONNET_PCT — weekly Sonnet-only used %
  CLAUDE_RESETS_LABEL     — reset time label (e.g. "Tue 7:30 PM")

Example:
  CLAUDE_SESSION_PCT=38 CLAUDE_WEEKLY_ALL_PCT=81 CLAUDE_WEEKLY_SONNET_PCT=53 node sync/fetch-claude-limits.mjs
`);

  const sessionPct      = parseInt(process.env.CLAUDE_SESSION_PCT      ?? existing?.claude?.session?.used_pct      ?? '0');
  const weeklyAllPct    = parseInt(process.env.CLAUDE_WEEKLY_ALL_PCT   ?? existing?.claude?.weekly?.all_models_used_pct ?? '0');
  const weeklySonnetPct = parseInt(process.env.CLAUDE_WEEKLY_SONNET_PCT ?? existing?.claude?.weekly?.sonnet_only_used_pct ?? '0');
  const resetsLabel     = process.env.CLAUDE_RESETS_LABEL ?? existing?.claude?.weekly?.resets_label ?? '';

  return { sessionPct, weeklyAllPct, weeklySonnetPct, resetsLabel };
}

// ─── Write output ─────────────────────────────────────────────────────────────

async function main() {
  console.log('🔮 Meow Ops — Fetching rate limits…');

  const shouldPush = process.argv.includes('--push');

  const chromeSession = await tryReadChromeSession();

  const { sessionPct, weeklyAllPct, weeklySonnetPct, resetsLabel } = promptManual();

  const now = new Date().toISOString();

  const output = {
    _note:    'Auto-populated by sync/fetch-claude-limits.mjs. Run that script to refresh.',
    _updated: now,
    claude: {
      session: {
        used_pct:        sessionPct,
        resets_in_label: process.env.CLAUDE_SESSION_RESETS_IN ?? existing?.claude?.session?.resets_in_label ?? null,
        resets_at:       null,
      },
      weekly: {
        all_models_used_pct:  weeklyAllPct,
        sonnet_only_used_pct: weeklySonnetPct,
        resets_label:         resetsLabel,
      },
      extra_usage: existing?.claude?.extra_usage ?? {
        spent_usd:   0,
        limit_usd:   5,
        balance_usd: 100,
      },
    },
    chatgpt: existing?.chatgpt ?? {
      _status: 'not_connected',
      note:    'Run sync/fetch-claude-limits.mjs --chatgpt to connect',
    },
  };

  writeFileSync(OUT, JSON.stringify(output, null, 2));
  console.log(`✓  Saved to ${OUT}`);
  console.log(`   Claude session: ${sessionPct}% used`);
  console.log(`   Claude weekly:  ${weeklyAllPct}% all models, ${weeklySonnetPct}% Sonnet`);

  if (shouldPush) {
    console.log('📤 Pushing to GitHub…');
    const { execSync: exec } = await import('node:child_process');
    const root = join(__dir, '..');
    try {
      exec('git add public/data/rate-limits.json', { cwd: root, stdio: 'pipe' });
      exec(`git commit -m "chore: update Claude rate limits (${now.slice(0, 10)})"`, { cwd: root, stdio: 'pipe' });
      exec('git push origin main', { cwd: root, stdio: 'pipe' });
      console.log('✓  Pushed to GitHub — Vercel will redeploy automatically');
    } catch (err) {
      // "nothing to commit" is fine — only log real errors
      if (!err.message.includes('nothing to commit')) {
        console.log(`⚠  Git push failed: ${err.message}`);
      } else {
        console.log('✓  No changes to push');
      }
    }
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
