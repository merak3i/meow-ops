// Export real Claude Code session data to a static JSON file.
// No Supabase needed — generates public/data/sessions.json for the dashboard.
// Run: node sync/export-local.mjs
// Run: node sync/export-local.mjs --push   (also commit + push to GitHub)

import { writeFileSync, statSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { parseClaudeFile }  from './parse-session.mjs';
import { scanCodexSessions }  from './parse-codex.mjs';
import { scanCursorSessions, DEFAULT_CURSOR_PROJECTS_DIR } from './parse-cursor.mjs';
import { enrichCursorSessions, emptyCursorUsageReport } from './cursor-admin-usage.mjs';
import { scanAiderProjects }  from './parse-aider.mjs';
import { scanAntigravitySessions, antigravityCoverage, DEFAULT_ANTIGRAVITY_DIR } from './parse-antigravity.mjs';
import { scanHermesModelUsage, scanHermesSessions, DEFAULT_HERMES_DB } from './parse-hermes.mjs';
import { readSessionHistorySnapshot, updateSessionHistory } from './session-history.mjs';
import { buildSessionRollups } from './session-rollups.mjs';
import { archiveSessionEvidence } from './project-evidence.mjs';
import { readProjectCatalog } from './project-control.mjs';
import { syncGuideEvidence } from './guide-evidence-sync.mjs';
import { buildWeeklyEvidencePatterns } from './weekly-evidence-patterns.mjs';
import { loadEnv } from './load-env.mjs';
import { readCursorAdminApiKey } from './cursor-credential.mjs';
import { publishSnapshot } from './snapshot-generation.mjs';
import { acquireProcessLock } from './process-lock.mjs';
import { readSourceDirectory, statSourcePath, walkSourceJsonl } from './source-discovery.mjs';

loadEnv(join(import.meta.dirname, '..'));
const syncLock = acquireProcessLock(join(process.env.MEOW_RUNTIME_DIR || join(process.env.HOME, '.meow-ops', 'runtime'), 'sync.lock'), {
  inheritedToken: process.env.MEOW_SYNC_LOCK_TOKEN,
});
if (!syncLock) throw new Error('Another local collector is running. Retry after it finishes.');
process.once('exit', () => syncLock.release());

const CLAUDE_DIR = join(process.env.HOME, '.claude', 'projects');
const CODEX_DIR  = join(process.env.HOME, '.codex', 'sessions');
// Google Antigravity agent sessions (~/.gemini/antigravity/brain/<uuid>/...).
// Override the root with ANTIGRAVITY_DIR.
const ANTIGRAVITY_DIR = process.env.ANTIGRAVITY_DIR || DEFAULT_ANTIGRAVITY_DIR;
const HERMES_STATE_DB = process.env.HERMES_STATE_DB || DEFAULT_HERMES_DB;

const CHECKPOINT_DIR = join(process.env.MEOW_RUNTIME_DIR || join(process.env.HOME, '.meow-ops', 'runtime'), 'parser-checkpoints');
const collection = {};
function recordCoverage(source, report) {
  const current = collection[source] ||= { discovered: 0, parsed: 0, cached: 0, failed: 0, discoveryFailures: 0, bytesRead: 0, malformedLines: 0, pendingBytes: 0 };
  if (report.stage === 'discovery') current.discoveryFailures++;
  else current.discovered++;
  if (report.mode === 'failed') current.failed++;
  else if (report.mode === 'cached') current.cached++;
  else current.parsed++;
  for (const field of ['bytesRead', 'malformedLines', 'pendingBytes']) current[field] += report[field] || 0;
}

// Optional extra sources — configure via env vars
// CURSOR_PROJECTS_DIR — Cursor agent-transcripts root, e.g. ~/.cursor/projects
// CURSOR_ADMIN_API_KEY — optional injected team Admin API credential
// AIDER_PROJECTS — colon-separated list of project dirs containing .aider.chat.history.md
const CURSOR_PROJECTS_DIR = process.env.CURSOR_PROJECTS_DIR || DEFAULT_CURSOR_PROJECTS_DIR;
const AIDER_PROJECT_DIRS = process.env.AIDER_PROJECTS
  ? process.env.AIDER_PROJECTS.split(':').filter(Boolean)
  : [];
const OUTPUT_DIR = process.env.MEOW_DATA_DIR || join(import.meta.dirname, '..', 'public', 'data');
const OUTPUT_FILE = join(OUTPUT_DIR, 'sessions.json');
// Lightweight compatibility preview only. Full retention lives in the uncapped
// local archive and browser detail views query it in bounded pages.
const SESSION_PREVIEW_LIMIT = parseInt(
  process.env.MEOW_SESSION_PREVIEW_LIMIT || process.env.MEOW_MAX_SESSIONS || '1000',
  10,
);

console.log('🐱 Meow Operations — Local Export\n');

if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

let allSessions = [];
let fileCount = 0;
let errorCount = 0;
const claudeDiscovery = { onCoverage: report => {
  recordCoverage('claude', report);
  if (report.mode === 'failed') errorCount++;
} };
const projectDirs = readSourceDirectory(CLAUDE_DIR, { ...claudeDiscovery, optional: true }).filter((name) => {
  if (name.startsWith('.')) return false;
  return statSourcePath(join(CLAUDE_DIR, name), claudeDiscovery)?.isDirectory();
});

console.log(`Scanning ${projectDirs.length} project directories...\n`);

function walkJsonl(dir, projectDir) {
  for (const { filePath: full, name: entry, isSubagent } of walkSourceJsonl(dir, claudeDiscovery)) {
    try {
      const sessions = parseClaudeFile(full, projectDir, {
        checkpointDir: join(CHECKPOINT_DIR, 'claude'), onCoverage: report => recordCoverage('claude', report),
      });
      // Each file = one logical session entry. Make the session_id file-unique.
      // Keep the real session id in the key so two session ids in one
      // subagent file can't collide into a single "agent-<file>" row.
      for (const s of sessions) {
        const fileKey = entry.replace('.jsonl', '');
        s.session_id = isSubagent ? `agent-${fileKey}-${s.session_id}` : `${s.session_id}-${fileKey}`;
        s.is_subagent = isSubagent;
        s.source = 'claude';
        s.raw_ref = full;
        if (isSubagent) s.entrypoint = 'subagent';
      }
      allSessions.push(...sessions);
      fileCount++;
    } catch {
      errorCount++;
    }
  }
}

for (const dir of projectDirs) {
  const dirPath = join(CLAUDE_DIR, dir);
  try {
    walkJsonl(dirPath, dir);
  } catch {
    errorCount++;
  }
}

console.log(`Parsed ${fileCount} files (${errorCount} errors)`);
console.log(`Found ${allSessions.length} total sessions`);

// Refine the project name using `cwd` (current working directory) captured
// per-session, which is more reliable than parsing the encoded folder name.
//
// Examples (with HOME=/Users/alice):
//   /Users/alice/projects/my-app             → "my-app"
//   /Users/alice/work/Acme Project (AP)      → "AP"            (parens picked)
//   /Users/alice/.claude/worktrees/feature-x → "worktree/feature-x"
//   /Users/alice                             → "home"
function projectFromCwd(cwd) {
  if (!cwd) return null;
  const parts = cwd.split('/').filter(Boolean);

  // Worktrees: /<...>/.claude/worktrees/<name>
  const claudeIdx = parts.indexOf('.claude');
  if (claudeIdx >= 0 && parts[claudeIdx + 1] === 'worktrees') {
    return 'worktree/' + (parts[claudeIdx + 2] || 'unknown');
  }

  // Home directory itself (one level under /Users)
  if (parts.length === 2 && parts[0] === 'Users') return 'home';

  // Last meaningful folder, with parens-suffix preferred (e.g. "Project Name (XYZ)" → "XYZ")
  const last = parts[parts.length - 1] || 'home';
  const parenMatch = last.match(/\(([^)]+)\)/);
  return parenMatch ? parenMatch[1] : last;
}

