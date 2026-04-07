import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, basename } from 'path';
import { parseSessionLines } from './parse-session.mjs';

const CLAUDE_DIR = join(process.env.HOME, '.claude', 'projects');
const STATE_FILE = join(import.meta.dirname, '.meow-ops-sync-state.json');

// Read env from .env file if present
const envFile = join(import.meta.dirname, '..', '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const match = line.match(/^(\w+)=(.+)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
}

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY. Set in .env or environment.');
  console.log('\nRunning in dry-run mode — will parse data and show stats without uploading.\n');
}

const supabase = SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

function loadState() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { processedFiles: {} };
  }
}

function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function main() {
  console.log('🐱 Meow Operations — Sync Script\n');

  const state = loadState();
  let totalSessions = 0;
  let totalTokens = 0;
  let allSessions = [];

  if (!existsSync(CLAUDE_DIR)) {
    console.error(`Claude projects directory not found: ${CLAUDE_DIR}`);
    process.exit(1);
  }

  const projectDirs = readdirSync(CLAUDE_DIR).filter((d) => {
    const full = join(CLAUDE_DIR, d);
    return statSync(full).isDirectory() && !d.startsWith('.');
  });

  console.log(`Found ${projectDirs.length} project directories\n`);

  for (const dir of projectDirs) {
    const dirPath = join(CLAUDE_DIR, dir);
    const files = readdirSync(dirPath).filter((f) => f.endsWith('.jsonl'));

    for (const file of files) {
      const filePath = join(dirPath, file);
      const fileStat = statSync(filePath);
      const fileKey = `${dir}/${file}`;
      const lastMtime = state.processedFiles[fileKey];

      if (lastMtime && fileStat.mtimeMs <= lastMtime) continue;

      console.log(`  Parsing ${fileKey} (${(fileStat.size / 1024 / 1024).toFixed(1)} MB)...`);

      const content = readFileSync(filePath, 'utf8');
      const lines = content.split('\n').filter(Boolean);
      const sessions = parseSessionLines(lines, dir);

      allSessions.push(...sessions);
      totalSessions += sessions.length;
      totalTokens += sessions.reduce((a, s) => a + s.total_tokens, 0);

      state.processedFiles[fileKey] = fileStat.mtimeMs;
    }
  }

  console.log(`\nParsed ${totalSessions} sessions, ${(totalTokens / 1_000_000).toFixed(2)}M tokens total`);

  if (allSessions.length === 0) {
    console.log('No new sessions to sync.');
    saveState(state);
    return;
  }

  // Show summary
  const byProject = {};
  const byCat = {};
  for (const s of allSessions) {
    byProject[s.project] = (byProject[s.project] || 0) + 1;
    byCat[s.cat_type] = (byCat[s.cat_type] || 0) + 1;
  }

  console.log('\nBy project:');
  for (const [p, c] of Object.entries(byProject).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${p}: ${c} sessions`);
  }

  console.log('\nBy cat type:');
  for (const [t, c] of Object.entries(byCat).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${t}: ${c}`);
  }

  const totalCost = allSessions.reduce((a, s) => a + s.estimated_cost_usd, 0);
  console.log(`\nEstimated total cost: $${totalCost.toFixed(2)}`);

  if (!supabase) {
    console.log('\nDry run complete. Set SUPABASE_SERVICE_KEY to upload to Supabase.');
    saveState(state);
    return;
  }

  // Upsert sessions
  console.log('\nUploading to Supabase...');

  const sessionRows = allSessions.map(({ tools, ...s }) => s);
  const batchSize = 50;

  for (let i = 0; i < sessionRows.length; i += batchSize) {
    const batch = sessionRows.slice(i, i + batchSize);
    const { error } = await supabase
      .from('meow_ops_sessions')
      .upsert(batch, { onConflict: 'session_id' });

    if (error) {
      console.error(`  Error upserting sessions batch ${i}: ${error.message}`);
    } else {
      console.log(`  Sessions ${i + 1}-${Math.min(i + batchSize, sessionRows.length)} uploaded`);
    }
  }

  // Upsert tool usage
  const toolRows = [];
  for (const s of allSessions) {
    for (const [tool_name, call_count] of Object.entries(s.tools)) {
      toolRows.push({ session_id: s.session_id, tool_name, call_count });
    }
  }

  for (let i = 0; i < toolRows.length; i += batchSize) {
    const batch = toolRows.slice(i, i + batchSize);
    const { error } = await supabase
      .from('meow_ops_tool_usage')
      .upsert(batch, { onConflict: 'session_id,tool_name' });

    if (error) {
      console.error(`  Error upserting tools batch ${i}: ${error.message}`);
    }
  }

  // Rebuild daily aggregates
  const dailyMap = {};
  for (const s of allSessions) {
    const date = s.started_at.slice(0, 10);
    if (!dailyMap[date]) {
      dailyMap[date] = {
        date,
        session_count: 0,
        total_input_tokens: 0,
        total_output_tokens: 0,
        total_tokens: 0,
        total_tool_calls: 0,
        estimated_cost_usd: 0,
        active_projects: new Set(),
        models_used: {},
        top_tools: {},
        ghost_count: 0,
      };
    }
    const d = dailyMap[date];
    d.session_count++;
    d.total_input_tokens += s.input_tokens;
    d.total_output_tokens += s.output_tokens;
    d.total_tokens += s.total_tokens;
    d.estimated_cost_usd += s.estimated_cost_usd;
    d.active_projects.add(s.project);
    if (s.is_ghost) d.ghost_count++;
    if (s.model) d.models_used[s.model] = (d.models_used[s.model] || 0) + 1;
    for (const [tool, count] of Object.entries(s.tools)) {
      d.top_tools[tool] = (d.top_tools[tool] || 0) + count;
      d.total_tool_calls += count;
    }
  }

  const dailyRows = Object.values(dailyMap).map((d) => ({
    ...d,
    active_projects: d.active_projects.size,
    models_used: d.models_used,
    top_tools: d.top_tools,
    estimated_cost_usd: parseFloat(d.estimated_cost_usd.toFixed(6)),
  }));

  const { error: dailyError } = await supabase
    .from('meow_ops_daily')
    .upsert(dailyRows, { onConflict: 'date' });

  if (dailyError) {
    console.error(`  Error upserting daily stats: ${dailyError.message}`);
  } else {
    console.log(`  ${dailyRows.length} daily rows uploaded`);
  }

  saveState(state);
  console.log('\nSync complete!');
}

main().catch(console.error);
