// Export real Claude Code session data to a static JSON file.
// No Supabase needed — generates public/data/sessions.json for the dashboard.
// Run: node sync/export-local.mjs

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { parseSessionLines } from './parse-session.mjs';
import { scanCodexSessions } from './parse-codex.mjs';

const CLAUDE_DIR = join(process.env.HOME, '.claude', 'projects');
const CODEX_DIR  = join(process.env.HOME, '.codex', 'sessions');
const OUTPUT_DIR = join(import.meta.dirname, '..', 'public', 'data');
const OUTPUT_FILE = join(OUTPUT_DIR, 'sessions.json');
const MAX_SESSIONS = 250; // Keep dashboard responsive

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
        const content = readFileSync(full, 'utf8');
        const lines = content.split('\n').filter(Boolean);
        const sessions = parseSessionLines(lines, projectDir);
        // Each file = one logical session entry. Make the session_id file-unique.
        // For subagents, prefix with "agent-" so they're distinguishable.
        for (const s of sessions) {
          const fileKey = entry.replace('.jsonl', '');
          s.session_id = isSubagent ? `agent-${fileKey}` : `${s.session_id}-${fileKey}`;
          s.is_subagent = isSubagent;
          s.source = 'claude';
          if (isSubagent) s.entrypoint = 'subagent';
        }
        allSessions.push(...sessions);
        fileCount++;
      } catch (e) {
        errorCount++;
      }
    }
  }
}

for (const dir of projectDirs) {
  const dirPath = join(CLAUDE_DIR, dir);
  try {
    walkJsonl(dirPath, dir);
  } catch (e) {
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

const allUnique = allSessions;
console.log(`Total unique session entries: ${allUnique.length}`);

// Sort by most-recent activity (ended_at) descending.
// This ensures long-running Claude sessions still active today aren't
// pushed below stale sessions just because they started weeks ago.
allUnique.sort((a, b) => {
  const aTime = new Date(a.ended_at || a.started_at);
  const bTime = new Date(b.ended_at || b.started_at);
  return bTime - aTime;
});

// Take latest N (this is what the user asked for: "last 100")
const latest = allUnique.slice(0, MAX_SESSIONS);

console.log(`Exporting latest ${latest.length} sessions\n`);

// Stats
const totalTokens = latest.reduce((a, s) => a + s.total_tokens, 0);
const totalCost = latest.reduce((a, s) => a + s.estimated_cost_usd, 0);
const byProject = {};
const byCat = {};
const byModel = {};
for (const s of latest) {
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
