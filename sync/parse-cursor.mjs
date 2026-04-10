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
import { calculateCost } from './cost-calculator.mjs';

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
  if (isNaN(totalTokens) || totalTokens === 0) return null;

  // Estimate input/output split (Cursor doesn't always separate them)
  const promptMatch     = content.match(/prompt:\s*(\d+)/i);
  const completionMatch = content.match(/completion:\s*(\d+)/i);
  const inputTokens     = promptMatch     ? parseInt(promptMatch[1], 10)     : Math.floor(totalTokens * 0.7);
  const outputTokens    = completionMatch ? parseInt(completionMatch[1], 10) : totalTokens - inputTokens;

  // Try to detect model
  const modelMatch = content.match(/model['":\s]+([a-z0-9._-]{4,40})/i);
  const model      = modelMatch ? modelMatch[1] : DEFAULT_MODEL;

  const sessionId = `cursor-${stat.ino || Date.now()}`;
  const mtime     = stat.mtime.toISOString();

  return {
    session_id:            sessionId,
    project:               deriveProjectFromPath(filePath),
    model,
    entrypoint:            'cursor',
    git_branch:            null,
    started_at:            mtime,
    ended_at:              mtime,
    duration_seconds:      0,
    message_count:         1,
    user_message_count:    1,
    assistant_message_count: 1,
    input_tokens:          inputTokens,
    output_tokens:         outputTokens,
    cache_creation_tokens: 0,
    cache_read_tokens:     0,
    total_tokens:          totalTokens,
    estimated_cost_usd:    calculateCost(model, inputTokens, outputTokens, 0, 0),
    cat_type:              'architect',   // Cursor usage is plan-heavy by nature
    is_ghost:              false,
    source:                'cursor',
    tools:                 {},
  };
}

function deriveProjectFromPath(filePath) {
  const parts = filePath.split('/').filter(Boolean);
  // Find "workspaceStorage" or "logs" parent, use the next segment as ID
  const idx = parts.findIndex((p) => p === 'workspaceStorage' || p === 'logs');
  if (idx >= 0 && parts[idx + 1]) return `cursor/${parts[idx + 1].slice(0, 8)}`;
  return 'cursor';
}
