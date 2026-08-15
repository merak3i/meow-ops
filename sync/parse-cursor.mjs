// parse-cursor.mjs — Cursor agent-transcript parser.
//
// Local Cursor agent transcripts live at:
//   ~/.cursor/projects/<workspace-slug>/agent-transcripts/
//     <composerId>/<composerId>.jsonl
//     <composerId>.jsonl
//     <parentId>/subagents/<subagentId>.jsonl
//
// Those files expose messages and tools. They do not expose authoritative
// top-level model, token, or cost values. This parser therefore records
// time, tools, project, and hierarchy only, and marks usage_available=false.
//
// Hard rules:
//   * Never infer a historical model from Cursor's current selected model.
//   * Never treat a nested Task argument such as model="fast" as the parent model.
//   * Never estimate tokens or cost from transcript text.
//
// Optional official usage enrichment is in cursor-admin-usage.mjs.

import { existsSync, readdirSync, statSync, readFileSync } from 'fs';
import { basename, dirname, join } from 'path';
import { homedir } from 'os';
import { classifyCatType, decodeProjectPath } from './parse-session.mjs';
import { createSession, makeSnippet, projectFromCwd } from './session-utils.mjs';

export const DEFAULT_CURSOR_PROJECTS_DIR = process.env.HOME || homedir()
  ? join(process.env.HOME || homedir(), '.cursor', 'projects')
  : null;

const TOOL_MAP = {
  shell: 'Bash',
  run_terminal_cmd: 'Bash',
  run_terminal_command: 'Bash',
  terminal: 'Bash',
  task: 'Agent',
  read_file: 'Read',
  write_file: 'Write',
  edit_file: 'Edit',
  delete_file: 'Delete',
  grep_search: 'Grep',
  glob: 'Glob',
  list_dir: 'LS',
  web_search: 'WebSearch',
  web_fetch: 'WebFetch',
};

function normalizeTool(name) {
  if (!name || typeof name !== 'string') return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  return TOOL_MAP[trimmed.toLowerCase()] || trimmed;
}

