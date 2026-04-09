// Parse Codex Desktop session JSONL files into the same schema as Claude sessions.
//
// Codex Desktop stores sessions at:
//   ~/.codex/sessions/YYYY/MM/DD/rollout-<timestamp>-<uuid>.jsonl
//
// Each file is one "rollout" (a single turn/task). Lines contain:
//   { type: "session_meta", payload: { id, cwd, timestamp, model_provider, ... } }
//   { type: "event_msg",    payload: { type: "user_message", ... } }
//   { type: "event_msg",    payload: { type: "agent_message", ... } }
//   { type: "event_msg",    payload: { type: "token_count", info: { total_token_usage: {...} } } }
//   { type: "response_item", ... }
//   { type: "turn_context",  ... }

import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';
import { calculateCost } from './cost-calculator.mjs';

// Walk the year/month/day directory tree under codexDir, yield all rollout JSONL paths.
function* walkCodexFiles(dir) {
  if (!existsSync(dir)) return;
  for (const year of readdirSync(dir)) {
    const yearPath = join(dir, year);
    if (!statSync(yearPath).isDirectory() || !/^\d{4}$/.test(year)) continue;
    for (const month of readdirSync(yearPath)) {
      const monthPath = join(yearPath, month);
      if (!statSync(monthPath).isDirectory()) continue;
      for (const day of readdirSync(monthPath)) {
        const dayPath = join(monthPath, day);
        if (!statSync(dayPath).isDirectory()) continue;
        for (const file of readdirSync(dayPath)) {
          if (file.endsWith('.jsonl') && file.startsWith('rollout-')) {
            yield join(dayPath, file);
          }
        }
      }
    }
  }
}

// Derive a readable project name from cwd.
function projectFromCwd(cwd) {
  if (!cwd) return 'codex';
  const parts = cwd.split('/').filter(Boolean);
  if (!parts.length) return 'codex';
  const last = parts[parts.length - 1];
  // Strip trailing parens suffix e.g. "My Project (MP)" → "MP"
  const paren = last.match(/\(([^)]+)\)$/);
  return paren ? paren[1] : last;
}

// Infer the model from the session_meta base_instructions text.
function inferModel(baseText = '') {
  if (/GPT-5/i.test(baseText)) return 'gpt-5';
  if (/GPT-4o mini/i.test(baseText)) return 'gpt-4o-mini';
  if (/GPT-4o/i.test(baseText)) return 'gpt-4o';
  if (/o4-mini/i.test(baseText)) return 'o4-mini';
  if (/o3/i.test(baseText)) return 'o3';
  return null;
}

export function parseCodexFile(filePath) {
  const content = readFileSync(filePath, 'utf8');
  const lines = content.split('\n').filter(Boolean);

  const session = {
    session_id: null,
    project: 'codex',
    source: 'codex',
    cwd: null,
    model: null,
    entrypoint: 'codex-desktop',
    git_branch: null,
    version: null,
    started_at: null,
    ended_at: null,
    duration_seconds: 0,
    message_count: 0,
    user_message_count: 0,
    assistant_message_count: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_tokens: 0,
    cache_read_tokens: 0,
    total_tokens: 0,
    estimated_cost_usd: 0,
    // Codex sessions are always "architect" — plan-heavy agentic tasks
    cat_type: 'architect',
    is_ghost: false,
    tools: {},
  };

  // Last non-null token_count info wins (cumulative totals at turn end).
  let lastTokenUsage = null;

  for (const line of lines) {
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }

    const ts = entry.timestamp;
    if (ts) {
      if (!session.started_at || ts < session.started_at) session.started_at = ts;
      if (!session.ended_at   || ts > session.ended_at)   session.ended_at   = ts;
    }

    if (entry.type === 'session_meta') {
      const p = entry.payload || {};
      if (!session.session_id && p.id) session.session_id = p.id;
      if (!session.cwd && p.cwd)       session.cwd        = p.cwd;
      const baseText = p.base_instructions?.text || '';
      if (!session.model) session.model = inferModel(baseText);
    }

    if (entry.type === 'event_msg') {
      const p = entry.payload || {};
      if (p.type === 'user_message') {
        session.user_message_count++;
        session.message_count++;
      }
      if (p.type === 'agent_message') {
        session.assistant_message_count++;
        session.message_count++;
      }
      if (p.type === 'token_count' && p.info?.total_token_usage) {
        lastTokenUsage = p.info.total_token_usage;
      }
    }
  }

  if (!session.started_at) return null;

  // Apply cumulative token totals from the last token_count event.
  if (lastTokenUsage) {
    session.input_tokens     = lastTokenUsage.input_tokens            || 0;
    session.cache_read_tokens = lastTokenUsage.cached_input_tokens    || 0;
    session.output_tokens    = lastTokenUsage.output_tokens           || 0;
    session.total_tokens     = lastTokenUsage.total_tokens
      || session.input_tokens + session.output_tokens;
  }

  session.model = session.model || 'gpt-4o';
  session.project = projectFromCwd(session.cwd);

  session.estimated_cost_usd = calculateCost(
    session.model,
    session.input_tokens,
    session.output_tokens,
    session.cache_creation_tokens,
    session.cache_read_tokens,
  );

  session.is_ghost = session.message_count < 2;

  if (session.started_at && session.ended_at) {
    session.duration_seconds = Math.floor(
      (new Date(session.ended_at) - new Date(session.started_at)) / 1000,
    );
  }

  return session;
}

export function scanCodexSessions(codexDir) {
  const sessions = [];
  for (const filePath of walkCodexFiles(codexDir)) {
    try {
      const s = parseCodexFile(filePath);
      if (!s) continue;
      // Use rollout UUID from filename for a stable, unique session_id.
      const uuidMatch = filePath.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/);
      if (uuidMatch) s.session_id = `codex-${uuidMatch[1]}`;
      sessions.push(s);
    } catch {
      // Skip unreadable files silently.
    }
  }
  return sessions;
}
