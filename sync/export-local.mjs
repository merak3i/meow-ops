// Export real Claude Code session data to a static JSON file.
// No Supabase needed — generates public/data/sessions.json for the dashboard.
// Run: node sync/export-local.mjs
// Run: node sync/export-local.mjs --push   (also commit + push to GitHub)

import { writeFileSync, readdirSync, statSync, existsSync, mkdirSync, openSync, readSync, closeSync } from 'fs';
import { join } from 'path';
import { parseSessionLines }  from './parse-session.mjs';
import { scanCodexSessions }  from './parse-codex.mjs';
import { scanCursorSessions } from './parse-cursor.mjs';
import { scanAiderProjects }  from './parse-aider.mjs';
import { scanAntigravitySessions, DEFAULT_ANTIGRAVITY_DIR } from './parse-antigravity.mjs';
import { readSessionHistory, updateSessionHistory } from './session-history.mjs';
import { buildSessionRollups } from './session-rollups.mjs';

const CLAUDE_DIR = join(process.env.HOME, '.claude', 'projects');
const CODEX_DIR  = join(process.env.HOME, '.codex', 'sessions');
// Google Antigravity agent sessions (~/.gemini/antigravity/brain/<uuid>/...).
// Override the root with ANTIGRAVITY_DIR.
const ANTIGRAVITY_DIR = process.env.ANTIGRAVITY_DIR || DEFAULT_ANTIGRAVITY_DIR;

// Read a (possibly very large) JSONL file into an array of non-empty lines
// without ever materializing the whole file as one JS string. Reading the
// entire file with readFileSync + split risks Node's ~512 MB single-string
// cap on long-running session logs; this chunked reader streams instead.
function readJsonlLines(path) {
  const CHUNK = 1 << 20; // 1 MiB
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.allocUnsafe(CHUNK);
    const lines = [];
    let leftover = '';
    let bytes;
    while ((bytes = readSync(fd, buf, 0, CHUNK, null)) > 0) {
      const text = leftover + buf.toString('utf8', 0, bytes);
      const parts = text.split('\n');
      leftover = parts.pop() ?? '';
      for (const p of parts) { if (p) lines.push(p); }
    }
    if (leftover) lines.push(leftover);
    return lines;
  } finally {
    closeSync(fd);
  }
}

// Optional extra sources — configure via env vars
// CURSOR_LOGS_DIR  — path to Cursor logs dir, e.g. ~/.cursor/logs
// AIDER_PROJECTS   — colon-separated list of project dirs containing .aider.chat.history.md
const CURSOR_LOGS_DIR  = process.env.CURSOR_LOGS_DIR  || join(process.env.HOME, '.cursor', 'logs');
const AIDER_PROJECT_DIRS = process.env.AIDER_PROJECTS
  ? process.env.AIDER_PROJECTS.split(':').filter(Boolean)
  : [];
const OUTPUT_DIR = join(import.meta.dirname, '..', 'public', 'data');
const OUTPUT_FILE = join(OUTPUT_DIR, 'sessions.json');
// Lightweight compatibility preview only. Full retention lives in the uncapped
// local archive and browser detail views query it in bounded pages.
const SESSION_PREVIEW_LIMIT = parseInt(
  process.env.MEOW_SESSION_PREVIEW_LIMIT || process.env.MEOW_MAX_SESSIONS || '1000',
  10,
);

console.log('🐱 Meow Operations — Local Export\n');

if (!existsSync(CLAUDE_DIR)) {
  console.error(`Claude projects directory not found: ${CLAUDE_DIR}`);
  process.exit(1);
}

if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

const projectDirs = readdirSync(CLAUDE_DIR).filter((d) => {
  const full = join(CLAUDE_DIR, d);
  try {
    return statSync(full).isDirectory() && !d.startsWith('.');
  } catch {
    return false;
  }
});

console.log(`Scanning ${projectDirs.length} project directories...\n`);

let allSessions = [];
let fileCount = 0;
let errorCount = 0;