function asIso(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value < 1e12 ? value * 1000 : value;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function entryTimestamp(entry) {
  if (!entry || typeof entry !== 'object') return null;
  return asIso(
    entry.createdAt
    ?? entry.created_at
    ?? entry.timestamp
    ?? entry.time
    ?? entry.message?.createdAt
    ?? entry.message?.created_at
    ?? entry.message?.timestamp,
  );
}

function entryRole(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const role = entry.role || entry.type || entry.message?.role;
  if (role === 'user' || role === 'human') return 'user';
  if (role === 'assistant' || role === 'ai' || role === 'model') return 'assistant';
  return null;
}

function contentBlocks(entry) {
  if (!entry || typeof entry !== 'object') return [];
  const raw = entry.message?.content ?? entry.content ?? entry.message;
  if (typeof raw === 'string') return [{ type: 'text', text: raw }];
  if (Array.isArray(raw)) return raw.filter((block) => block && typeof block === 'object');
  if (raw && typeof raw === 'object' && (raw.type || raw.text || raw.name)) return [raw];
  return [];
}

function blockText(block) {
  if (!block || typeof block !== 'object') return '';
  if (typeof block.text === 'string') return block.text;
  if (typeof block.content === 'string') return block.content;
  return '';
}

function collectToolNames(entry, blocks) {
  const names = [];
  for (const block of blocks) {
    const type = String(block.type || '').toLowerCase();
    if (type === 'tool_use' || type === 'tool_call' || type === 'tooluse') {
      const name = normalizeTool(block.name || block.toolName || block.tool_name);
      if (name) names.push(name);
    }
  }
  const extra = entry.tool_calls || entry.toolCalls || entry.message?.tool_calls;
  if (Array.isArray(extra)) {
    for (const call of extra) {
      const name = normalizeTool(call?.name || call?.toolName || call?.tool_name);
      if (name) names.push(name);
    }
  }
  return names;
}

function localIdFromName(name) {
  if (!name || typeof name !== 'string') return null;
  const trimmed = name.replace(/\.jsonl$/i, '').trim();
  return trimmed || null;
}

function projectFromSlug(slug) {
  if (!slug) return 'cursor';
  const decoded = decodeProjectPath(slug);
  if (decoded && decoded !== slug) return decoded;
  const fromPath = projectFromCwd(slug.replace(/-/g, '/'));
  return fromPath || decoded || slug || 'cursor';
}

export function parseCursorTranscript(filePath, options = {}) {
  let content;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }

  const lines = content.split('\n').filter(Boolean);
  const composerId = options.composerId || localIdFromName(basename(filePath));
  if (!composerId) return null;

  const parentComposerId = options.parentComposerId || null;
  const projectSlug = options.projectSlug || null;
  const stat = options.stat || null;
  const fallbackIso = stat?.mtime ? stat.mtime.toISOString() : null;
  const isSubagent = Boolean(parentComposerId) || options.isSubagent === true;

  const session = createSession({
    session_id: `cursor-${composerId}`,
    source: 'cursor',
    project: projectFromSlug(projectSlug),
    model: null,
    entrypoint: isSubagent ? 'subagent' : 'cursor',
    usage_available: false,
    pricing_source: 'unavailable',
    estimated_cost_usd: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_tokens: 0,
    cache_read_tokens: 0,
    total_tokens: 0,
    composer_id: composerId,
    conversation_id: null,
    cloud_agent_id: composerId.startsWith('bc-') ? composerId : null,
    parent_session_id: parentComposerId ? `cursor-${parentComposerId}` : null,
    is_subagent: isSubagent,
    agent_depth: isSubagent ? 1 : 0,
    raw_ref: filePath,
  });

  let parsed = 0;
  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!entry || typeof entry !== 'object') continue;
    parsed += 1;

    const ts = entryTimestamp(entry);
    if (ts) {
      if (!session.started_at || ts < session.started_at) session.started_at = ts;
      if (!session.ended_at || ts > session.ended_at) session.ended_at = ts;
    }

    if (typeof entry.cwd === 'string' && entry.cwd && !session.cwd) session.cwd = entry.cwd;
    if (typeof entry.conversationId === 'string' && entry.conversationId && !session.conversation_id) {
      session.conversation_id = entry.conversationId;
    }
    if (typeof entry.conversation_id === 'string' && entry.conversation_id && !session.conversation_id) {
      session.conversation_id = entry.conversation_id;
    }
    if (typeof entry.cloudAgentId === 'string' && entry.cloudAgentId && !session.cloud_agent_id) {
      session.cloud_agent_id = entry.cloudAgentId;
    }

    const role = entryRole(entry);
    const blocks = contentBlocks(entry);
    if (role === 'user') {
      session.user_message_count += 1;
      session.message_count += 1;
      if (!session.first_user_message) {
        const text = blocks.map(blockText).filter(Boolean).join(' ')
          || (typeof entry.text === 'string' ? entry.text : '');
        const snip = makeSnippet(text);
        if (snip) {
          session.first_user_message = snip;
          session.session_title = snip;
        }
      }
    } else if (role === 'assistant') {
      session.assistant_message_count += 1;
      session.message_count += 1;
    }

    for (const name of collectToolNames(entry, blocks)) {
      session.tools[name] = (session.tools[name] || 0) + 1;
    }
  }

  if (parsed === 0) return null;

  if (!session.started_at && fallbackIso) {
    session.started_at = fallbackIso;
    session.ended_at = fallbackIso;
  }
  if (session.started_at && !session.ended_at) session.ended_at = session.started_at;
  if (session.started_at && session.ended_at) {
    session.duration_seconds = Math.max(0, Math.floor(
      (new Date(session.ended_at).getTime() - new Date(session.started_at).getTime()) / 1000,
    ));
  }

  if (session.cwd) {
    const refined = projectFromCwd(session.cwd);
    if (refined) session.project = refined;
  }

  session.cat_type = classifyCatType(session.tools);
  if (session.cat_type === 'ghost' && Object.keys(session.tools).length > 0) {
    session.cat_type = 'architect';
  }
  session.is_ghost = session.message_count < 2;

  return session;
}

