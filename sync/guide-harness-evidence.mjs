// Read source messages as historical evidence, never as executable instructions.
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';
import { redactEvidenceText } from './project-evidence.mjs';
import { guideText, guideUserParts } from './guide-evidence-text.mjs';

const TEXT_LIMIT = 2_000;
const EVENT_LIMIT = 5_000;
const hash = value => createHash('sha256').update(value).digest('hex');
const sql = value => `'${String(value).replaceAll("'", "''")}'`;

function iso(value) {
  if (value == null || value === '') return null;
  const date = new Date(typeof value === 'number' && value < 1e12 ? value * 1000 : value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

const textBlocks = guideText;

function resultState() {
  return { events: [], coverage: { malformed_records: 0, duplicate_records: 0, omitted_records: 0, truncated_messages: 0, missing_timestamps: 0, unsupported_records: 0, warnings: [] }, seen: new Set() };
}

function addMessage(state, binding, filePath, row) {
  if (typeof row.content !== 'string' || !row.content.trim()) return;
  if (row.role === 'user' && !row.splitContext) {
    for (const part of guideUserParts(row.content, row.ambient)) addMessage(state, binding, filePath, {
      ...row, id: row.id == null || part.suffix === 'message' ? row.id : `${row.id}:${part.suffix}`,
      content: part.content, ambient: part.kind === 'ambient_context', request: part.kind === 'user_request', splitContext: true,
    });
    return;
  }
  const timestamp = iso(row.timestamp) || iso(binding.started_at);
  if (!timestamp) { state.coverage.missing_timestamps++; return; }
  const content = redactEvidenceText(row.content);
  const nativeId = row.id == null ? hash(`${row.role}\0${row.timestamp || ''}\0${content}`) : String(row.id);
  // A native message can contain both prose and a tool result.
  const key = `${row.role}:${nativeId}:${hash(content)}`;
  if (state.seen.has(key)) { state.coverage.duplicate_records++; return; }
  state.seen.add(key);
  const truncated = content.length > TEXT_LIMIT;
  if (truncated) state.coverage.truncated_messages++;
  const timestampBasis = iso(row.timestamp) ? 'message' : 'session';
  if (timestampBasis === 'session') state.coverage.missing_timestamps++;
  state.events.push({
    source: binding.source, session_id: binding.session_id, project: binding.project,
    ...(binding.parent_session_id ? { parent_session_id: binding.parent_session_id } : {}),
    timestamp, event_type: row.role === 'tool' ? 'tool_result' : `${row.role}_message`,
    actor: row.role, content: content.slice(0, TEXT_LIMIT),
    raw_ref: `${filePath}#${row.reference}`, sensitivity: 'private',
    metadata: {
      project: binding.project, source_event_id: nativeId, timestamp_basis: timestampBasis,
      evidence_kind: row.ambient ? 'ambient_context' : row.role === 'assistant' ? 'agent_claim' : row.role === 'tool' ? 'tool_result' : row.request ? 'user_request' : 'user_message',
      historical_data: true, authorizes_actions: false, truncated,
      ...(row.tool ? { tool_name: String(row.tool).slice(0, 120) } : {}),
      ...(row.compacted ? { compacted: true } : {}),
    },
  });
  if (state.events.length > EVENT_LIMIT) { state.events.shift(); state.coverage.omitted_records++; }
}

function finish(state) {
  const { coverage } = state;
  if (coverage.malformed_records) coverage.warnings.push('Malformed or incomplete source records were omitted.');
  if (coverage.omitted_records) coverage.warnings.push(`Only the latest ${EVENT_LIMIT} qualifying source records were retained from this read.`);
  if (coverage.truncated_messages) coverage.warnings.push('Message text was capped at 2,000 characters after redaction.');
  if (coverage.missing_timestamps) coverage.warnings.push('Some messages have only a session timestamp, or no usable timestamp; exact message timing is unavailable.');
  if (coverage.unsupported_records) coverage.warnings.push('Some source records are metadata, tool calls without results, or unsupported payloads; they are not outcome evidence.');
  return { events: state.events, coverage };
}

function consumeClaude(row, binding, emit) {
  if (row.sessionId !== binding.native_session_id) return;
  if (row.cwd && row.cwd !== binding.cwd) throw new Error('Source working directory does not match the selected session.');
  if (!['user', 'assistant'].includes(row.type)) return;
  const blocks = row.message?.content;
  emit({ id: row.uuid || row.message?.id, role: row.type, timestamp: row.timestamp,
    content: textBlocks(blocks), ambient: row.isMeta === true });
  if (Array.isArray(blocks)) for (const [index, block] of blocks.entries()) {
    if (block?.type !== 'tool_result') continue;
    emit({ id: `${row.uuid || row.message?.id || ''}:${block.tool_use_id || index}`, role: 'tool',
      timestamp: row.timestamp, content: textBlocks(block.content) });
  }
}

function consumeCursor(row, binding, emit) {
  if (row.cwd && row.cwd !== binding.cwd) throw new Error('Source working directory does not match the selected session.');
  const rawRole = row.role || row.type || row.message?.role;
  const role = ['user', 'human'].includes(rawRole) ? 'user' : ['assistant', 'ai', 'model'].includes(rawRole) ? 'assistant' : rawRole === 'tool' ? 'tool' : null;
  if (!role) return;
  const timestamp = row.createdAt ?? row.created_at ?? row.timestamp ?? row.time ?? row.message?.createdAt ?? row.message?.created_at ?? row.message?.timestamp;
  const blocks = row.message?.content ?? row.content ?? row.message;
  emit({ id: row.id || row.message?.id, role, timestamp, content: textBlocks(blocks), ambient: row.isMeta === true });
  if (Array.isArray(blocks)) for (const [index, block] of blocks.entries()) {
    if (block?.type !== 'tool_result') continue;
    emit({ id: `${row.id || row.message?.id || ''}:${block.tool_use_id || index}`, role: 'tool', timestamp, content: textBlocks(block.content) });
  }
}

function consumeAntigravity(row, _binding, emit) {
  const role = row.source === 'USER_EXPLICIT' || row.type === 'USER_INPUT' ? 'user'
    : row.type === 'PLANNER_RESPONSE' && row.source === 'MODEL' ? 'assistant' : null;
  // Tool step status alone does not establish what a tool returned or achieved.
  if (!role) return;
  emit({ id: Number.isInteger(row.step_index) ? row.step_index : undefined,
    role, timestamp: row.created_at, content: typeof row.content === 'string' ? row.content : '' });
}

export async function readHarnessGuideEvents(filePath, binding) {
  if (!binding?.session_id || !binding.project || !binding.cwd) throw new Error('An exact session, project and working directory are required.');
  if (binding.source === 'cursor' && basename(filePath, '.jsonl') !== binding.session_id.replace(/^cursor-/, '')) {
    throw new Error('Cursor transcript does not match the selected session.');
  }
  const consume = { claude: consumeClaude, cursor: consumeCursor, antigravity: consumeAntigravity }[binding.source];
  if (!consume) throw new Error('Detailed source format is not supported.');
  // The exporter makes Claude archive IDs file-qualified. Recover the native
  // ID using that exact file's name, never by splitting a UUID on hyphens.
  const fileKey = basename(filePath).replace('.jsonl', '');
  const prefix = `agent-${fileKey}-`;
  const suffix = `-${fileKey}`;
  const nativeSessionId = binding.source === 'claude' && binding.is_subagent && binding.session_id.startsWith(prefix)
    ? binding.session_id.slice(prefix.length)
    : binding.source === 'claude' && !binding.is_subagent && binding.session_id.endsWith(suffix)
      ? binding.session_id.slice(0, -suffix.length) : binding.session_id;
  const readBinding = { ...binding, native_session_id: nativeSessionId };
  const state = resultState();
  const input = createReadStream(filePath, { encoding: 'utf8' });
  const lines = createInterface({ input, crlfDelay: Infinity });
  let lineNumber = 0;
  try {
    for await (const line of lines) {
      lineNumber++;
      if (!line.trim()) continue;
      let row;
      try { row = JSON.parse(line); } catch { state.coverage.malformed_records++; continue; }
      if (!row || typeof row !== 'object' || Array.isArray(row)) { state.coverage.malformed_records++; continue; }
      const before = state.events.length + state.coverage.duplicate_records + state.coverage.omitted_records;
      consume(row, readBinding, event => addMessage(state, binding, filePath, { ...event, reference: `L${lineNumber}` }));
      if (state.events.length + state.coverage.duplicate_records + state.coverage.omitted_records === before) state.coverage.unsupported_records++;
    }
  } finally { lines.close(); input.destroy(); }
  return finish(state);
}

export function readHermesGuideEvents(dbPath, binding) {
  const query = statement => {
    const output = execFileSync('sqlite3', ['-readonly', '-json', dbPath, statement], {
      encoding: 'utf8', timeout: 5_000, maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return output ? JSON.parse(output) : [];
  };
  const sessionColumns = new Set(query('PRAGMA table_info(sessions)').map(row => row.name));
  if (!sessionColumns.has('id') || !sessionColumns.has('cwd')) throw new Error('Hermes session schema is unsupported.');
  const cwdColumn = sessionColumns.has('git_repo_root') ? "COALESCE(NULLIF(cwd, ''), git_repo_root)" : 'cwd';
  const session = query(`SELECT id, ${cwdColumn} AS cwd FROM sessions WHERE id = ${sql(binding.session_id)} LIMIT 1`)[0];
  if (!session || session.cwd !== binding.cwd) throw new Error('Hermes database binding does not match the selected session.');
  const columns = new Set(query('PRAGMA table_info(messages)').map(row => row.name));
  if (!['id', 'session_id', 'role', 'content', 'timestamp'].every(name => columns.has(name))) throw new Error('Hermes message schema is unsupported.');
  const active = columns.has('active') ? 'AND active = 1' : '';
  const extra = ['tool_name', 'compacted'].filter(name => columns.has(name));
  const where = `WHERE session_id = ${sql(binding.session_id)} ${active}`;
  const total = Number(query(`SELECT COUNT(*) AS count FROM messages ${where}`)[0]?.count) || 0;
  const rows = query(`SELECT id, role, content, timestamp${extra.length ? `, ${extra.join(', ')}` : ''} FROM messages ${where} ORDER BY timestamp DESC, id DESC LIMIT ${EVENT_LIMIT}`).reverse();
  const state = resultState();
  state.coverage.omitted_records = Math.max(0, total - rows.length);
  for (const row of rows) {
    if (!['user', 'assistant', 'tool'].includes(row.role)) { state.coverage.unsupported_records++; continue; }
    addMessage(state, binding, dbPath, { id: row.id, role: row.role, timestamp: row.timestamp,
      content: typeof row.content === 'string' ? row.content : '', reference: `messages:${row.id}`, tool: row.tool_name, compacted: Boolean(row.compacted) });
  }
  return finish(state);
}
