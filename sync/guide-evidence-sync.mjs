import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, isAbsolute } from 'node:path';
import { archiveMessageEvidence } from './project-evidence.mjs';
import { readCodexGuideEvents } from './guide-codex-evidence.mjs';

function contained(path, root) {
  const part = relative(realpathSync(root), realpathSync(path));
  return part === '' || (!part.startsWith('..') && !isAbsolute(part));
}

// Only the private vault receives message content. Public session objects are untouched.
export async function syncGuideEvidence(sessions, options = {}) {
  const catalog = options.catalog || [];
  const sourceRoot = options.sourceRoot || join(homedir(), '.codex', 'sessions');
  const report = {
    considered: 0,
    imported_sessions: 0,
    appended: 0,
    duplicates: 0,
    skipped: 0,
    unregistered_sessions: 0,
    invalid_bindings: 0,
    no_qualifying_messages: 0,
    failed: 0,
    coverage: 'Codex user/assistant text messages for registered sessions; tool payloads omitted and message text capped at 2,000 characters',
  };
  for (const session of sessions) {
    if (session.source !== 'codex') continue;
    const project = catalog.find(item => [item.name, ...(item.aliases || [])].some(name => String(name).toLowerCase() === String(session.project).toLowerCase()));
    if (!project) {
      report.skipped++;
      report.unregistered_sessions++;
      continue;
    }
    report.considered++;
    try {
      if (!session.raw_ref?.endsWith('.jsonl') || !session.cwd || !contained(session.raw_ref, sourceRoot) || !contained(session.cwd, project.root)) {
        report.skipped++;
        report.invalid_bindings++;
        continue;
      }
      const events = await readCodexGuideEvents(session.raw_ref, session);
      if (!events.length) {
        report.skipped++;
        report.no_qualifying_messages++;
        continue;
      }
      const stored = archiveMessageEvidence(events, { catalog: [project], dir: options.dir });
      report.imported_sessions++;
      report.appended += stored.appended;
      report.duplicates += stored.duplicates;
    } catch { report.failed++; }
  }
  return report;
}
