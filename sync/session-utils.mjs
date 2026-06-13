// Shared session helpers used by every parser (Claude, Codex, Cursor, Aider,
// Antigravity). Centralizing these kills the copy-paste drift that had four
// near-identical `snippetize` / default-session implementations slowly
// diverging across the parsers.

export const FIRST_MSG_MAX = 80;

// Privacy opt-out. When MEOW_NO_SNIPPETS is set, no first-user-message or
// session title is captured into the exported data at all — only metrics.
// The README documents this; it is the strict "metrics only" mode.
export function snippetsDisabled() {
  const v = process.env.MEOW_NO_SNIPPETS;
  return v === '1' || v === 'true' || v === 'yes';
}

/** Read the text payload from a user-message content field (string or block array). */
export function extractUserText(content) {
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
export function isAutoInjectedOnly(text) {
  if (!text) return true;
  const stripped = text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<command-(name|message|args|stdout|stderr)>[\s\S]*?<\/command-\1>/g, '')
    .replace(/<local-command-(stdout|stderr)>[\s\S]*?<\/local-command-\1>/g, '')
    .trim();
  return stripped.length === 0;
}

/** Compress raw user-message text into a single-line snippet of at most max chars. */
export function snippetize(text, max = FIRST_MSG_MAX) {
  const cleaned = String(text || '')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, ' ')
    .replace(/<command-name>([^<]*)<\/command-name>/g, '$1')
    .replace(/<command-message>([^<]*)<\/command-message>/g, ' $1')
    .replace(/<command-args>([^<]*)<\/command-args>/g, ' $1')
    .replace(/<local-command-(stdout|stderr)>[\s\S]*?<\/local-command-\1>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  if (cleaned.length <= max) return cleaned;
  return cleaned.slice(0, max - 1).trimEnd() + '…';
}

// Single chokepoint for "should I capture a label snippet from this text?".
// Returns null when snippets are disabled or the text is auto-injected noise.
export function makeSnippet(rawText, max = FIRST_MSG_MAX) {
  if (snippetsDisabled()) return null;
  if (!rawText || isAutoInjectedOnly(rawText)) return null;
  const snip = snippetize(rawText, max);
  return snip || null;
}

/** Best-effort project name from an absolute cwd path. */
export function projectFromCwd(cwd) {
  if (!cwd || typeof cwd !== 'string') return null;
  const parts = cwd.replace(/\/+$/, '').split('/').filter(Boolean);
  if (parts.length === 0) return null;
  return parts[parts.length - 1];
}

// Factory for the canonical session record. Every parser builds on this so the
// shape stays identical across sources; pass `source` and any source-specific
// overrides. `usage_available` defaults true; Antigravity sets it false because
// token/model/cost are not exposed locally.
export function createSession(overrides = {}) {
  return {
    session_id: null,
    source: 'claude',
    project: null,
    cwd: null,
    model: null,
    entrypoint: null,
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
    // True when token/model/cost are real. False for sources (Antigravity)
    // that do not expose usage locally, so the UI can show "not available"
    // instead of a fabricated $0.
    usage_available: true,
    // 'exact' | 'family' | 'unknown' | 'default' | 'none' — how the model was
    // priced. 'unknown' means an unrecognized model priced by estimate.
    pricing_source: 'exact',
    cat_type: 'ghost',
    is_ghost: false,
    tools: {},
    session_title: null,
    first_user_message: null,
    parent_session_id: null,
    agent_id: null,
    agent_slug: null,
    is_sidechain: false,
    ...overrides,
  };
}
