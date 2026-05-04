import { calculateCost } from './cost-calculator.mjs';

// ─── First-message snippet extraction ────────────────────────────────────────
// Captures the first user-typed message per session, ~80 chars max, used by
// the run-group dropdown to make near-identical "patherle" rows distinguishable
// at a glance ("fix billing webhook" beats "patherle 149.49g 4 roots ×4").

const FIRST_MSG_MAX = 80;

/** Read the text payload from a user-message content field (string or block array). */
function extractUserText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  for (const block of content) {
    if (block && block.type === 'text' && typeof block.text === 'string') {
      return block.text;
    }
  }
  return '';
}

/** True when a user message is purely auto-injected (system-reminder, no real text). */
function isAutoInjectedOnly(text) {
  if (!text) return true;
  const stripped = text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<command-(name|message|args|stdout|stderr)>[\s\S]*?<\/command-\1>/g, '')
    .replace(/<local-command-(stdout|stderr)>[\s\S]*?<\/local-command-\1>/g, '')
    .trim();
  return stripped.length === 0;
}

/** Compress raw user-message text into a single-line snippet of at most max chars. */
function snippetize(text, max = FIRST_MSG_MAX) {
  const cleaned = text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, ' ')
    .replace(/<command-name>([^<]*)<\/command-name>/g, '$1')
    .replace(/<command-message>([^<]*)<\/command-message>/g, ' $1')
    .replace(/<command-args>([^<]*)<\/command-args>/g, ' $1')
    .replace(/<local-command-(stdout|stderr)>[\s\S]*?<\/local-command-\1>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  if (cleaned.length <= max) return cleaned;
  return cleaned.slice(0, max - 1) + '…';
}

export function classifyCatType(toolCounts) {
  if (!toolCounts || typeof toolCounts !== 'object') return 'ghost';
  const total = Object.values(toolCounts).reduce((a, b) => a + b, 0);
  if (total === 0) return 'ghost';

  const ratio = (tool) => (toolCounts[tool] || 0) / total;

  if (ratio('Write') + ratio('Edit') > 0.4) return 'builder';
  if (ratio('Read') + ratio('Grep') + ratio('Glob') > 0.5) return 'detective';
  if (ratio('Bash') > 0.4) return 'commander';
  if (ratio('Agent') + ratio('EnterPlanMode') > 0.2) return 'architect';

  const top = Object.entries(toolCounts).sort((a, b) => b[1] - a[1])[0];
  if (top && ['Bash', 'Write', 'Edit'].includes(top[0])) return 'builder';
  return 'detective';
}

