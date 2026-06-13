// Loop-Ops Supabase connector — pulls live per-surface "truth states" from a
// Supabase table into the local truth CSV that loop-ops-import.mjs already
// consumes via --truth. The Excel workbook stays the STRUCTURE (which surfaces
// exist); Supabase supplies the live STATE (which gate passed, db status,
// last-verified time). They join in the importer.
//
//   Supabase table  →  THIS connector  →  truth.csv  →  loop-ops-import.mjs  →  spec.json  →  The Loom
//   (Patherle writes)   (pull, opt-in)     (local)       (--truth join)         (local)        (renders)
//
// OPT-IN + plug-in-later: a no-op (exit 0) unless LOOP_OPS_SUPABASE_URL/_KEY/
// _TABLE are set, so it is safe to wire into a sync chain before credentials
// exist. All Patherle-private config lives in env (gitignored), never in code.
//
//   node sync/loop-ops-supabase.mjs
//   node sync/loop-ops-import.mjs --truth public/data/loop-ops/truth.csv
//
// Offline note: this step needs network (it reads the cloud table). Everything
// after it — importer, spec.json, the Loom — is fully local/offline.

import { createClient } from '@supabase/supabase-js';
import { mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SB_URL   = process.env.LOOP_OPS_SUPABASE_URL;
const SB_KEY   = process.env.LOOP_OPS_SUPABASE_KEY;
const SB_TABLE = process.env.LOOP_OPS_SUPABASE_TABLE;
const OUT_PATH = process.env.LOOP_OPS_TRUTH
  || join(__dirname, '..', 'public', 'data', 'loop-ops', 'truth.csv');

// The columns loop-ops-import.mjs reads off each truth row (keyed by
// surface_key). If the Supabase column names differ, remap with
// LOOP_OPS_SUPABASE_COLMAP, e.g. {"latest_gate":"e2e_gate"}.
export const TRUTH_COLUMNS = [
  'surface_key', 'correlation_status', 'latest_gate', 'latest_e2e_gate',
  'status', 'db_status', 'current_truth', 'eval_set', 'source_refs',
  'last_verified_at_utc',
];

/** Pure: map Supabase rows → the importer's truth CSV string. Tested directly. */
export function rowsToTruthCsv(rows, colmap = {}) {
  const pick = (row, col) => {
    const src = colmap[col] || col;
    const v = row ? row[src] : undefined;
    return v === null || v === undefined ? '' : String(v);
  };
  const esc = (s) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const header = TRUTH_COLUMNS.join(',');
  const lines = (Array.isArray(rows) ? rows : [])
    .filter((r) => pick(r, 'surface_key').trim())          // surface_key is the join key
    .map((r) => TRUTH_COLUMNS.map((c) => esc(pick(r, c))).join(','));
  return [header, ...lines].join('\n') + '\n';
}

export function isConfigured() {
  return Boolean(SB_URL && SB_KEY && SB_TABLE);
}

async function main() {
  if (!isConfigured()) {
    console.log('loop-ops-supabase: not configured (set LOOP_OPS_SUPABASE_URL/_KEY/_TABLE) — skipping. Excel remains the source of truth.');
    return;
  }
  let colmap = {};
  if (process.env.LOOP_OPS_SUPABASE_COLMAP) {
    try { colmap = JSON.parse(process.env.LOOP_OPS_SUPABASE_COLMAP); }
    catch { console.error('loop-ops-supabase: LOOP_OPS_SUPABASE_COLMAP is not valid JSON — ignoring it'); }
  }

  const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
  const { data, error } = await sb.from(SB_TABLE).select('*');
  if (error) {
    console.error(`loop-ops-supabase: query failed — ${error.message}`);
    process.exit(1);
  }

  const csv = rowsToTruthCsv(data || [], colmap);
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  const tmp = `${OUT_PATH}.tmp`;
  writeFileSync(tmp, csv);
  renameSync(tmp, OUT_PATH);   // atomic — a partial read never sees a half file

  console.log(`loop-ops-supabase: wrote ${(data || []).length} truth row(s) → ${OUT_PATH}`);
  console.log(`loop-ops-supabase: now run  node sync/loop-ops-import.mjs --truth ${OUT_PATH}`);
}

// Run only when invoked directly, so tests can import the pure helpers.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error(`loop-ops-supabase: FAILED — ${err.message}`); process.exit(1); });
}
