import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

// Storage enums checked against the matching native transcript step_index.
// Unknown enums retain their step/time without inventing a role or tool.
const STEP_TYPES = {
  5: ['CODE_ACTION', 'MODEL'], 7: ['GREP_SEARCH', 'MODEL'],
  8: ['VIEW_FILE', 'MODEL'], 9: ['LIST_DIRECTORY', 'MODEL'],
  14: ['USER_INPUT', 'USER_EXPLICIT'], 15: ['PLANNER_RESPONSE', 'MODEL'],
  17: ['ERROR_MESSAGE', 'SYSTEM'], 21: ['RUN_COMMAND', 'MODEL'],
  23: ['CHECKPOINT', 'SYSTEM'], 31: ['READ_URL_CONTENT', 'MODEL'],
  33: ['SEARCH_WEB', 'MODEL'], 85: ['BROWSER_SUBAGENT', 'MODEL'],
  90: ['EPHEMERAL_MESSAGE', 'SYSTEM'], 98: ['CONVERSATION_HISTORY', 'SYSTEM'],
  101: ['SYSTEM_MESSAGE', 'SYSTEM'], 127: ['INVOKE_SUBAGENT', 'MODEL'],
  132: ['GENERIC', 'MODEL'],
};

// Cascade step metadata field 1 is a protobuf Timestamp. Decode only that
// field; payloads, prompts, permissions and generation metadata stay unread.
export function databaseStepTime(hex) {
  if (typeof hex !== 'string' || hex.length > 1_048_576 || !/^(?:[\da-f]{2})+$/i.test(hex)) return null;
  const bytes = Buffer.from(hex, 'hex');
  let offset = 0;
  function varint(limit) {
    let value = 0n;
    for (let shift = 0n; shift < 70n; shift += 7n) {
      if (offset >= limit) throw new Error('Truncated timestamp');
      const byte = bytes[offset++];
      value |= BigInt(byte & 127) << shift;
      if (byte < 128) {
        if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Timestamp overflow');
        return Number(value);
      }
    }
    throw new Error('Invalid timestamp');
  }
  try {
    if (varint(bytes.length) !== 10) return null;
    const length = varint(bytes.length);
    const end = offset + length;
    if (end > bytes.length) return null;
    let seconds = null;
    let nanos = 0;
    while (offset < end) {
      const tag = varint(end);
      const value = varint(end);
      if (tag === 8) seconds = value;
      else if (tag === 16) nanos = value;
      else return null;
    }
    if (seconds === null || nanos >= 1_000_000_000) return null;
    // Native JSONL records have second precision; preserve that granularity.
    return new Date(seconds * 1000).toISOString();
  } catch {
    return null;
  }
}

export function readAntigravityDatabase(databasePath) {
  if (!databasePath || !existsSync(databasePath)) return { status: 'not-found', steps: [] };
  try {
    const output = execFileSync('sqlite3', ['-readonly', '-json', databasePath,
      'SELECT idx, step_type, hex(metadata) AS metadata FROM steps ORDER BY idx'], {
      encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 10_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const rows = JSON.parse(output || '[]');
    if (!Array.isArray(rows)) throw new Error('Invalid database result');
    const steps = rows.map(row => {
      const created_at = databaseStepTime(row.metadata);
      if (!Number.isSafeInteger(row.idx) || row.idx < 0 || !created_at) throw new Error('Unsupported step metadata');
      const [type, source] = STEP_TYPES[row.step_type] || ['UNKNOWN_STEP', 'UNKNOWN'];
      return { step_index: row.idx, created_at, type, source };
    });
    return { status: 'read', steps };
  } catch {
    // Do not print database errors: they can contain paths or session content.
    return { status: 'unreadable', steps: [] };
  }
}