function toPublicSession(session) {
  const {
    cwd,
    session_title,
    first_user_message,
    raw_ref,
    ...safe
  } = session;
  return safe;
}

for (const s of allSessions) {
  const refined = projectFromCwd(s.cwd);
  if (refined) s.project = refined;
}

// Merge Codex sessions
if (existsSync(CODEX_DIR)) {
  const codexSessions = scanCodexSessions(CODEX_DIR, {
    checkpointDir: join(CHECKPOINT_DIR, 'codex'), onCoverage: report => recordCoverage('codex', report),
  });
  console.log(`Found ${codexSessions.length} Codex session(s)`);
  allSessions.push(...codexSessions);
} else {
  console.log('No Codex sessions directory found — skipping');
}

// Merge Cursor sessions from local agent transcripts. Model/token/cost stay
// unavailable unless the operator opts into the official Admin API enricher.
let cursorUsageReport = emptyCursorUsageReport({ status: 'skipped' });
if (process.env.MEOW_SKIP_CURSOR === '1') {
  console.log('Cursor collection excluded by operator configuration');
} else {
  const cursorSessions = scanCursorSessions(CURSOR_PROJECTS_DIR, {
    checkpointDir: join(CHECKPOINT_DIR, 'cursor'), onCoverage: report => recordCoverage('cursor', report),
  });
  if (cursorSessions.length > 0) {
    console.log(`Found ${cursorSessions.length} Cursor session(s) (local transcripts; usage not exposed on disk)`);
  } else {
    console.log('Cursor projects dir found but no agent transcripts parsed — skipping');
  }
  const enriched = await enrichCursorSessions(cursorSessions, {
    apiKey: readCursorAdminApiKey(),
    historyPath: join(process.env.MEOW_RUNTIME_DIR || join(process.env.HOME, '.meow-ops', 'runtime'), 'cursor-usage', 'history.json'),
    previousSessions: readSessionHistorySnapshot().sessions.filter(session => session.source === 'cursor'),
  });
  cursorUsageReport = enriched.report;
  if (enriched.report.status === 'missing-credential') {
    console.log('Cursor Admin API credential unavailable; local transcript collection is independent.');
  } else if (enriched.report.status === 'ok') {
    console.log(`Cursor Admin API: matched ${enriched.report.matched_sessions} session(s), unmatched ${enriched.report.unmatched_events} event(s) kept as aggregate usage`);
  } else {
    console.log(`Cursor Admin API enrichment skipped (${enriched.report.status})`);
  }
  allSessions.push(...enriched.sessions);
}

