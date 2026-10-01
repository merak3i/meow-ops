// parse-antigravity.mjs — Google Antigravity (agentic IDE) session parser.
//
// Antigravity stores one "brain" per agent session at:
//   ~/.gemini/antigravity/brain/<uuid>/.system_generated/logs/transcript.jsonl
//
// Each transcript line is one step:
//   { step_index, source, type, status, created_at, content, tool_calls?, thinking?, error? }
//     source: "USER_EXPLICIT" | "MODEL"
//     type:   USER_INPUT | PLANNER_RESPONSE | VIEW_FILE | RUN_COMMAND | FIND |
//             GREP_SEARCH | LIST_DIRECTORY | SEARCH_WEB | CODE_ACTION | ...
//     tool_calls: [{ name: "view_file" | "run_command" | ..., args: { AbsolutePath, ... } }]
//
// SQLite conversation stores also contain step metadata. Recover missing
// JSONL steps from conversations/<uuid>.db through a read-only query.
// Token/model/cost and binary .pb payloads are not decoded by this adapter.
//
// We therefore record real TIME, TOOLS, PROJECT, and step counts, and mark
// usage_available=false so the dashboard shows "not exposed by Antigravity"
// rather than a fabricated $0 / 0 tokens. No estimation, by design.

import { existsSync, readdirSync, statSync, readFileSync } from 'fs';
import { join } from 'path';
import { createSession, makeSnippet, projectFromCwd } from './session-utils.mjs';
import { readAntigravityDatabase } from './antigravity-database.mjs';

export const DEFAULT_ANTIGRAVITY_DIR = process.env.HOME
  ? join(process.env.HOME, '.gemini', 'antigravity')
  : null;

// Map Antigravity's tool/step vocabulary onto the canonical (Claude-style)
// tool buckets the rest of the app understands, so cat-type classification and
// the "By Action" view stay coherent across sources. Unknown names pass through.
const TOOL_MAP = {
  view_file: 'Read',
  read_file: 'Read',
  open_file: 'Read',
  grep_search: 'Grep',
  find: 'Glob',
  glob: 'Glob',
  list_directory: 'LS',
  list_dir: 'LS',
  run_command: 'Bash',
  run_terminal_command: 'Bash',
  code_action: 'Edit',
  edit_file: 'Edit',
  replace_file_content: 'Edit',
  write_file: 'Write',
  write_to_file: 'Write',
  create_file: 'Write',
  find_by_name: 'Glob',
  search_web: 'WebSearch',
  browser_navigate: 'WebFetch',
  view_web_document: 'WebFetch',
};

function normalizeTool(name) {
  if (!name || typeof name !== 'string') return null;
  return TOOL_MAP[name] || name;
}

// USER_INPUT content is wrapped like "<USER_REQUEST>\n...\n</USER_REQUEST>".
function stripUserRequest(text) {
  return String(text || '')
    .replace(/<\/?USER_REQUEST>/g, ' ')
    .replace(/<[^>]+>/g, ' ');
}

const STEP_TOOLS = {
  CODE_ACTION: 'code_action', GREP_SEARCH: 'grep_search', VIEW_FILE: 'view_file',
  LIST_DIRECTORY: 'list_directory', RUN_COMMAND: 'run_command',
  READ_URL_CONTENT: 'view_web_document', SEARCH_WEB: 'search_web',
};

