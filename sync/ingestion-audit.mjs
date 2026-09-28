import {
  closeSync, existsSync, openSync, readSync, readdirSync, statSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseSessionLines } from './parse-session.mjs';
import { projectFromCwd } from './session-utils.mjs';
import { scanCodexSessions } from './parse-codex.mjs';
import { DEFAULT_CURSOR_PROJECTS_DIR, scanCursorSessions } from './parse-cursor.mjs';
import { scanAntigravitySessions } from './parse-antigravity.mjs';
import { scanHermesSessions } from './parse-hermes.mjs';
import { readSessionHistorySnapshot } from './session-history.mjs';
import { AGENT_EVENT_SOURCES, projectForSession, queryAgentEvidence } from './project-evidence.mjs';
import { readProjectCatalog } from './project-control.mjs';
import { loadEnv } from './load-env.mjs';

const REPO_ROOT = join(import.meta.dirname, '..');
const CLAUDE_DIR = join(homedir(), '.claude', 'projects');
const CODEX_DIR = join(homedir(), '.codex', 'sessions');

function readJsonlLines(path) {
  const chunkSize = 1 << 20;
  const fd = openSync(path, 'r');
  try {
    const buffer = Buffer.allocUnsafe(chunkSize);
    const lines = [];
    let leftover = '';
    let bytes;
    while ((bytes = readSync(fd, buffer, 0, chunkSize, null)) > 0) {
      const parts = (leftover + buffer.toString('utf8', 0, bytes)).split('\n');
      leftover = parts.pop() ?? '';
      for (const line of parts) if (line) lines.push(line);
    }
    if (leftover) lines.push(leftover);
    return lines;
  } finally {
    closeSync(fd);
  }
}

function scanClaudeSessions(root = CLAUDE_DIR) {
  const sessions = [];
  const report = { files: 0, errors: 0, available: existsSync(root) };
  if (!report.available) return { sessions, report };

  function walk(directory, projectDirectory, isSubagent = false) {
    let entries;
    try { entries = readdirSync(directory); } catch { report.errors++; return; }
    for (const entry of entries) {
      const path = join(directory, entry);
      let stat;
      try { stat = statSync(path); } catch { continue; }
      if (stat.isDirectory()) {
        walk(path, projectDirectory, entry === 'subagents' || isSubagent);
      } else if (entry.endsWith('.jsonl')) {
        try {
          const parsed = parseSessionLines(readJsonlLines(path), projectDirectory);
          const fileKey = entry.slice(0, -'.jsonl'.length);
          for (const session of parsed) {
            session.session_id = isSubagent
              ? `agent-${fileKey}-${session.session_id}`
              : `${session.session_id}-${fileKey}`;
            session.is_subagent = isSubagent;
            session.source = 'claude';
            session.raw_ref = path;
            session.project = projectFromCwd(session.cwd) || session.project;
            sessions.push(session);
          }
          report.files++;
        } catch { report.errors++; }
      }
    }
  }

  let projects;
  try { projects = readdirSync(root); } catch { return { sessions, report: { ...report, errors: report.errors + 1 } }; }
  for (const projectDirectory of projects) {
    if (projectDirectory.startsWith('.')) continue;
    const path = join(root, projectDirectory);
    try {
      if (statSync(path).isDirectory()) walk(path, projectDirectory);
    } catch { report.errors++; }
  }
  return { sessions, report };
}

function deduplicateSessions(sessions) {
  const byId = new Map();
  for (const session of sessions) {
    const prior = byId.get(session.session_id);
    if (!prior || (session.message_count || 0) > (prior.message_count || 0)) {
      byId.set(session.session_id, session);
    }
  }
  return [...byId.values()];
}

function isRegistered(session, catalog) {
  return Boolean(projectForSession(session, catalog));
}

function sourceGroups(sessions) {
  return new Map(AGENT_EVENT_SOURCES.map((source) => [
    source,
    sessions.filter((session) => session.source === source),
  ]));
}