// Merge Aider sessions (opt-in: AIDER_PROJECTS env var must be set)
if (AIDER_PROJECT_DIRS.length > 0) {
  const aiderSessions = scanAiderProjects(AIDER_PROJECT_DIRS);
  console.log(`Found ${aiderSessions.length} Aider session(s)`);
  allSessions.push(...aiderSessions);
} else {
  console.log('No Aider projects configured — skipping (set AIDER_PROJECTS=path1:path2 to enable)');
}

// Merge Google Antigravity sessions. Time/tools/project are real; token, model,
// and cost are not exposed by Antigravity locally, so those sessions carry
// usage_available=false and are shown as "usage not available" (never faked).
if (ANTIGRAVITY_DIR && existsSync(ANTIGRAVITY_DIR)) {
  const agSessions = scanAntigravitySessions(ANTIGRAVITY_DIR);
  if (agSessions.length > 0) {
    console.log(`Found ${agSessions.length} Antigravity session(s) (usage not exposed by Antigravity)`);
    allSessions.push(...agSessions);
  } else {
    console.log('Antigravity dir found but no sessions parsed — skipping');
  }
} else {
  console.log('No Antigravity directory found — skipping (set ANTIGRAVITY_DIR to enable)');
}

// Merge Hermes Agent sessions from its canonical local SQLite state. The
// parser opens the database read-only and preserves Hermes' own usage values.
let hermesModelUsageReport = { status: 'not-found', sessions: 0, models: 0, totals: {}, by_model: [] };
if (HERMES_STATE_DB && existsSync(HERMES_STATE_DB)) {
  const hermesSessions = scanHermesSessions(HERMES_STATE_DB);
  hermesModelUsageReport = scanHermesModelUsage(HERMES_STATE_DB);
  if (hermesSessions.length > 0) {
    console.log(`Found ${hermesSessions.length} Hermes session(s)`);
    allSessions.push(...hermesSessions);
  } else {
    console.log('Hermes state database found but no sessions parsed — skipping');
  }
} else {
  console.log('No Hermes state database found — skipping (set HERMES_STATE_DB to enable)');
}

