import { realpathSync, existsSync, statSync, readFileSync, mkdirSync, writeFileSync, renameSync, chmodSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join, relative, isAbsolute, sep } from 'node:path';
import { archiveMessageEvidence, projectForSession, resolveEvidenceDir } from './project-evidence.mjs';
import { readCodexGuideEvents } from './guide-codex-evidence.mjs';
import { readHarnessGuideEvents, readHermesGuideEvents } from './guide-harness-evidence.mjs';
import { assertHistoryOutsideWorktree } from './session-history.mjs';

function contained(path, root) {
  const part = relative(realpathSync(root), realpathSync(path));
  return part === '' || (part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part));
}

const hash = value => createHash('sha256').update(value).digest('hex');
const SUPPORTED = new Set(['codex', 'claude', 'cursor', 'hermes', 'antigravity']);
const blankCounts = () => ({ considered: 0, imported_sessions: 0, appended: 0, duplicates: 0, skipped: 0, unregistered_sessions: 0, invalid_bindings: 0, no_qualifying_messages: 0, unsupported_sessions: 0, failed: 0, unchanged_sessions: 0 });
const slug = value => value.replace(/[^a-zA-Z0-9]/g, '-').replace(/^-+|-+$/g, '');

function cursorProject(session, catalog, root) {
  if (session.cwd || !session.raw_ref || !root) return null;
  const workspace = relative(root, session.raw_ref).split(sep)[0];
  const matches = catalog.filter(project => isAbsolute(project.root || '') && slug(project.root) === workspace);
  return matches.length === 1 ? matches[0] : null;
}

function sourceSignature(path) {
  const stat = statSync(path);
  if (!stat.isFile()) throw new Error('Source is not a file.');
  return [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs];
}

function receiptsPresent(receipts, evidenceDir) {
  if (!Array.isArray(receipts) || !receipts.length) return false;
  return receipts.every(receipt => {
    if (!/^[a-z0-9][a-z0-9._-]*\/(codex|claude|cursor|hermes|antigravity)\/\d{4}-\d{2}\.jsonl$/.test(receipt.path || '')) return false;
    try {
      const stat = statSync(join(evidenceDir, 'events', receipt.path));
      return stat.isFile() && stat.dev === receipt.dev && stat.ino === receipt.ino && stat.size >= receipt.size;
    } catch { return false; }
  });
}