export function summarizeIngestionAudit({ now = new Date(), scanned = [], archived = [], catalog = [], evidenceCounts = {} } = {}) {
  const freshBySource = sourceGroups(scanned);
  const archiveBySource = sourceGroups(archived);
  const generatedAt = new Date(now).toISOString();
  const archiveUpdatedAt = archived.updatedAt || null;
  const archiveAgeDays = archiveUpdatedAt && Number.isFinite(Date.parse(archiveUpdatedAt))
    ? Math.max(0, Math.floor((Date.parse(generatedAt) - Date.parse(archiveUpdatedAt)) / 86_400_000))
    : null;

  return {
    generatedAt,
    mode: 'read-only local scan',
    cursorAdminApiQueried: false,
    archive: {
      updatedAt: archiveUpdatedAt,
      ageDays: archiveAgeDays,
      totalSessions: archived.length,
    },
    sources: AGENT_EVENT_SOURCES.map((source) => {
      const fresh = freshBySource.get(source) || [];
      const saved = archiveBySource.get(source) || [];
      const freshIds = new Set(fresh.map((session) => session.session_id));
      const savedIds = new Set(saved.map((session) => session.session_id));
      const freshRegistered = fresh.filter((session) => isRegistered(session, catalog));
      const savedRegistered = saved.filter((session) => isRegistered(session, catalog));
      const freshRegisteredSaved = freshRegistered.filter((session) => savedIds.has(session.session_id)).length;
      return {
        source,
        scannedSessions: fresh.length,
        scannedRegisteredSessions: freshRegistered.length,
        archivedSessions: saved.length,
        archivedRegisteredSessions: savedRegistered.length,
        registeredSessionsMissingFromArchive: freshRegistered.length - freshRegisteredSaved,
        archivedSessionsNotSeenInCurrentScan: saved.filter((session) => !freshIds.has(session.session_id)).length,
        evidenceEvents: evidenceCounts[source]?.events || 0,
        sessionSummaryEvents: evidenceCounts[source]?.sessionSummaries || 0,
      };
    }),
  };
}

export async function runIngestionAudit({ now = new Date() } = {}) {
  loadEnv(REPO_ROOT);
  delete process.env.CURSOR_ADMIN_API_KEY;
  const claude = scanClaudeSessions();
  let antigravityWarnings = 0;
  let hermesWarnings = 0;
  const priorWarn = console.warn;
  let antigravity;
  let hermes;
  try {
    console.warn = () => { antigravityWarnings++; };
    antigravity = scanAntigravitySessions(process.env.ANTIGRAVITY_DIR || join(homedir(), '.gemini', 'antigravity'));
    console.warn = () => { hermesWarnings++; };
    hermes = scanHermesSessions(process.env.HERMES_STATE_DB);
  } finally {
    console.warn = priorWarn;
  }
  const sessions = deduplicateSessions([
    ...claude.sessions,
    ...scanCodexSessions(CODEX_DIR),
    ...scanCursorSessions(process.env.CURSOR_PROJECTS_DIR || DEFAULT_CURSOR_PROJECTS_DIR),
    ...antigravity,
    ...hermes,
  ]);
  const archive = readSessionHistorySnapshot();
  const evidenceCounts = Object.fromEntries(AGENT_EVENT_SOURCES.map((source) => [source, {
    events: queryAgentEvidence({ source, limit: 1 }).total,
    sessionSummaries: queryAgentEvidence({ source, event_type: 'session_summary', limit: 1 }).total,
  }]));
  const result = summarizeIngestionAudit({
    now,
    scanned: sessions,
    archived: Object.assign([...archive.sessions], { updatedAt: archive.updatedAt }),
    catalog: readProjectCatalog(),
    evidenceCounts,
  });
  result.claudeScan = claude.report;
  result.parserWarningCounts = { antigravity: antigravityWarnings, hermes: hermesWarnings };
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runIngestionAudit()
    .then((report) => process.stdout.write(`${JSON.stringify(report, null, 2)}\n`))
    .catch(() => {
      process.stderr.write('Local ingestion audit failed; details were suppressed to protect session metadata.\n');
      process.exitCode = 1;
    });
}
