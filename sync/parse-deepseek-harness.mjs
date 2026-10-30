// Parse local DeepSeek harness event JSONL into canonical session metrics.
// Message text and tool arguments are intentionally never copied to the output.

import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import { calculateCostDetailed } from './cost-calculator.mjs';
import { createSession } from './session-utils.mjs';
import { readJsonlWithCheckpoint } from './incremental-jsonl.mjs';
import { statSourcePath, walkSourceJsonl } from './source-discovery.mjs';

export function defaultDeepSeekHarnessDir(env = process.env) {
  const home = env.HOME || homedir();
  return env.DEEPSEEK_HARNESS_DIR
    || join(home, 'DeepSeek-Workspace', 'codex-parity', 'results', 'deepseek');
}

export const DEFAULT_DEEPSEEK_HARNESS_DIR = defaultDeepSeekHarnessDir();

function safeCount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function asIso(value) {
  if (value == null || value === '') return null;
  const time = typeof value === 'number' && Number.isFinite(value)
    ? (Math.abs(value) < 1e12 ? value * 1000 : value)
    : value;
  const date = new Date(time);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function createState(sessionId, project) {
  return {
    session: createSession({
      session_id: sessionId,
      source: 'deepseek',
      project: project || 'deepseek-harness',
    }),
    models: new Set(),
    hasUsage: false,
  };
}

function addTimestamp(session, value) {
  const timestamp = asIso(value);
  if (!timestamp) return;
  if (!session.started_at || timestamp < session.started_at) session.started_at = timestamp;
  if (!session.ended_at || timestamp > session.ended_at) session.ended_at = timestamp;
}

function addTool(session, name) {
  if (typeof name !== 'string' || !name.trim()) return;
  session.tools[name] = (session.tools[name] || 0) + 1;
}

function consumeEntry(state, entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;
  const session = state.session;
  const data = entry.data && typeof entry.data === 'object' ? entry.data : {};
  const message = data.message && typeof data.message === 'object' ? data.message : {};
  const type = typeof entry.type === 'string' ? entry.type : '';

  addTimestamp(session, entry.time ?? entry.timestamp ?? data.time ?? data.timestamp);

  const model = entry.model ?? data.model ?? message.model;
  if (typeof model === 'string' && model.trim()) state.models.add(model.trim());
  const isUser = type === 'user/message' || (type === 'message' && data.role === 'user');
  const isAssistant = type === 'assistant/message'
    || (type === 'message' && (data.role === 'assistant' || message.role === 'assistant'));
  if (isUser) {
    session.user_message_count++;
    session.message_count++;
  }
  if (isAssistant) {
    session.assistant_message_count++;
    session.message_count++;

    const usage = data.usage ?? entry.usage;
    if (usage && typeof usage === 'object') {
      state.hasUsage = true;
      session.input_tokens += safeCount(usage.inputTokens ?? usage.input_tokens);
      session.output_tokens += safeCount(usage.outputTokens ?? usage.output_tokens);
      session.cache_read_tokens += safeCount(usage.cacheReadTokens ?? usage.cache_read_tokens);
      session.cache_creation_tokens += safeCount(
        usage.cacheWriteTokens ?? usage.cache_write_tokens
          ?? usage.cache_creation_input_tokens,
      );
    }

    const blocks = Array.isArray(message.content) ? message.content : [];
    for (const block of blocks) {
      if (!block || typeof block !== 'object' || Array.isArray(block)) continue;
      if (block.type === 'tool-call' || block.type === 'tool_call' || block.arguments != null) {
        addTool(session, block.name);
      }
    }
  }

  // Older harness event streams may emit a standalone call event.
  if (type === 'tool-call' || type === 'tool_call') addTool(session, entry.name ?? data.name);
}

function finishState(state) {
  const session = structuredClone(state.session);
  if (session.message_count === 0) return null;

  session.model = state.models.size === 1 ? [...state.models][0] : null;
  session.usage_available = state.hasUsage;
  session.total_tokens = session.input_tokens + session.output_tokens
    + session.cache_creation_tokens + session.cache_read_tokens;
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

  if (session.started_at && !session.ended_at) session.ended_at = session.started_at;
  if (session.started_at && session.ended_at) {
    session.duration_seconds = Math.max(0, Math.floor(
      (Date.parse(session.ended_at) - Date.parse(session.started_at)) / 1000,
    ));
  }
  return session;
}

export function parseDeepSeekFile(filePath, options = {}) {
  const sessionId = options.sessionId
    || `deepseek-${createHash('sha256').update(options.relativePath || filePath).digest('hex').slice(0, 32)}`;
  const project = options.project || 'deepseek-harness';
  return readJsonlWithCheckpoint(filePath, {
    ...options,
    version: `deepseek-harness-v1:${sessionId}:${project}`,
    createState: () => createState(sessionId, project),
    reduceEntry: consumeEntry,
    finish: finishState,
    hydrate: value => {
      if (!value?.session || !Array.isArray(value.models)) throw new Error('Invalid checkpoint state.');
      return { ...value, models: new Set(value.models) };
    },
    dehydrate: value => ({ ...value, models: [...value.models] }),
  });
}

export function scanDeepSeekSessions(rootDir = DEFAULT_DEEPSEEK_HARNESS_DIR, options = {}) {
  const rootStat = statSourcePath(rootDir, { ...options, optional: true });
  if (!rootStat?.isDirectory()) return [];

  const sessions = [];
  for (const { filePath } of walkSourceJsonl(rootDir, options)) {
    const relativePath = relative(rootDir, filePath);
    const sessionId = `deepseek-${createHash('sha256').update(relativePath).digest('hex').slice(0, 32)}`;
    try {
      const session = parseDeepSeekFile(filePath, { ...options, sessionId, relativePath });
      if (session) sessions.push(session);
    } catch {
      // The checkpoint reader reports a sanitized failure stage via onCoverage.
    }
  }
  return sessions;
}
