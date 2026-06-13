// parse-cursor.mjs — Cursor IDE session log parser (stub).
//
// Cursor stores workspace logs at:
//   ~/.cursor/logs/<workspace-id>/window1/exthost/anysphere.cursor-always-local/...
//   ~/.cursor/workspaceStorage/<hash>/logs/...
//
// Strategy (when fully implemented):
//   1. Find all *.log files containing "APIRequest" or "chat" events
//   2. Parse token counts from the cost lines Cursor emits per request
//   3. Infer model from log metadata (default: gpt-4o for Cursor Pro)
//   4. Produce Session objects compatible with sessions.json
//
// This stub returns an empty array but is wired into export-local.mjs
// so the scaffolding is ready when full parsing is added.

import { existsSync, readdirSync, statSync, readFileSync } from 'fs';
import { join } from 'path';
import { calculateCostDetailed } from './cost-calculator.mjs';
import { createSession, makeSnippet } from './session-utils.mjs';

const DEFAULT_MODEL = 'gpt-4o';

export function scanCursorSessions(cursorLogsDir) {
  if (!existsSync(cursorLogsDir)) return [];

  const sessions = [];

  function walk(dir) {
    let entries;
    try { entries = readdirSync(dir); } catch { return; }

    for (const entry of entries) {
      const full = join(dir, entry);
      let stat;
      try { stat = statSync(full); } catch { continue; }

      if (stat.isDirectory()) {
        walk(full);
      } else if (entry.endsWith('.log')) {
        try {
          const content = readFileSync(full, 'utf8');
          const parsed  = parseCursorLog(content, full, stat);
          if (parsed) sessions.push(parsed);
        } catch {
          // Skip unreadable log files
        }
      }
    }
  }

  walk(cursorLogsDir);
  return sessions;
}

function parseCursorLog(content, filePath, stat) {
  // Look for token usage patterns in Cursor log format.
  // Cursor emits lines like: "Total tokens: 12345 (prompt: 8000, completion: 4345)"
  const tokenMatch = content.match(/Total tokens:\s*(\d+)/i);
  if (!tokenMatch) return null;

  const totalTokens = parseInt(tokenMatch[1], 10);
  if (isNaN(totalTokens) || totalTokens <= 0) return null;

  // Estimate input/output split (Cursor doesn't always separate them).
  // Clamp everything: a garbled line (prompt > total, missing completion)
  // must never produce a negative output count that poisons the cost sums.
  const promptMatch     = content.match(/prompt:\s*(\d+)/i);
  const completionMatch = content.match(/completion:\s*(\d+)/i);
  const rawInput   = promptMatch ? parseInt(promptMatch[1], 10) : Math.floor(totalTokens * 0.7);
  const inputTokens = Math.min(Math.max(0, Number.isFinite(rawInput) ? rawInput : 0), totalTokens);
  const rawOutput  = completionMatch ? parseInt(completionMatch[1], 10) : totalTokens - inputTokens;
  const outputTokens = Math.max(0, Number.isFinite(rawOutput) ? rawOutput : 0);

  // Try to detect model
  const modelMatch = content.match(/model['":\s]+([a-z0-9._-]{4,40})/i);
  const model      = modelMatch ? modelMatch[1] : DEFAULT_MODEL;
  const title = makeSnippet(
    content.match(/(?:title|name|summary)['":\s]+([^"\n]{6,160})/i)?.[1]
    || content.match(/(?:user|prompt|message)['":\s]+([^"\n]{6,160})/i)?.[1]
    || '',
  );

  const mtime = stat.mtime.toISOString();
  const priced = calculateCostDetailed(model, inputTokens, outputTokens, 0, 0);

  return createSession({
    session_id:            `cursor-${stat.ino || 'x'}-${Math.round(stat.mtimeMs || 0)}`,
    source:                'cursor',
    project:               deriveProjectFromPath(filePath),
    model,
    entrypoint:            'cursor',
    started_at:            mtime,
    ended_at:              mtime,
    message_count:         1,
    user_message_count:    1,
    assistant_message_count: 1,
    input_tokens:          inputTokens,
    output_tokens:         outputTokens,
    total_tokens:          inputTokens + outputTokens,
    estimated_cost_usd:    priced.cost,
    pricing_source:        priced.pricingSource,
    cat_type:              'architect',   // Cursor usage is plan-heavy by nature
    session_title:         title || null,
    first_user_message:    title || null,
  });
}

function deriveProjectFromPath(filePath) {
  const parts = filePath.split('/').filter(Boolean);
  // Find "workspaceStorage" or "logs" parent, use the next segment as ID
  const idx = parts.findIndex((p) => p === 'workspaceStorage' || p === 'logs');
  if (idx >= 0 && parts[idx + 1]) return `cursor/${parts[idx + 1].slice(0, 8)}`;
  return 'cursor';
}
