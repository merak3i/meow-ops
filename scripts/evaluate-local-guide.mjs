// Private evaluation against a frozen local capture; no cloud/model fallback.
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { assertHistoryOutsideWorktree, readSessionHistorySnapshot } from '../sync/session-history.mjs';
import { queryAgentEvidence } from '../sync/project-evidence.mjs';
import { answerSanctumGuide } from '../sync/sanctum-guide.mjs';
import { explainGuideEvidence, GUIDE_LOCAL_MODEL } from '../sync/sanctum-local-model.mjs';

const root = resolve(process.argv[2] || '');
if (!process.argv[2]) throw new Error('Provide the private validation capture directory.');
assertHistoryOutsideWorktree(root);
const snapshot = readSessionHistorySnapshot({ dir: join(root, 'session-history') });
const evidenceDir = join(root, 'evidence');
const receipts = queryAgentEvidence({ dir: evidenceDir, source: 'codex', event_type: 'tool_result', limit: 500 });
const candidates = new Map();
for (const event of receipts.items) {
  const key = JSON.stringify([event.session_id, event.metadata?.project]);
  candidates.set(key, (candidates.get(key) || 0) + 1);
}
const selection = [...candidates].sort((a, b) => b[1] - a[1]).map(([key]) => {
  const [id, project] = JSON.parse(key);
  return snapshot.sessions.find(row => row.source === 'codex' && row.session_id === id && row.project === project);
}).find(Boolean);
if (!selection) throw new Error('No exactly bound imported tool receipts are available for evaluation.');
const questions = [
  'Summarize what the tools actually reported in two short sentences.',
  'Did all tests pass, or only the tests that ran?',
  'The assistant says it deployed. Which receipt proves that?',
  'What caused the sync failure? Separate recorded facts from inference.',
  'Logs stop mid-run. Is the work finished, blocked or unknown?',
];
const runs = [];
for (const question of questions) {
  const started = performance.now();
  const answer = answerSanctumGuide({ question, session_id: selection.session_id, project: selection.project }, snapshot, new Date(),
    options => queryAgentEvidence({ ...options, dir: evidenceDir }));
  const explanation = answer.kind === 'observed-events' ? await explainGuideEvidence(question, answer.evidence, {
    env: { MEOW_GUIDE_LOCAL_MODEL: GUIDE_LOCAL_MODEL, MEOW_GUIDE_OLLAMA_URL: 'http://127.0.0.1:11435' },
  }) : null;
  const result = { question, elapsedMs: Math.round(performance.now() - started), kind: answer.kind,
    explanation, evidence: answer.evidence, unknowns: answer.unknowns };
  runs.push(result);
  writeFileSync(join(root, 'guide-evaluation.json'), JSON.stringify({ schemaVersion: 1, recordedAt: new Date().toISOString(),
    selection: { session_id: selection.session_id, source: selection.source, project: selection.project }, runs }, null, 2), { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ question, elapsedMs: result.elapsedMs, evidenceRecords: result.evidence.length, kind: result.kind,
    modelStatus: explanation?.status || 'not-invoked', answer: explanation?.answer || answer.answer })}\n`);
}