function walkJsonl(dir, projectDir, isSubagent = false) {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const full = join(dir, entry);
    let stat;
    try { stat = statSync(full); } catch { continue; }

    if (stat.isDirectory()) {
      walkJsonl(full, projectDir, entry === 'subagents' || isSubagent);
    } else if (entry.endsWith('.jsonl')) {
      try {
        const lines = readJsonlLines(full);
        const sessions = parseSessionLines(lines, projectDir);
        // Each file = one logical session entry. Make the session_id file-unique.
        // Keep the real session id in the key so two session ids in one
        // subagent file can't collide into a single "agent-<file>" row.
        for (const s of sessions) {
          const fileKey = entry.replace('.jsonl', '');
          s.session_id = isSubagent ? `agent-${fileKey}-${s.session_id}` : `${s.session_id}-${fileKey}`;
          s.is_subagent = isSubagent;
          s.source = 'claude';
          if (isSubagent) s.entrypoint = 'subagent';
        }
        allSessions.push(...sessions);
        fileCount++;
      } catch {
        errorCount++;
      }
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
  const codexSessions = scanCodexSessions(CODEX_DIR);
  console.log(`Found ${codexSessions.length} Codex session(s)`);
  allSessions.push(...codexSessions);
} else {
  console.log('No Codex sessions directory found — skipping');
}

// Merge Cursor sessions (opt-in: CURSOR_LOGS_DIR must exist)
if (existsSync(CURSOR_LOGS_DIR)) {
  const cursorSessions = scanCursorSessions(CURSOR_LOGS_DIR);
  if (cursorSessions.length > 0) {
    console.log(`Found ${cursorSessions.length} Cursor session(s)`);
    allSessions.push(...cursorSessions);
  } else {
    console.log('Cursor logs dir found but no sessions parsed — skipping');
  }
} else {
  console.log('No Cursor logs directory found — skipping (set CURSOR_LOGS_DIR to enable)');
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

// De-duplicate by session_id (real dedupe, not just a rename). A re-run or an
// overlapping scan can surface the same id twice; keep the richer record
// (more messages) so a partial re-read never shrinks a session.
const byId = new Map();
for (const s of allSessions) {
  const prev = byId.get(s.session_id);
  if (!prev || (s.message_count || 0) > (prev.message_count || 0)) byId.set(s.session_id, s);
}
const allUnique = [...byId.values()];
const dupCount = allSessions.length - allUnique.length;
console.log(`Total unique session entries: ${allUnique.length}${dupCount > 0 ? ` (deduped ${dupCount})` : ''}`);

// Sort by most-recent activity (ended_at) descending.
// This ensures long-running Claude sessions still active today aren't
// pushed below stale sessions just because they started weeks ago.
allUnique.sort((a, b) => {
  const aTime = new Date(a.ended_at || a.started_at);
  const bTime = new Date(b.ended_at || b.started_at);
  return bTime - aTime;
});

const publicSessions = allUnique.map(toPublicSession);
const archive = updateSessionHistory(publicSessions);
const completeSessions = readSessionHistory();
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
const totalCost = completeSessions.reduce((a, s) => a + (s.estimated_cost_usd || 0), 0);
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
console.log(`Total cost: $${totalCost.toFixed(2)}`);

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
    return { cost: 0, tokens: 0, sessions: 0, duration_seconds: 0 };
  }

  function addSession(acc, s) {
    acc.cost += s.estimated_cost_usd || 0;
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
    estimated_cost_usd: d.cost,
    total_duration_seconds: d.duration_seconds,
    active_projects: d.distinct_projects,
    projects: d.projects,
    ghost_count: d.ghost_count,
  }));

  const summary = {
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
    bySourceAllTime: Object.fromEntries(rollups.bySource.map((row) => [row.key, row])),
    archive: {
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
  console.log(`Wrote cost-summary.json — today $${summary.today.cost.toFixed(2)}, this week $${summary.thisWeek.cost.toFixed(2)}, this month $${summary.thisMonth.cost.toFixed(2)}, this year $${summary.thisYear.cost.toFixed(2)}`);
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
