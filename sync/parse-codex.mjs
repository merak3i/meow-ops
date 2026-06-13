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
import { calculateCostDetailed } from './cost-calculator.mjs';
import { createSession, makeSnippet, snippetize, snippetsDisabled } from './session-utils.mjs';

function extractTextDeep(value, depth = 0) {
  if (!value || depth > 4) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map((item) => extractTextDeep(item, depth + 1)).filter(Boolean).join(' ');
  }
  if (typeof value !== 'object') return '';

  for (const key of ['text', 'input_text', 'content', 'message', 'value']) {
    if (value[key]) {
      const text = extractTextDeep(value[key], depth + 1);
      if (text) return text;
    }
  }
  return '';
}

function loadSessionIndex(codexDir) {
  const indexPath = join(codexDir, '..', 'session_index.jsonl');
  const out = new Map();
  if (!existsSync(indexPath)) return out;

  const lines = readFileSync(indexPath, 'utf8').split('\n').filter(Boolean);
  for (const line of lines) {
    try {
      const row = JSON.parse(line);
      if (row.id && row.thread_name) out.set(row.id, snippetize(row.thread_name, 100));
    } catch {
      // Ignore malformed historical rows.
    }
  }
  return out;
}

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

function toolNameFromResponseItem(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const t = payload.type;
  if (t === 'function_call' || t === 'custom_tool_call') {
    return typeof payload.name === 'string' && payload.name ? payload.name : null;
  }
  if (t === 'web_search_call' || t === 'tool_search_call' || t === 'image_generation_call') {
    return t;
  }
  return null;
}

export function parseCodexFile(filePath) {
  const content = readFileSync(filePath, 'utf8');
  const lines = content.split('\n').filter(Boolean);

  const session = createSession({
    project: 'codex',
    source: 'codex',
    entrypoint: 'codex-desktop',
    // Codex sessions are always "architect" — plan-heavy agentic tasks
    cat_type: 'architect',
  });

  // Last non-null token_count info wins (cumulative totals at turn end).
  let lastTokenUsage = null;
  const seenToolCalls = new Set();

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
        if (!session.first_user_message) {
          const snippet = makeSnippet(extractTextDeep(p));
          if (snippet) session.first_user_message = snippet;
        }
      }
      if (p.type === 'agent_message') {
        session.assistant_message_count++;
        session.message_count++;
      }
      if (p.type === 'token_count' && p.info?.total_token_usage) {
        lastTokenUsage = p.info.total_token_usage;
      }
    }

    if (entry.type === 'response_item') {
      const p = entry.payload || {};
      const toolName = toolNameFromResponseItem(p);
      if (!toolName) continue;

      // `call_id` is stable across call + output records and lets us avoid
      // double-counting when streams include retries/replays.
      const callId = typeof p.call_id === 'string' && p.call_id ? p.call_id : null;
      if (callId) {
        if (seenToolCalls.has(callId)) continue;
        seenToolCalls.add(callId);
      }
      session.tools[toolName] = (session.tools[toolName] || 0) + 1;
    }
  }

  if (!session.started_at) return null;

  // Apply cumulative token totals from the last token_count event.
  // OpenAI's `input_tokens` is INCLUSIVE of cached input tokens, so splitting
  // out the cached subset (priced at the cheaper cache-read rate) and keeping
  // only the non-cached remainder as `input_tokens` avoids both double-counting
  // the total AND double-charging the cached tokens.
  if (lastTokenUsage) {
    const totalInput = Math.max(0, lastTokenUsage.input_tokens || 0);
    const cached     = Math.max(0, lastTokenUsage.cached_input_tokens || 0);
    session.cache_read_tokens = Math.min(cached, totalInput);
    session.input_tokens      = totalInput - session.cache_read_tokens;
    session.output_tokens     = Math.max(0, lastTokenUsage.output_tokens || 0);
    session.total_tokens      = session.input_tokens + session.output_tokens
      + session.cache_creation_tokens + session.cache_read_tokens;
  }

  session.model = session.model || 'gpt-4o';
  session.project = projectFromCwd(session.cwd);

  const priced = calculateCostDetailed(
    session.model,
    session.input_tokens,
    session.output_tokens,
    session.cache_creation_tokens,
    session.cache_read_tokens,
  );
  session.estimated_cost_usd = priced.cost;
  session.pricing_source = priced.pricingSource;

  session.is_ghost = session.message_count < 2;

  if (session.started_at && session.ended_at) {
    session.duration_seconds = Math.max(0, Math.floor(
      (new Date(session.ended_at) - new Date(session.started_at)) / 1000,
    ));
  }

  return session;
}

export function scanCodexSessions(codexDir) {
  const sessions = [];
  const titleById = loadSessionIndex(codexDir);
  for (const filePath of walkCodexFiles(codexDir)) {
    try {
      const s = parseCodexFile(filePath);
      if (!s) continue;
      // Use rollout UUID from filename for a stable, unique session_id.
      const uuidMatch = filePath.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/);
      const noSnip = snippetsDisabled();
      if (uuidMatch) {
        const id = uuidMatch[1];
        s.session_id = `codex-${id}`;
        s.session_title = noSnip ? null : (titleById.get(id) || s.first_user_message || null);
      } else if (s.session_id) {
        s.session_title = noSnip ? null : (titleById.get(s.session_id) || s.first_user_message || null);
      }
      sessions.push(s);
    } catch {
      // Skip unreadable files silently.
    }
  }
  return sessions;
}