// De-duplicate by session_id (real dedupe, not just a rename). A re-run or an
// overlapping scan can surface the same id twice; keep the richer record
// (more messages) so a partial re-read never shrinks a session.
const byId = new Map();
for (const s of allSessions) {
  const key = JSON.stringify([s.source || 'claude', s.session_id]);
  const prev = byId.get(key);
  if (!prev || (s.message_count || 0) > (prev.message_count || 0)) byId.set(key, s);
}
const allUnique = [...byId.values()];
const sourceHealth = Object.fromEntries([
  ['claude', existsSync(CLAUDE_DIR) ? 'available' : 'not-found'],
  ['codex', existsSync(CODEX_DIR) ? 'available' : 'not-found'],
  ['hermes', existsSync(HERMES_STATE_DB) ? 'available' : 'not-found'],
  ['antigravity', ANTIGRAVITY_DIR && existsSync(ANTIGRAVITY_DIR) ? 'available' : 'not-found'],
  ['aider', AIDER_PROJECT_DIRS.length ? 'available' : 'not-configured'],
  ['cursor', process.env.MEOW_SKIP_CURSOR === '1' ? 'excluded'
    : CURSOR_PROJECTS_DIR && existsSync(CURSOR_PROJECTS_DIR) ? 'available' : 'not-found'],
].map(([source, state]) => {
  const rows = allUnique.filter((session) => session.source === source);
  const latest = rows.map((session) => session.ended_at || session.started_at).filter(Boolean).sort().at(-1) || null;
  const coverage = source === 'antigravity' ? antigravityCoverage(ANTIGRAVITY_DIR, rows) : null;
  const parsedCoverage = collection[source];
  const gaps = (coverage && (coverage.unreadable_stores || coverage.unreadable_databases || coverage.unknown_steps))
    || parsedCoverage?.failed || parsedCoverage?.malformedLines || parsedCoverage?.pendingBytes;
  return [source, {
    state: parsedCoverage?.failed ? 'collected-with-gaps'
      : state === 'available' ? (gaps ? 'collected-with-gaps' : rows.length ? 'collected' : 'no-readable-sessions') : state,
    sessions: rows.length, latest, ...(coverage ? { coverage } : {}),
    ...(parsedCoverage ? { collection: parsedCoverage } : {}),
  }];
}));
const dupCount = allSessions.length - allUnique.length;
console.log(`Total unique session entries: ${allUnique.length}${dupCount > 0 ? ` (deduped ${dupCount})` : ''}`);