export function parseAntigravityTranscript(filePath, uuid, { databasePath } = {}) {
  let content;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch {
    content = '';
  }
  const lines = content.split('\n').filter(Boolean);
  const parsed = [];
  let malformed = 0;
  for (const line of lines) {
    try {
      const row = JSON.parse(line);
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Invalid step');
      parsed.push(row);
    } catch { malformed++; }
  }
  const database = readAntigravityDatabase(databasePath);
  const indexed = new Map(parsed.filter(row => Number.isInteger(row.step_index)).map(row => [row.step_index, row]));
  // Some logs append a status update for an existing step; count that step once.
  const rows = [...indexed.values(), ...parsed.filter(row => !Number.isInteger(row.step_index))];
  const conflicts = database.steps.filter(step => {
    const existing = indexed.get(step.step_index);
    return existing && (Math.abs(Date.parse(existing.created_at) - Date.parse(step.created_at)) >= 1000
      || (step.type !== 'UNKNOWN_STEP' && existing.type !== step.type));
  }).length;
  let recovered = 0;
  if (!conflicts) {
    for (const step of database.steps) {
      if (indexed.has(step.step_index)) continue;
      rows.push(step);
      recovered++;
    }
  }

  const session = createSession({
    session_id: `antigravity-${uuid}`,
    source: 'antigravity',
    project: 'antigravity',
    entrypoint: 'antigravity',
    // Token/model/cost are not exposed by Antigravity locally.
    model: null,
    usage_available: false,
    pricing_source: 'unavailable',
    estimated_cost_usd: 0,
    raw_ref: existsSync(filePath) ? filePath : databasePath,
    sync_coverage: {
      database_status: conflicts ? 'unsupported' : database.status,
      database_steps: database.steps.length, recovered_steps: recovered,
      unknown_steps: database.steps.filter(step => step.type === 'UNKNOWN_STEP').length,
    },
  });

  const cwdCounts = new Map();

  for (const e of rows) {
    const ts = e.created_at;
    if (ts) {
      if (!session.started_at || ts < session.started_at) session.started_at = ts;
      if (!session.ended_at   || ts > session.ended_at)   session.ended_at   = ts;
    }

    session.message_count++;
    if (e.source === 'USER_EXPLICIT' || e.type === 'USER_INPUT') {
      session.user_message_count++;
      if (!session.first_user_message) {
        const snip = makeSnippet(stripUserRequest(e.content));
        if (snip) {
          session.first_user_message = snip;
          session.session_title = snip;
        }
      }
    } else if (e.source === 'MODEL') {
      session.assistant_message_count++;
    }

    // Count tool usage from explicit tool_calls; fall back to the step type.
    if (Array.isArray(e.tool_calls) && e.tool_calls.length > 0) {
      for (const tc of e.tool_calls) {
        const name = normalizeTool(tc?.name);
        if (name) session.tools[name] = (session.tools[name] || 0) + 1;
        // Harvest a project hint from any absolute path argument.
        const ap = tc?.args?.AbsolutePath || tc?.args?.absolute_path || tc?.args?.path;
        if (typeof ap === 'string') {
          const clean = ap.replace(/^["']|["']$/g, '');
          const m = clean.match(/^(\/[^"']+?)\/[^/]*$/);
          if (m) cwdCounts.set(m[1], (cwdCounts.get(m[1]) || 0) + 1);
        }
      }
    } else if (STEP_TOOLS[e.type]) {
      const name = normalizeTool(STEP_TOOLS[e.type]);
      session.tools[name] = (session.tools[name] || 0) + 1;
    }
  }

  if (!session.started_at) return null;

  // Pick the most-referenced directory as the project root, then step over a
  // trailing generic source folder (src/lib/app/...) so the label is the repo
  // name ("myapp") rather than "src".
  if (cwdCounts.size > 0) {
    let top = [...cwdCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const GENERIC = new Set(['src', 'lib', 'app', 'dist', 'build', 'out']);
    let name = projectFromCwd(top);
    if (GENERIC.has(name)) {
      const parent = top.slice(0, top.lastIndexOf('/'));
      name = projectFromCwd(parent) || name;
    }
    session.cwd = top;
    session.project = name || 'antigravity';
  }

  session.cat_type = classifyAntigravity(session.tools);
  session.is_ghost = session.message_count < 3 || Object.keys(session.tools).length === 0;

  if (session.started_at && session.ended_at) {
    session.duration_seconds = Math.max(0, Math.floor(
      (new Date(session.ended_at).getTime() - new Date(session.started_at).getTime()) / 1000
    ));
  }

  if (malformed > 0) {
    console.warn(`  ⚠ Antigravity transcript: skipped ${malformed} malformed line(s)`);
  }

  return session;
}

// Lightweight cat-type classifier over the normalized tool buckets.
function classifyAntigravity(tools) {
  const total = Object.values(tools).reduce((a, b) => a + b, 0);
  if (total === 0) return 'ghost';
  const r = (t) => (tools[t] || 0) / total;
  if (r('Edit') + r('Write') > 0.4) return 'builder';
  if (r('Read') + r('Grep') + r('Glob') > 0.5) return 'detective';
  if (r('Bash') > 0.4) return 'commander';
  return 'architect'; // Antigravity is plan-driven agentic work by default
}

export function scanAntigravitySessions(antigravityDir = DEFAULT_ANTIGRAVITY_DIR) {
  if (!antigravityDir) return [];
  const brainDir = join(antigravityDir, 'brain');
  const conversationDir = join(antigravityDir, 'conversations');

  const sessions = [];
  const uuids = new Set();
  try { for (const uuid of readdirSync(brainDir)) uuids.add(uuid); } catch { /* Store may contain only databases. */ }
  try {
    for (const file of readdirSync(conversationDir)) {
      if (file.endsWith('.db')) uuids.add(file.slice(0, -3));
    }
  } catch { /* Older stores contain only brain logs. */ }

  for (const uuid of uuids) {
    const transcript = join(brainDir, uuid, '.system_generated', 'logs', 'transcript.jsonl');
    const databasePath = join(conversationDir, `${uuid}.db`);
    if (!existsSync(databasePath)) {
      try { if (!statSync(transcript).isFile()) continue; } catch { continue; }
    }
    try {
      const s = parseAntigravityTranscript(transcript, uuid, { databasePath });
      if (s) sessions.push(s);
    } catch {
      // Skip unreadable / malformed transcripts silently.
    }
  }
  return sessions;
}

export function antigravityCoverage(root, sessions) {
  let files = [];
  try { files = readdirSync(join(root, 'conversations')).filter(file => /\.(db|pb)$/.test(file)); } catch { /* Brain-only stores are supported. */ }
  const ids = new Set(sessions.map(session => session.session_id.slice('antigravity-'.length)));
  const coverage = sessions.map(session => session.sync_coverage).filter(Boolean);
  return {
    conversation_stores: files.length,
    unreadable_stores: files.filter(file => !ids.has(file.replace(/\.(db|pb)$/, ''))).length,
    database_sessions: coverage.filter(value => value.database_status === 'read').length,
    unreadable_databases: coverage.filter(value => ['unsupported', 'unreadable'].includes(value.database_status)).length,
    recovered_steps: coverage.reduce((total, value) => total + value.recovered_steps, 0),
    unknown_steps: coverage.reduce((total, value) => total + value.unknown_steps, 0),
  };
}
