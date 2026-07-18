// Hermes Agent session parser.
//
// Hermes stores durable local session state in ~/.hermes/state.db. Unlike the
// plaintext transcript adapters, this parser reads the documented sessions and
// messages tables through sqlite3 and maps only fields that are actually
// present. The database remains read-only.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { calculateCostDetailed } from './cost-calculator.mjs';
import { createSession, makeSnippet, projectFromCwd } from './session-utils.mjs';

export const DEFAULT_HERMES_DB = join(homedir(), '.hermes', 'state.db');

const TOOL_MAP = {
  terminal: 'Bash',
  terminal_exec: 'Bash',
  run_command: 'Bash',
  read_file: 'Read',
  file_read: 'Read',
  write_file: 'Write',
  file_write: 'Write',
  edit_file: 'Edit',
  search_files: 'Grep',
  web_search: 'WebSearch',
  web_fetch: 'WebFetch',
};

function iso(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const milliseconds = number < 1e12 ? number * 1000 : number;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function count(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function normalizeTool(name) {
  const raw = String(name || '').trim();
  return TOOL_MAP[raw.toLowerCase()] || raw || null;
}

function queryJson(dbPath, sql) {
  const output = execFileSync('sqlite3', ['-readonly', '-json', dbPath, sql], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  return output ? JSON.parse(output) : [];
}

export function parseHermesRows(sessionRows = [], toolRows = [], messageRows = []) {
  const toolsBySession = new Map();
  for (const row of Array.isArray(toolRows) ? toolRows : []) {
    const name = normalizeTool(row.tool_name);
    if (!name || !row.session_id) continue;
    const tools = toolsBySession.get(row.session_id) || {};
    tools[name] = (tools[name] || 0) + count(row.calls || 1);
    toolsBySession.set(row.session_id, tools);
  }
  const rolesBySession = new Map();
  for (const row of Array.isArray(messageRows) ? messageRows : []) {
    if (!row.session_id) continue;
    const roles = rolesBySession.get(row.session_id) || {};
    roles[row.role] = (roles[row.role] || 0) + count(row.messages || 1);
    rolesBySession.set(row.session_id, roles);
  }

  return (Array.isArray(sessionRows) ? sessionRows : []).map((row) => {
    const input = count(row.input_tokens);
    const output = count(row.output_tokens);
    const cacheRead = count(row.cache_read_tokens);
    const cacheWrite = count(row.cache_write_tokens);
    const hasUsage = row.model != null
      || row.input_tokens != null
      || row.output_tokens != null
      || row.estimated_cost_usd != null
      || row.actual_cost_usd != null;
    const model = row.model ? String(row.model) : null;
    const priced = model && (input + output + cacheRead + cacheWrite > 0)
      ? calculateCostDetailed(model, input, output, cacheWrite, cacheRead)
      : { cost: 0, pricingSource: hasUsage ? 'none' : 'unavailable' };
    const startedAt = iso(row.started_at);
    const endedAt = iso(row.ended_at) || startedAt;
    const roles = rolesBySession.get(row.id) || {};
    const root = row.git_repo_root || row.cwd || null;
    const title = makeSnippet(row.title || row.display_name || '');
    const actualCost = Number(row.actual_cost_usd);
    const estimatedCost = Number(row.estimated_cost_usd);
    const cost = Number.isFinite(actualCost)
      ? actualCost
      : Number.isFinite(estimatedCost) ? estimatedCost : priced.cost;

    return createSession({
      session_id: String(row.id),
      source: 'hermes',
      project: projectFromCwd(root) || 'hermes',
      cwd: row.cwd || row.git_repo_root || null,
      model,
      entrypoint: row.source ? `hermes-${row.source}` : 'hermes',
      git_branch: row.git_branch || null,
      started_at: startedAt,
      ended_at: endedAt,
      duration_seconds: startedAt && endedAt
        ? Math.max(0, Math.floor((Date.parse(endedAt) - Date.parse(startedAt)) / 1000))
        : 0,
      message_count: count(row.message_count),
      user_message_count: count(roles.user),
      assistant_message_count: count(roles.assistant),
      input_tokens: input,
      output_tokens: output,
      cache_creation_tokens: cacheWrite,
      cache_read_tokens: cacheRead,
      total_tokens: input + output + cacheRead + cacheWrite,
      estimated_cost_usd: Number.isFinite(cost) ? cost : 0,
      usage_available: hasUsage,
      pricing_source: row.cost_source || priced.pricingSource,
      tools: toolsBySession.get(row.id) || {},
      session_title: title || null,
      first_user_message: null,
      parent_session_id: row.parent_session_id || null,
      is_subagent: Boolean(row.parent_session_id),
      agent_depth: row.parent_session_id ? 1 : 0,
      cat_type: row.tool_call_count > 0 ? 'architect' : 'ghost',
      is_ghost: count(row.message_count) < 2,
      archived: Boolean(row.archived),
    });
  });
}

export function parseHermesMessageEvidenceRows(rows = [], dbPath = DEFAULT_HERMES_DB) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const root = row.git_repo_root || row.cwd || null;
    const role = String(row.role || 'unknown').toLowerCase().replace(/[^a-z0-9_-]+/g, '_');
    const toolCalls = row.tool_calls ? String(row.tool_calls) : null;
    const content = String(row.content || '').trim()
      || (row.tool_name ? `Tool call: ${row.tool_name}` : '')
      || (toolCalls ? 'Structured tool call' : 'Hermes message');
    return {
      source: 'hermes',
      project: projectFromCwd(root) || 'hermes',
      session_id: String(row.session_id),
      parent_session_id: row.parent_session_id || null,
      timestamp: iso(row.timestamp) || iso(row.started_at),
      event_type: `message_${role}`,
      actor: role,
      content,
      raw_ref: `${dbPath}#messages:${row.id}`,
      sensitivity: 'private',
      metadata: {
        message_id: row.id,
        tool_name: normalizeTool(row.tool_name),
        tool_call_id: row.tool_call_id || null,
        tool_calls: toolCalls,
        effect_disposition: row.effect_disposition || null,
        finish_reason: row.finish_reason || null,
        token_count: count(row.token_count),
        observed: Boolean(row.observed),
        compacted: Boolean(row.compacted),
      },
    };
  }).filter((row) => row.timestamp);
}

