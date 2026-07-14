#!/usr/bin/env node
// sync/fetch-claude-limits.mjs
// Refreshes the local rate-limit snapshot from explicit environment values.
//
// Usage:
//   node sync/fetch-claude-limits.mjs
//
// Output: public/data/rate-limits.json

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir  = dirname(fileURLToPath(import.meta.url));
const OUT    = process.env.MEOW_RATE_LIMITS_OUT || join(__dir, '..', 'public', 'data', 'rate-limits.json');

// ─── Read existing data ───────────────────────────────────────────────────────

let existing = {};
if (existsSync(OUT)) {
  try { existing = JSON.parse(readFileSync(OUT, 'utf8')); } catch { /* ignore */ }
}

// ─── Explicit local values ───────────────────────────────────────────────────

function percent(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  return Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : fallback;
}

function promptManual() {
  console.log(`
┌─────────────────────────────────────────────────────────┐
│  MEOW OPS — Rate Limit Sync                             │
│                                                         │
│  Refreshing from explicit local values.                 │
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

  const sessionPct      = percent(process.env.CLAUDE_SESSION_PCT, existing?.claude?.session?.used_pct ?? 0);
  const weeklyAllPct    = percent(process.env.CLAUDE_WEEKLY_ALL_PCT, existing?.claude?.weekly?.all_models_used_pct ?? 0);
  const weeklySonnetPct = percent(process.env.CLAUDE_WEEKLY_SONNET_PCT, existing?.claude?.weekly?.sonnet_only_used_pct ?? 0);
  const resetsLabel     = process.env.CLAUDE_RESETS_LABEL ?? existing?.claude?.weekly?.resets_label ?? '';

  // Codex limits (CODEX_WEEKLY_REMAINING_PCT = % remaining shown in Codex UI)
  const codexWeeklyRemainingPct = process.env.CODEX_WEEKLY_REMAINING_PCT != null
    ? percent(process.env.CODEX_WEEKLY_REMAINING_PCT)
    : existing?.codex?.weekly?.remaining_pct ?? null;
  const codexResetsLabel = process.env.CODEX_RESETS_LABEL ?? existing?.codex?.weekly?.resets_label ?? null;

  return { sessionPct, weeklyAllPct, weeklySonnetPct, resetsLabel, codexWeeklyRemainingPct, codexResetsLabel };
}

// ─── Write output ─────────────────────────────────────────────────────────────

async function main() {
  console.log('🔮 Meow Ops — Fetching rate limits…');

  const shouldPush = process.argv.includes('--push');

  const { sessionPct, weeklyAllPct, weeklySonnetPct, resetsLabel, codexWeeklyRemainingPct, codexResetsLabel } = promptManual();

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
    codex: {
      weekly: codexWeeklyRemainingPct != null ? {
        remaining_pct: codexWeeklyRemainingPct,
        resets_label:  codexResetsLabel,
      } : (existing?.codex?.weekly ?? null),
    },
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(output, null, 2));
  console.log(`✓  Saved to ${OUT}`);
  console.log(`   Claude session: ${sessionPct}% used`);
  console.log(`   Claude weekly:  ${weeklyAllPct}% all models, ${weeklySonnetPct}% Sonnet`);

  if (shouldPush) {
    console.log('⚠  --push is retired: rate-limit data remains local and was not committed.');
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
