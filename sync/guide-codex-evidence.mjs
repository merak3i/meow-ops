import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import { redactEvidenceText } from './project-evidence.mjs';
import { boundGuideText, guideText, guideUserParts } from './guide-evidence-text.mjs';

const messageFingerprint = (role, timestamp, content) => createHash('sha256')
  .update(`${role}\0${timestamp}\0${content}`).digest('hex');

const TOOL_RESULT_TYPES = new Set(['function_call_output', 'custom_tool_call_output']);
const TOOL_CALL_TYPES = new Set(['function_call', 'custom_tool_call']);
const callId = value => typeof value === 'string' && value.trim() && value.length <= 500 ? value : null;

// Read one explicitly selected rollout. Tool outputs are recorded observations,
// never proof of overall success, and tool inputs are never retained or executed.
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
  const toolNames = new Map();
  const toolFingerprints = new Set();
  const toolEvents = [];
  const rolloutId = binding.session_id.startsWith('codex-') ? binding.session_id.slice(6) : binding.session_id;
  try {
    for await (const line of lines) {
      lineNumber++;
      let row;
      try { row = JSON.parse(line); } catch { continue; }
      if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
      if (row.type === 'session_meta') {
        if (row.payload?.id !== rolloutId || row.payload?.cwd !== binding.cwd) return [];
        matched = true;
        continue;
      }
      if (!matched || !Number.isFinite(Date.parse(row.timestamp))) continue;
      if (row.type === 'response_item' && TOOL_CALL_TYPES.has(row.payload?.type)) {
        const id = callId(row.payload.call_id);
        if (id && typeof row.payload.name === 'string' && /^[a-zA-Z0-9_./-]{1,120}$/.test(row.payload.name)) toolNames.set(id, row.payload.name);
        continue;
      }
      if (['response_item', 'event_msg'].includes(row.type) && TOOL_RESULT_TYPES.has(row.payload?.type)) {
        const id = callId(row.payload.call_id);
        const content = redactEvidenceText(guideText(row.payload.output));
        if (!id || !content.trim()) continue;
        // A call may emit multiple results. Preserve distinct chunks but merge
        // identical exported copies even when their envelope timestamps differ.
        const fingerprint = messageFingerprint('tool', id, content);
        if (toolFingerprints.has(fingerprint)) continue;
        toolFingerprints.add(fingerprint);
        toolEvents.push({
          source: 'codex', session_id: binding.session_id, project: binding.project,
          timestamp: row.timestamp, event_type: 'tool_result', actor: 'tool', content: boundGuideText(content),
          metadata: {
            project: binding.project, line: lineNumber, truncated: content.length > 2000,
            ...(content.length > 2000 ? { truncation_strategy: 'head-tail' } : {}),
            evidence_kind: 'tool_result', historical_data: true, authorizes_actions: false, timestamp_basis: 'message',
            source_event_id: `tool:${id}:${fingerprint}`, tool_call_id: id,
            ...(toolNames.has(id) ? { tool_name: toolNames.get(id) } : {}),
          },
          raw_ref: `${filePath}#L${lineNumber}`, sensitivity: 'private',
        });
        continue;
      }
      const responseMessage = row.type === 'response_item' && row.payload?.type === 'message' && ['user', 'assistant'].includes(row.payload.role);
      const legacyMessage = row.type === 'event_msg' && ['user_message', 'agent_message'].includes(row.payload?.type);
      if (!responseMessage && !legacyMessage) continue;
      const content = responseMessage
        ? guideText(row.payload.content)
        : guideText(row.payload.message ?? row.payload.content);
      if (typeof content !== 'string' || !content.trim()) continue;
      const target = responseMessage ? responseEvents : events;
      const role = responseMessage ? row.payload.role : row.payload.type === 'agent_message' ? 'assistant' : 'user';
      const parts = role === 'user' ? guideUserParts(content, row.payload.isMeta === true) : [{ content, kind: 'agent_claim' }];
      for (const part of parts) {
        const sanitizedContent = redactEvidenceText(part.content);
        if (!sanitizedContent.trim()) continue;
        const fingerprint = messageFingerprint(role, row.timestamp, sanitizedContent);
        if (responseMessage && responseFingerprints.has(fingerprint)) continue;
        target.push({
          source: 'codex', session_id: binding.session_id, project: binding.project,
          timestamp: row.timestamp, event_type: responseMessage ? `${row.payload.role}_message` : row.payload.type,
          actor: role, content: sanitizedContent.slice(0, 2000),
          metadata: {
            project: binding.project, line: lineNumber, truncated: sanitizedContent.length > 2000,
            evidence_kind: part.kind, historical_data: true, authorizes_actions: false, timestamp_basis: 'message',
          },
          raw_ref: `${filePath}#L${lineNumber}`, sensitivity: 'private',
        });
        if (responseMessage) responseFingerprints.add(fingerprint);
        else events.at(-1).fingerprint = fingerprint;
      }
    }
    const seen = new Set(responseFingerprints);
    const uniqueLegacy = events.filter(event => {
      if (seen.has(event.fingerprint)) return false;
      seen.add(event.fingerprint);
      return true;
    }).map(({ fingerprint, ...event }) => event);
    return [...responseEvents, ...uniqueLegacy, ...toolEvents].sort((a, b) => a.metadata.line - b.metadata.line);
  } finally { lines.close(); input.destroy(); }
}