export function scanHermesSessions(dbPath = process.env.HERMES_STATE_DB || DEFAULT_HERMES_DB) {
  if (!dbPath || !existsSync(dbPath)) return [];
  try {
    const sessions = queryJson(dbPath, `
      SELECT id, source, display_name, model, parent_session_id, started_at, ended_at,
             message_count, tool_call_count, input_tokens, output_tokens,
             cache_read_tokens, cache_write_tokens, cwd, git_branch, git_repo_root,
             title, estimated_cost_usd, actual_cost_usd, cost_source, archived
      FROM sessions
      ORDER BY started_at DESC
    `);
    const tools = queryJson(dbPath, `
      SELECT session_id, tool_name, COUNT(*) AS calls
      FROM messages
      WHERE active = 1 AND tool_name IS NOT NULL AND tool_name != ''
      GROUP BY session_id, tool_name
    `);
    const roles = queryJson(dbPath, `
      SELECT session_id, role, COUNT(*) AS messages
      FROM messages
      WHERE active = 1 AND role IN ('user', 'assistant')
      GROUP BY session_id, role
    `);
    return parseHermesRows(sessions, tools, roles).map((session) => ({
      ...session,
      raw_ref: dbPath,
    }));
  } catch (error) {
    console.warn(`  Hermes sessions unavailable: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

export function scanHermesMessageEvidence(dbPath = process.env.HERMES_STATE_DB || DEFAULT_HERMES_DB) {
  if (!dbPath || !existsSync(dbPath)) return [];
  try {
    const rows = queryJson(dbPath, `
      SELECT messages.id, messages.session_id, messages.role, messages.content,
             messages.tool_call_id, messages.tool_calls, messages.tool_name,
             messages.effect_disposition, messages.timestamp, messages.token_count,
             messages.finish_reason, messages.observed, messages.compacted,
             sessions.parent_session_id, sessions.started_at, sessions.cwd,
             sessions.git_repo_root
      FROM messages
      JOIN sessions ON sessions.id = messages.session_id
      WHERE messages.active = 1
      ORDER BY messages.timestamp ASC, messages.id ASC
    `);
    return parseHermesMessageEvidenceRows(rows, dbPath);
  } catch (error) {
    console.warn(`  Hermes message evidence unavailable: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}
