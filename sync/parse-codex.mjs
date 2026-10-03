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

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { calculateCostDetailed } from './cost-calculator.mjs';
import { createSession, makeSnippet, snippetize, snippetsDisabled } from './session-utils.mjs';
import { readJsonlWithCheckpoint } from './incremental-jsonl.mjs';

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

function loadSessionIndex(codexDir, onCoverage) {
  const indexPath = join(codexDir, '..', 'session_index.jsonl');
  const out = new Map();
  if (!existsSync(indexPath)) return out;

  let lines;
  try { lines = readFileSync(indexPath, 'utf8').split('\n').filter(Boolean); }
  catch {
    onCoverage?.({ mode: 'failed', stage: 'session-index', bytesRead: 0, parsedBytes: 0 });
    return out;
  }
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
function* walkCodexFiles(dir, onCoverage) {
  if (!existsSync(dir)) return;
  const list = path => {
    try { return readdirSync(path, { withFileTypes: true }); }
    catch {
      onCoverage?.({ mode: 'failed', stage: 'discovery', bytesRead: 0, parsedBytes: 0 });
      return [];
    }
  };
  for (const year of list(dir)) {
    const yearPath = join(dir, year.name);
    if (!year.isDirectory() || !/^\d{4}$/.test(year.name)) continue;
    for (const month of list(yearPath)) {
      const monthPath = join(yearPath, month.name);
      if (!month.isDirectory()) continue;
      for (const day of list(monthPath)) {
        const dayPath = join(monthPath, day.name);
        if (!day.isDirectory()) continue;
        for (const file of list(dayPath)) {
          if (file.isFile() && file.name.endsWith('.jsonl') && file.name.startsWith('rollout-')) {
            yield join(dayPath, file.name);
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

function createCodexState(filePath) {
  const session = createSession({
    project: 'codex',
    source: 'codex',
    entrypoint: 'codex-desktop',
    // Codex sessions are always "architect" — plan-heavy agentic tasks
    cat_type: 'architect',
    raw_ref: filePath,
  });

  // Last non-null token_count info wins (cumulative totals at turn end).
  return {
    session, lastTokenUsage: null, seenToolCalls: new Set(),
    responseUserMessages: 0, responseAssistantMessages: 0, observedModels: new Set(),
  };
}

function consumeCodexEntry(state, entry) {
    const { session, seenToolCalls, observedModels } = state;

    const ts = entry.timestamp;
    if (entry.type === 'turn_context' && typeof entry.payload?.model === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,149}$/.test(entry.payload.model)) {
      observedModels.add(entry.payload.model);
    }
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
        state.lastTokenUsage = p.info.total_token_usage;
      }
    }

    if (entry.type === 'response_item') {
      const p = entry.payload || {};
      if (p.type === 'message' && ['user', 'assistant'].includes(p.role)) {
        if (p.role === 'user') state.responseUserMessages++;
        else state.responseAssistantMessages++;
      }
      const toolName = toolNameFromResponseItem(p);
      if (!toolName) return;

      // `call_id` is stable across call + output records and lets us avoid
      // double-counting when streams include retries/replays.
      const callId = typeof p.call_id === 'string' && p.call_id ? p.call_id : null;
      if (callId) {
        if (seenToolCalls.has(callId)) return;
        seenToolCalls.add(callId);
      }
      session.tools[toolName] = (session.tools[toolName] || 0) + 1;
    }
}

function finishCodexState(state) {
  const session = structuredClone(state.session);
  const { lastTokenUsage, responseUserMessages, responseAssistantMessages, observedModels } = state;
  if (!session.started_at) return null;

  // New Desktop logs store message records without legacy message events.
  // Use one representation so logs containing both are not double-counted.
  if (responseUserMessages + responseAssistantMessages > 0) {
    session.user_message_count = Math.max(session.user_message_count, responseUserMessages);
    session.assistant_message_count = Math.max(session.assistant_message_count, responseAssistantMessages);
    session.message_count = session.user_message_count + session.assistant_message_count;
  }

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

  if (observedModels.size === 1) {
    session.model = [...observedModels][0];
  } else if (observedModels.size > 1) {
    // Cumulative session tokens cannot all be assigned to one model after a switch.
    session.model = null;
  }
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

export function parseCodexFile(filePath, options = {}) {
  return readJsonlWithCheckpoint(filePath, {
    ...options,
    version: `codex-v2:snippets-${snippetsDisabled() ? 'off' : 'on'}`,
    createState: () => createCodexState(filePath),
    reduceEntry: consumeCodexEntry,
    finish: finishCodexState,
    hydrate: value => {
      if (!value?.session || !Array.isArray(value.seenToolCalls) || !Array.isArray(value.observedModels)) throw new Error('Invalid checkpoint state.');
      return { ...value, seenToolCalls: new Set(value.seenToolCalls), observedModels: new Set(value.observedModels) };
    },
    dehydrate: value => ({ ...value, seenToolCalls: [...value.seenToolCalls], observedModels: [...value.observedModels] }),
  });
}

export function scanCodexSessions(codexDir, options = {}) {
  const sessions = [];
  const titleById = loadSessionIndex(codexDir, options.onCoverage);
  for (const filePath of walkCodexFiles(codexDir, options.onCoverage)) {
    try {
      const s = parseCodexFile(filePath, options);
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
      // The parser reports a sanitized stage through onCoverage before throwing.
    }
  }
  return sessions;
}
