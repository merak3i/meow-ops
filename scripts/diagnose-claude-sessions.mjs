#!/usr/bin/env node
// scripts/diagnose-claude-sessions.mjs — where do Claude Code sessions drop out?
//
// Read-only. Prints counts and reasons only: no titles, messages, paths or ids.
// Usage: node scripts/diagnose-claude-sessions.mjs [days=30]
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { claudeProjectRoots } from '../sync/claude-roots.mjs';
import { loadEnv } from '../sync/load-env.mjs';
import { parseSessionLines } from '../sync/parse-session.mjs';
import { readSessionHistorySnapshot } from '../sync/session-history.mjs';
import { readSourceDirectory, statSourcePath, walkSourceJsonl } from '../sync/source-discovery.mjs';

const ROOT = join(import.meta.dirname, '..');
loadEnv(ROOT);
const days = Number(process.argv[2] || 30);
const since = Date.now() - days * 86_400_000;
const roots = claudeProjectRoots();
const quiet = console.warn;

const files = { recent: 0, main: 0, subagent: 0, unreadable: 0, noSessions: 0, multiSession: 0 };
const sessions = { parsed: 0, inWindow: 0, outsideWindowByTimestamp: 0, ghost: 0, noModel: 0 };
const models = {};
const parsedIds = new Set();

for (const root of roots) {
  const dirs = readSourceDirectory(root, { optional: true })
    .filter((name) => !name.startsWith('.') && statSourcePath(join(root, name))?.isDirectory());
  for (const dir of dirs) {
    for (const { filePath, name, isSubagent } of walkSourceJsonl(join(root, dir))) {
      let stat;
      try { stat = statSync(filePath); } catch { files.unreadable++; continue; }
      if (stat.mtimeMs < since) continue;
      files.recent++;
      files[isSubagent ? 'subagent' : 'main']++;
      let parsed;
      try {
        console.warn = () => {};
        parsed = parseSessionLines(readFileSync(filePath, 'utf8').split('\n').filter(Boolean), dir);
      } catch {
        files.unreadable++;
        continue;
      } finally {
        console.warn = quiet;
      }
      if (parsed.length === 0) files.noSessions++;
      if (parsed.length > 1) files.multiSession++;
      const fileKey = name.replace('.jsonl', '');
      for (const s of parsed) {
        sessions.parsed++;
        const activity = Date.parse(s.ended_at || s.started_at);
        if (activity >= since) sessions.inWindow++; else sessions.outsideWindowByTimestamp++;
        if (s.is_ghost) sessions.ghost++;
        if (!s.model) sessions.noModel++;
        models[s.model || '(none)'] = (models[s.model || '(none)'] || 0) + 1;
        parsedIds.add(isSubagent ? `agent-${fileKey}-${s.session_id}` : `${s.session_id}-${fileKey}`);
      }
    }
  }
}

const archive = readSessionHistorySnapshot();
const archived = archive.sessions.filter((s) => (s.source || 'claude') === 'claude');
const archivedIds = new Set(archived.map((s) => s.session_id));
const archivedInWindow = archived.filter((s) => Date.parse(s.ended_at || s.started_at) >= since);
let missingFromArchive = 0;
for (const id of parsedIds) if (!archivedIds.has(id)) missingFromArchive++;

console.log(JSON.stringify({
  window_days: days,
  roots: roots.length,
  archive_dir_configured: Boolean(process.env.MEOW_SESSION_HISTORY_DIR),
  files,
  sessions,
  models,
  archive: {
    updated_at: archive.updatedAt,
    claude_total: archived.length,
    claude_in_window: archivedInWindow.length,
    claude_in_window_main: archivedInWindow.filter((s) => !s.is_subagent).length,
    claude_in_window_ghost: archivedInWindow.filter((s) => s.is_ghost).length,
    parsed_but_missing_from_archive: missingFromArchive,
  },
}, null, 2));