// Only the private vault receives message content. Public session objects are untouched.
export async function syncGuideEvidence(sessions, options = {}) {
  const catalog = options.catalog || [];
  const sourceRoots = {
    codex: options.sourceRoot || join(homedir(), '.codex', 'sessions'),
    claude: join(homedir(), '.claude', 'projects'), cursor: join(homedir(), '.cursor', 'projects'),
    antigravity: join(homedir(), '.gemini', 'antigravity'), hermes: join(homedir(), '.hermes', 'state.db'),
    ...options.sourceRoots,
  };
  const report = {
    schema_version: 1, ...blankCounts(), by_source: Object.create(null),
    coverage: 'Registered-session messages and supported tool-result text from Codex, Claude, Cursor, Hermes and Antigravity JSONL; text capped at 2,000 characters. Tool results are observations, assistant statements are claims. Aider Markdown and Antigravity database-only transcripts are unsupported.',
  };
  let checkpointPath;
  let checkpoints = {};
  const evidenceDir = resolveEvidenceDir(options.dir);
  if (options.checkpointDir) {
    assertHistoryOutsideWorktree(options.checkpointDir);
    checkpointPath = join(options.checkpointDir, 'guide-source-state.json');
    try { checkpoints = JSON.parse(readFileSync(checkpointPath, 'utf8')); } catch { /* A disposable cache may be rebuilt. */ }
    if (!checkpoints || typeof checkpoints !== 'object' || Array.isArray(checkpoints)) checkpoints = {};
  }
  const count = (source, field, amount = 1) => { report[field] += amount; report.by_source[source][field] += amount; };
  for (const session of sessions) {
    const source = session.source;
    report.by_source[source] ||= { ...blankCounts(), warnings: [], truncated_messages: 0, missing_timestamps: 0, malformed_records: 0, omitted_records: 0 };
    if (!SUPPORTED.has(source) || (source === 'antigravity' && !session.raw_ref?.endsWith('.jsonl'))) {
      count(source, 'skipped'); count(source, 'unsupported_sessions');
      continue;
    }
    let project = session.cwd ? projectForSession(session, catalog) : source === 'cursor' ? cursorProject(session, catalog, sourceRoots.cursor) : null;
    // Keep the existing Codex import contract: both the registered label and
    // real working directory must agree, including explicit aliases.
    if (source === 'codex' && project && ![project.name, ...(project.aliases || [])].some(name => String(name).toLowerCase() === String(session.project).toLowerCase())) project = null;
    if (!project) {
      count(source, 'skipped'); count(source, session.cwd && catalog.some(item => [item.name, ...(item.aliases || [])].includes(session.project)) ? 'invalid_bindings' : 'unregistered_sessions');
      continue;
    }
    count(source, 'considered');
    try {
      const binding = { ...session, cwd: session.cwd || project.root };
      const sourceRoot = sourceRoots[source];
      const validPath = source === 'hermes'
        ? realpathSync(session.raw_ref) === realpathSync(sourceRoot)
        : session.raw_ref?.endsWith('.jsonl') && contained(session.raw_ref, sourceRoot);
      const validAntigravityId = source !== 'antigravity' || relative(sourceRoot, session.raw_ref).split(sep)[1] === session.session_id.replace(/^antigravity-/, '');
      if (!validPath || !contained(binding.cwd, project.root) || !validAntigravityId) {
        count(source, 'skipped'); count(source, 'invalid_bindings');
        continue;
      }
      const cacheKey = hash(JSON.stringify(['guide-sources-v4', source, session.session_id, realpathSync(session.raw_ref), binding.cwd, binding.project, project.project_id, options.dir || null]));
      const signature = JSON.stringify([sourceSignature(session.raw_ref), ...(source === 'hermes' && existsSync(`${session.raw_ref}-wal`) ? [sourceSignature(`${session.raw_ref}-wal`)] : [])]);
      if (checkpointPath && checkpoints[cacheKey]?.signature === signature && receiptsPresent(checkpoints[cacheKey].receipts, evidenceDir)) {
        count(source, 'unchanged_sessions');
        const saved = checkpoints[cacheKey].coverage;
        if (saved) for (const field of ['truncated_messages', 'missing_timestamps', 'malformed_records', 'omitted_records']) report.by_source[source][field] += saved[field] || 0;
        report.by_source[source].warnings = [...new Set([...report.by_source[source].warnings, ...(saved?.warnings || [])])];
        continue;
      }
      const result = source === 'codex' ? { events: await readCodexGuideEvents(session.raw_ref, binding), coverage: {} }
        : source === 'hermes' ? readHermesGuideEvents(session.raw_ref, binding)
          : await readHarnessGuideEvents(session.raw_ref, binding);
      const { events, coverage } = result;
      if (source === 'codex') {
        coverage.truncated_messages = events.filter(event => event.metadata?.truncated).length;
        coverage.warnings = ['Codex message text and recorded tool-result text are available, capped at 2,000 characters. Long tool outputs retain their beginning and end with an omission marker. System/developer instructions, tool arguments and non-text payloads are omitted. A tool result does not establish overall test or deployment success.'];
      }
      for (const field of ['truncated_messages', 'missing_timestamps', 'malformed_records', 'omitted_records']) report.by_source[source][field] += coverage[field] || 0;
      report.by_source[source].warnings = [...new Set([...report.by_source[source].warnings, ...(coverage.warnings || [])])];
      if (!events.length) {
        count(source, 'skipped'); count(source, 'no_qualifying_messages');
        continue;
      }
      // Routing uses the registered project, while guide lookups retain the
      // exact source-session label used by the dashboard.
      const routed = events.map(event => ({ ...event, project: project.name, metadata: {
        ...event.metadata, project: session.project, historical_data: true, authorizes_actions: false,
        timestamp_basis: event.metadata?.timestamp_basis || 'message',
        evidence_kind: event.metadata?.evidence_kind || (/^(?:assistant|agent)/.test(event.event_type) ? 'agent_claim' : 'user_message'),
      } }));
      const afterSignature = JSON.stringify([sourceSignature(session.raw_ref), ...(source === 'hermes' && existsSync(`${session.raw_ref}-wal`) ? [sourceSignature(`${session.raw_ref}-wal`)] : [])]);
      if (afterSignature !== signature) throw new Error('Source changed during evidence collection.');
      const stored = archiveMessageEvidence(routed, { catalog: [project], dir: options.dir });
      count(source, 'imported_sessions'); count(source, 'appended', stored.appended); count(source, 'duplicates', stored.duplicates);
      if (checkpointPath) {
        const receipts = [...new Set(routed.map(event => `${project.project_id}/${source}/${new Date(event.timestamp).toISOString().slice(0, 7)}.jsonl`))].map(path => {
          const stat = statSync(join(evidenceDir, 'events', path));
          return { path, dev: stat.dev, ino: stat.ino, size: stat.size };
        });
        checkpoints[cacheKey] = { signature, coverage, receipts };
      }
    } catch { count(source, 'failed'); }
  }
  if (checkpointPath) {
    mkdirSync(options.checkpointDir, { recursive: true, mode: 0o700 });
    chmodSync(options.checkpointDir, 0o700);
    const temporary = `${checkpointPath}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(checkpoints), { mode: 0o600 });
    renameSync(temporary, checkpointPath);
    chmodSync(checkpointPath, 0o600);
  }
  return report;
}