// Preserve private project evidence before content-bearing labels are removed
// from the public dashboard artifact. Only registered projects and supported
// agent sources enter the private vault.
let guideEvidenceCoverage = { status: 'unavailable', by_source: {} };
try {
  const catalog = readProjectCatalog();
  const guideEvidence = await syncGuideEvidence(allUnique, {
    catalog, checkpointDir: join(CHECKPOINT_DIR, 'guide-evidence'),
    sourceRoots: { codex: CODEX_DIR, claude: CLAUDE_DIR, cursor: CURSOR_PROJECTS_DIR, antigravity: ANTIGRAVITY_DIR, hermes: HERMES_STATE_DB },
  });
  guideEvidenceCoverage = {
    status: guideEvidence.failed || guideEvidence.skipped ? 'partial' : 'available',
    by_source: guideEvidence.by_source,
    covered_sessions: guideEvidence.imported_sessions + guideEvidence.unchanged_sessions,
    excluded_sessions: guideEvidence.skipped,
    limitations: guideEvidence.coverage,
  };
  console.log(`Guide evidence: ${guideEvidence.appended} new message(s), ${guideEvidence.duplicates} duplicate(s), ${guideEvidence.imported_sessions}/${guideEvidence.considered} registered session(s) imported, ${guideEvidence.skipped} skipped (${guideEvidence.unregistered_sessions} unregistered, ${guideEvidence.invalid_bindings} invalid binding, ${guideEvidence.no_qualifying_messages} without qualifying messages), ${guideEvidence.failed} unreadable session(s); ${guideEvidence.coverage}`);
  const evidence = archiveSessionEvidence(allUnique, { catalog });
  console.log(`Project evidence: ${evidence.appended} new event(s), ${evidence.duplicates} duplicate(s), ${evidence.skipped} unregistered/unsupported session(s)`);
} catch (error) {
  console.warn(`Project evidence archive skipped: ${error instanceof Error ? error.message : String(error)}`);
}

// Sort by most-recent activity (ended_at) descending.
// This ensures long-running Claude sessions still active today aren't
// pushed below stale sessions just because they started weeks ago.
allUnique.sort((a, b) => {
  const aTime = new Date(a.ended_at || a.started_at);
  const bTime = new Date(b.ended_at || b.started_at);
  return bTime - aTime;
});

const publicSessions = allUnique.map(toPublicSession);
const archive = updateSessionHistory(publicSessions, { recoverIncompleteTail: true });
const archiveSnapshot = readSessionHistorySnapshot();
const completeSessions = archiveSnapshot.sessions;
const latest = completeSessions.slice(0, SESSION_PREVIEW_LIMIT);

console.log(`Archived ${archive.total} sessions (${archive.appended} new or changed revision${archive.appended === 1 ? '' : 's'})`);
if (archive.thresholdExceeded) {
  console.warn(`Archive is above the configurable ${archive.warningThreshold.toLocaleString()}-session safety threshold; retention remains uncapped.`);
}
console.log(`Exporting ${latest.length}-session compatibility preview\n`);

// Stats — totals are over ALL sessions (not the capped export slice), so the
// headline numbers match cost-summary.json rather than under-reporting when
// more than SESSION_PREVIEW_LIMIT sessions exist.
const totalTokens = completeSessions.reduce((a, s) => a + (s.total_tokens || 0), 0);
const byProject = {};
const byCat = {};
const byModel = {};
for (const s of completeSessions) {
  byProject[s.project] = (byProject[s.project] || 0) + 1;
  byCat[s.cat_type] = (byCat[s.cat_type] || 0) + 1;
  if (s.model) byModel[s.model] = (byModel[s.model] || 0) + 1;
}

console.log('By project:');
for (const [p, c] of Object.entries(byProject).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  console.log(`  ${p}: ${c}`);
}
console.log('\nBy cat type:');
for (const [t, c] of Object.entries(byCat).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${t}: ${c}`);
}
console.log('\nBy model:');
for (const [m, c] of Object.entries(byModel).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${m}: ${c}`);
}
console.log(`\nTotal tokens: ${(totalTokens / 1_000_000).toFixed(2)}M`);

writeFileSync(OUTPUT_FILE, JSON.stringify(latest, null, 0));
const fileSize = (statSync(OUTPUT_FILE).size / 1024).toFixed(1);
console.log(`\nWrote ${OUTPUT_FILE} (${fileSize} KB)`);