function listDir(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function safeStat(path) {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

export function resolveCursorTranscriptDirs(rootDir) {
  if (!rootDir || !existsSync(rootDir)) return [];
  const found = [];
  const rootStat = safeStat(rootDir);
  if (!rootStat?.isDirectory()) return [];

  if (basename(rootDir) === 'agent-transcripts') found.push(rootDir);

  const direct = join(rootDir, 'agent-transcripts');
  if (existsSync(direct) && safeStat(direct)?.isDirectory()) found.push(direct);

  for (const entry of listDir(rootDir)) {
    const full = join(rootDir, entry);
    const stat = safeStat(full);
    if (!stat?.isDirectory()) continue;
    if (entry === 'agent-transcripts') {
      found.push(full);
      continue;
    }
    const nested = join(full, 'agent-transcripts');
    if (existsSync(nested) && safeStat(nested)?.isDirectory()) found.push(nested);
  }

  return [...new Set(found)];
}

function projectSlugFromTranscriptsDir(transcriptsDir) {
  const parent = basename(dirname(transcriptsDir));
  return parent && parent !== '.' ? parent : 'cursor';
}

export function listCursorTranscriptFiles(transcriptsDir) {
  const files = [];
  if (!transcriptsDir || !existsSync(transcriptsDir)) return files;

  for (const entry of listDir(transcriptsDir)) {
    const full = join(transcriptsDir, entry);
    const stat = safeStat(full);
    if (!stat) continue;

    if (stat.isFile() && entry.endsWith('.jsonl')) {
      files.push({
        filePath: full,
        composerId: localIdFromName(entry),
        parentComposerId: null,
        stat,
      });
      continue;
    }

    if (!stat.isDirectory() || entry === 'subagents') continue;

    const composerId = entry;
    const nestedFile = join(full, `${composerId}.jsonl`);
    const nestedStat = safeStat(nestedFile);
    if (nestedStat?.isFile()) {
      files.push({
        filePath: nestedFile,
        composerId,
        parentComposerId: null,
        stat: nestedStat,
      });
    } else {
      for (const child of listDir(full)) {
        if (!child.endsWith('.jsonl')) continue;
        const childPath = join(full, child);
        const childStat = safeStat(childPath);
        if (!childStat?.isFile()) continue;
        files.push({
          filePath: childPath,
          composerId: localIdFromName(child) || composerId,
          parentComposerId: null,
          stat: childStat,
        });
      }
    }

    const subDir = join(full, 'subagents');
    if (!existsSync(subDir) || !safeStat(subDir)?.isDirectory()) continue;
    for (const sub of listDir(subDir)) {
      if (!sub.endsWith('.jsonl')) continue;
      const subPath = join(subDir, sub);
      const subStat = safeStat(subPath);
      if (!subStat?.isFile()) continue;
      files.push({
        filePath: subPath,
        composerId: localIdFromName(sub),
        parentComposerId: composerId,
        stat: subStat,
      });
    }
  }

  return files.filter((row) => row.composerId);
}

export function scanCursorSessions(rootDir = DEFAULT_CURSOR_PROJECTS_DIR) {
  if (!rootDir || !existsSync(rootDir)) return [];

  const sessions = [];
  const seen = new Set();
  const transcriptDirs = resolveCursorTranscriptDirs(rootDir);

  for (const transcriptsDir of transcriptDirs) {
    const projectSlug = projectSlugFromTranscriptsDir(transcriptsDir);
    for (const file of listCursorTranscriptFiles(transcriptsDir)) {
      const key = `${file.parentComposerId || ''}::${file.composerId}`;
      if (seen.has(key)) continue;
      try {
        const session = parseCursorTranscript(file.filePath, {
          composerId: file.composerId,
          parentComposerId: file.parentComposerId,
          projectSlug,
          stat: file.stat,
        });
        if (!session) continue;
        seen.add(key);
        sessions.push(session);
      } catch {
        // Skip unreadable / malformed transcripts.
      }
    }
  }

  return sessions;
}
