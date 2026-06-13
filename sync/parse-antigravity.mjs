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
// IMPORTANT — what Antigravity does NOT expose locally:
//   * token counts (input/output/total) — not written to any plaintext file
//   * the model used — only an opaque enum (MODEL_PLACEHOLDER_M16) with no
//     local name mapping; the conversation store (conversations/*.pb) is encrypted
//   * cost — derived from the two above, so also unavailable
//
// We therefore record real TIME, TOOLS, PROJECT, and step counts, and mark
// usage_available=false so the dashboard shows "not exposed by Antigravity"
// rather than a fabricated $0 / 0 tokens. No estimation, by design.

import { existsSync, readdirSync, statSync, readFileSync } from 'fs';
import { join } from 'path';
import { createSession, makeSnippet, projectFromCwd } from './session-utils.mjs';

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

export function parseAntigravityTranscript(filePath, uuid) {
  let content;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
  const lines = content.split('\n').filter(Boolean);

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
  });

  const cwdCounts = new Map();
  let malformed = 0;

  for (const line of lines) {
    let e;
    try { e = JSON.parse(line); } catch { malformed++; continue; }

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
    console.warn(`  ⚠ antigravity/${uuid}: skipped ${malformed} malformed transcript line(s)`);
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
  if (!existsSync(brainDir)) return [];

  const sessions = [];
  let uuids;
  try { uuids = readdirSync(brainDir); } catch { return []; }

  for (const uuid of uuids) {
    const transcript = join(brainDir, uuid, '.system_generated', 'logs', 'transcript.jsonl');
    let st;
    try { st = statSync(transcript); } catch { continue; }
    if (!st.isFile()) continue;
    try {
      const s = parseAntigravityTranscript(transcript, uuid);
      if (s) sessions.push(s);
    } catch {
      // Skip unreadable / malformed transcripts silently.
    }
  }
  return sessions;
}
