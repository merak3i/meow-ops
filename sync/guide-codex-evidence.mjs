import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import { redactEvidenceText } from './project-evidence.mjs';

const messageFingerprint = (role, timestamp, content) => createHash('sha256')
  .update(`${role}\0${timestamp}\0${content}`).digest('hex');

// Read one explicitly selected rollout, never instructions or arbitrary tool payloads.
// Imports are private evidence; this module does not write browser/export artifacts.
export async function readCodexGuideEvents(filePath, binding) {
  if (!binding?.session_id || !binding.project || !binding.cwd) throw new Error('An exact session, project and working directory are required.');
  const input = createReadStream(filePath, { encoding: 'utf8' });
  const lines = createInterface({ input, crlfDelay: Infinity });
  let matched = false;
  let lineNumber = 0;
  const events = [];
  const responseEvents = [];
  const responseFingerprints = new Set();
  const rolloutId = binding.session_id.startsWith('codex-') ? binding.session_id.slice(6) : binding.session_id;
  try {
    for await (const line of lines) {
      lineNumber++;
      let row;
      try { row = JSON.parse(line); } catch { continue; }
      if (row.type === 'session_meta') {
        if (row.payload?.id !== rolloutId || row.payload?.cwd !== binding.cwd) return [];
        matched = true;
        continue;
      }
      if (!matched || !Number.isFinite(Date.parse(row.timestamp))) continue;
      const responseMessage = row.type === 'response_item' && row.payload?.type === 'message' && ['user', 'assistant'].includes(row.payload.role);
      const legacyMessage = row.type === 'event_msg' && ['user_message', 'agent_message'].includes(row.payload?.type);
      if (!responseMessage && !legacyMessage) continue;
      const content = responseMessage
        ? (Array.isArray(row.payload.content) ? row.payload.content.filter(item => ['input_text', 'output_text'].includes(item.type) && typeof item.text === 'string').map(item => item.text).join('\n') : '')
        : row.payload.message;
      if (typeof content !== 'string' || !content.trim()) continue;
      const target = responseMessage ? responseEvents : events;
      const sanitizedContent = redactEvidenceText(content);
      const role = responseMessage ? row.payload.role : row.payload.type === 'agent_message' ? 'assistant' : 'user';
      const fingerprint = messageFingerprint(role, row.timestamp, sanitizedContent);
      target.push({
        source: 'codex', session_id: binding.session_id, project: binding.project,
        timestamp: row.timestamp, event_type: responseMessage ? `${row.payload.role}_message` : row.payload.type,
        content: sanitizedContent.slice(0, 2000),
        metadata: { project: binding.project, line: lineNumber, truncated: content.length > 2000 },
        raw_ref: `${filePath}#L${lineNumber}`, sensitivity: 'private',
      });
      if (responseMessage) responseFingerprints.add(fingerprint);
      else events.at(-1).fingerprint = fingerprint;
    }
    const seen = new Set(responseFingerprints);
    const uniqueLegacy = events.filter(event => {
      if (seen.has(event.fingerprint)) return false;
      seen.add(event.fingerprint);
      return true;
    }).map(({ fingerprint, ...event }) => event);
    return [...responseEvents, ...uniqueLegacy].sort((a, b) => a.metadata.line - b.metadata.line);
  } finally { lines.close(); input.destroy(); }
}