// Decode the directory names Claude Code uses for projects.
// Claude Code stores sessions at ~/.claude/projects/<encoded-cwd>/...
// where the encoded form is the full filesystem path with "/" replaced by "-".
//
// Examples (with HOME=/Users/alice):
//   "-Users-alice"                              → "home"
//   "-Users-alice-projects-my-app"              → "my-app"  (when refined via cwd)
//   "-Users-alice--claude-worktrees-feature-x"  → "worktree/feature-x"
//   "-Applications-Foo-app"                     → "Foo"
//
// Better project names come from the `cwd` field captured per-session
// (see export-local.mjs `projectFromCwd`). This function is the fallback
// when cwd is missing.
export function decodeProjectPath(dirName) {
  const home = (process.env.HOME || '').replace(/\//g, '-');
  let path = dirName;

  // Strip the "-Users-<user>" prefix derived from $HOME
  if (home && path.startsWith(home)) {
    path = path.slice(home.length).replace(/^-/, '');
  }

  if (!path) return 'home';

  if (path.startsWith('-Applications-') || path.startsWith('Applications-')) {
    return path.replace(/^-?Applications-/, '').replace(/-app$/, '');
  }
  if (path.startsWith('-claude-worktrees-')) {
    return 'worktree/' + path.replace('-claude-worktrees-', '');
  }
  // Handle nested worktrees under any subfolder (e.g. "Foo--claude-worktrees-bar")
  const wtMatch = path.match(/--claude-worktrees-(.+)$/);
  if (wtMatch) return 'worktree/' + wtMatch[1];

  // "<Folder>--<Inner>-" pattern (a dash separator wrapping a nested folder name)
  const inner = path.match(/--([^-]+)-?$/);
  if (inner) return inner[1];

  return path.replace(/^-/, '');
}

export function parseSessionLines(lines, projectDir) {
  const sessions = {};

  // Extract hierarchy fields from the FIRST parseable line.
  // Claude Code subagent files always have parentUuid / agentId / slug on line 1.
  let firstEntry = null;
  for (const line of lines) {
    try { firstEntry = JSON.parse(line); break; } catch { /* skip */ }
  }
  const parentSessionId = firstEntry?.parentUuid ?? null;
  const agentId         = firstEntry?.agentId    ?? null;
  const agentSlug       = firstEntry?.slug        ?? null;
  const isSidechain     = firstEntry?.isSidechain ?? false;

  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (!entry.sessionId) continue;
    const sid = entry.sessionId;

    if (!sessions[sid]) {
      sessions[sid] = {
        session_id: sid,
        project: decodeProjectPath(projectDir),
        cwd: null,
        model: null,
        entrypoint: null,
        git_branch: null,
        version: null,
        started_at: null,
        ended_at: null,
        message_count: 0,
        user_message_count: 0,
        assistant_message_count: 0,
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_tokens: 0,
        cache_read_tokens: 0,
        total_tokens: 0,
        estimated_cost_usd: 0,
        cat_type: 'ghost',
        is_ghost: false,
        tools: {},
        session_title: null,
        // First user-typed message (~80 chars), used as a memorable label in
        // the run-group dropdown. Null until we see a non-auto-injected user
        // message in this session's log.
        first_user_message: null,
        // Hierarchy fields
        parent_session_id: parentSessionId,
        agent_id:          agentId,
        agent_slug:        agentSlug,
        is_sidechain:      isSidechain,
      };
    }

    const s = sessions[sid];
    const ts = entry.timestamp;

    if (ts) {
      if (!s.started_at || ts < s.started_at) s.started_at = ts;
      if (!s.ended_at || ts > s.ended_at) s.ended_at = ts;
    }

    if (entry.type === 'user') {
      s.user_message_count++;
      s.message_count++;
      if (!s.entrypoint && entry.entrypoint) s.entrypoint = entry.entrypoint;
      if (!s.version && entry.version) s.version = entry.version;
      if (!s.git_branch && entry.gitBranch) s.git_branch = entry.gitBranch;
      if (!s.cwd && entry.cwd) s.cwd = entry.cwd;

      // Capture the first real user-typed message (skip auto-injected blocks
      // like <system-reminder> and tool-result echoes that aren't user intent).
      if (!s.first_user_message) {
        const raw = extractUserText(entry.message?.content);
        if (raw && !isAutoInjectedOnly(raw)) {
          s.first_user_message = snippetize(raw);
          s.session_title = s.first_user_message;
        }
      }
    }

    if (entry.type === 'assistant') {
      s.assistant_message_count++;
      s.message_count++;

      if (!s.model && entry.message?.model) s.model = entry.message.model;

      const usage = entry.message?.usage;
      if (usage) {
        s.input_tokens += usage.input_tokens || 0;
        s.output_tokens += usage.output_tokens || 0;
        s.cache_creation_tokens += usage.cache_creation_input_tokens || 0;
        s.cache_read_tokens += usage.cache_read_input_tokens || 0;
      }

      const content = entry.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'tool_use' && block.name) {
            s.tools[block.name] = (s.tools[block.name] || 0) + 1;
          }
        }
      }
    }
  }

  // Post-process
  for (const s of Object.values(sessions)) {
    // Include cache tokens in the total — users pay for cache creation and
    // cache read, and cache_read can be enormous on long sessions. Excluding
    // them caused the "Tokens" stat card to dramatically understate reality.
    s.total_tokens = s.input_tokens + s.output_tokens
      + s.cache_creation_tokens + s.cache_read_tokens;
    s.estimated_cost_usd = calculateCost(
      s.model, s.input_tokens, s.output_tokens,
      s.cache_creation_tokens, s.cache_read_tokens
    );
    s.cat_type = classifyCatType(s.tools);
    s.is_ghost = s.cat_type === 'ghost' || s.message_count < 3;

    if (s.started_at && s.ended_at) {
      s.duration_seconds = Math.floor(
        (new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 1000
      );
    } else {
      s.duration_seconds = 0;
    }
  }

  return Object.values(sessions).filter((s) => s.started_at);
}