// ── Cost summary — computed from ALL sessions (no 250 cap) ──────────────────
// This lets the dashboard show accurate today/weekly/monthly/yearly spend
// without needing to load thousands of sessions into the browser.
{
  // Day/week/month boundaries use the operator's local timezone (what the
  // laptop clock shows), overridable with MEOW_TZ. Previously hardcoded to IST.
  const TZ = process.env.MEOW_TZ
    || Intl.DateTimeFormat().resolvedOptions().timeZone
    || 'UTC';
  const rollups = buildSessionRollups(completeSessions, { timeZone: TZ });

  function istDate(iso) {
    return new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });
  }

  function activityTs(s) { return s.ended_at || s.started_at; }

  function emptyBucket() {
    return {
      cost: null, estimated_cost_usd: null, observed_cost_usd: null,
      estimated_cost_sessions: 0, observed_cost_sessions: 0, unavailable_cost_sessions: 0,
      tokens: 0, sessions: 0, duration_seconds: 0,
    };
  }

  function addSession(acc, s) {
    const validAmount = value => value != null && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0;
    const estimate = validAmount(s.estimated_cost_usd)
      && !['unknown', 'default', 'family', 'unavailable'].includes(s.pricing_source)
      && s.cost_available !== false ? Number(s.estimated_cost_usd) : null;
    const observed = validAmount(s.observed_cost_usd) ? Number(s.observed_cost_usd) : null;
    if (estimate !== null) {
      acc.estimated_cost_usd = (acc.estimated_cost_usd ?? 0) + estimate;
      acc.cost = acc.estimated_cost_usd;
      acc.estimated_cost_sessions++;
    }
    if (observed !== null) {
      acc.observed_cost_usd = (acc.observed_cost_usd ?? 0) + observed;
      acc.observed_cost_sessions++;
    }
    if (estimate === null && observed === null) acc.unavailable_cost_sessions++;
    acc.tokens += s.total_tokens || 0;
    acc.sessions += 1;
    acc.duration_seconds += s.duration_seconds || 0;
    return acc;
  }

  const now      = new Date();
  const todayStr = now.toLocaleDateString('en-CA', { timeZone: TZ });

  // Calendar week start (Monday) in the operator's timezone
  const nowIST       = new Date(now.toLocaleString('en-US', { timeZone: TZ }));
  const dowIST       = nowIST.getDay(); // 0=Sun
  const daysToMon    = dowIST === 0 ? 6 : dowIST - 1;
  const thisWeekStart = new Date(nowIST);
  thisWeekStart.setDate(nowIST.getDate() - daysToMon);
  thisWeekStart.setHours(0, 0, 0, 0);

  const lastWeekEnd   = new Date(thisWeekStart.getTime() - 1);
  const lastWeekStart = new Date(thisWeekStart);
  lastWeekStart.setDate(thisWeekStart.getDate() - 7);

  // Calendar month
  const thisMonthStart = new Date(nowIST.getFullYear(), nowIST.getMonth(), 1);
  const lastMonthStart = new Date(nowIST.getFullYear(), nowIST.getMonth() - 1, 1);
  const lastMonthEnd   = new Date(nowIST.getFullYear(), nowIST.getMonth(), 0, 23, 59, 59, 999);

  // Calendar year
  const thisYearStart = new Date(nowIST.getFullYear(), 0, 1);
  const lastYearStart = new Date(nowIST.getFullYear() - 1, 0, 1);
  const lastYearEnd   = new Date(nowIST.getFullYear() - 1, 11, 31, 23, 59, 59, 999);

  function bucket(sessions, start, end) {
    return sessions.reduce((acc, s) => {
      const d = new Date(activityTs(s));
      if (d >= start && d <= end) {
        addSession(acc, s);
      }
      return acc;
    }, emptyBucket());
  }

  // Per-source this-month split
  const sourceMonth = {};
  for (const s of completeSessions) {
    const d = new Date(activityTs(s));
    if (d < thisMonthStart) continue;
    const src = s.source || 'claude';
    if (!sourceMonth[src]) sourceMonth[src] = emptyBucket();
    addSession(sourceMonth[src], s);
  }

  // Today bucket (IST day match)
  const todayBucket = completeSessions.reduce((acc, s) => {
    if (istDate(activityTs(s)) === todayStr) {
      addSession(acc, s);
    }
    return acc;
  }, emptyBucket());

  // ── Per-day summary (ALL sessions, no 250/1000 cap) ──────────────────────────
  // Used by ByDay chart and CostTracker so they show accurate data regardless
  // of how many sessions are in sessions.json.
  const daily_summary = rollups.daily.map((d) => ({
    date: d.key,
    session_count: d.sessions,
    total_input_tokens: d.input_tokens,
    total_output_tokens: d.output_tokens,
    total_cache_creation: d.cache_creation_tokens,
    total_cache_read: d.cache_read_tokens,
    total_tokens: d.tokens,
    cost: d.cost,
    estimated_cost_usd: d.estimated_cost_usd,
    observed_cost_usd: d.observed_cost_usd,
    estimated_cost_sessions: d.estimated_cost_sessions,
    observed_cost_sessions: d.observed_cost_sessions,
    unavailable_cost_sessions: d.unavailable_cost_sessions,
    total_duration_seconds: d.duration_seconds,
    active_projects: d.distinct_projects,
    projects: d.projects,
    ghost_count: d.ghost_count,
  }));

  const summary = {
    sourceHealth,
    guideEvidenceCoverage,
    weeklyEvidencePatterns: buildWeeklyEvidencePatterns(completeSessions, { now, archiveVersion: archiveSnapshot.archiveVersion }),
    exportedAt:    now.toISOString(),
    today:         todayBucket,
    thisWeek:      bucket(completeSessions, thisWeekStart, now),
    lastWeek:      bucket(completeSessions, lastWeekStart, lastWeekEnd),
    thisMonth:     bucket(completeSessions, thisMonthStart, now),
    lastMonth:     bucket(completeSessions, lastMonthStart, lastMonthEnd),
    thisYear:      bucket(completeSessions, thisYearStart, now),
    lastYear:      bucket(completeSessions, lastYearStart, lastYearEnd),
    allTime:       rollups.allTime,
    bySource:      sourceMonth,
    daily_summary,
    monthly_summary: rollups.monthly,
    yearly_summary: rollups.yearly,
    byProject: rollups.byProject,
    byModel: rollups.byModel,
    byTool: rollups.byTool,
    bySourceAllTime: Object.fromEntries(rollups.bySource.map((row) => [row.key, row])),
    cursorUsage: cursorUsageReport,
    hermesModelUsage: hermesModelUsageReport,
    archive: {
      version: archiveSnapshot.archiveVersion,
      snapshotBytes: archiveSnapshot.snapshotBytes,
      recoveredTailBytes: archive.recoveredTailBytes,
      total: archive.total,
      appendOnly: true,
      retentionCapped: false,
      warningThreshold: archive.warningThreshold,
      thresholdExceeded: archive.thresholdExceeded,
      detailPageMax: 500,
      previewLimit: SESSION_PREVIEW_LIMIT,
    },
  };

  const SUMMARY_FILE = join(OUTPUT_DIR, 'cost-summary.json');
  writeFileSync(SUMMARY_FILE, JSON.stringify(summary, null, 2));
  publishSnapshot(OUTPUT_DIR, { sessions: latest, summary });
  console.log(`Wrote cost-summary.json — ${summary.allTime.estimated_cost_sessions}/${summary.allTime.sessions} session estimates have supported historical pricing.`);
}

// ── --push retired (2026-06-12) ────────────────────────────────────────────────
// Session data is LOCAL-ONLY: real titles/first messages were exposed in the
// public repo and purged from history (see MEOWOPS_SESSION_DATA_EXPOSURE_AUDIT
// in ~/Downloads). Both files are gitignored; the hosted demo serves demo-*
// fixtures via vercel.json rewrites and the local API serves fresh local data.
// The flag stays recognized so launchd/cron invocations don't error.
if (process.argv.includes('--push')) {
  console.log('\n⚠  --push is retired: session data is local-only and gitignored.');
  console.log('   Nothing was committed or pushed. Remove --push from the caller.');
}
