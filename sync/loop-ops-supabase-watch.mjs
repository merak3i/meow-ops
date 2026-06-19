// Loop-Ops real-time watcher — keeps the Loom near-instantly in sync with the
// Supabase truth table. Subscribes via Supabase Realtime (postgres_changes);
// on each insert/update/delete it re-pulls truth.csv and re-runs the importer,
// so spec.json (and the Loom) refresh within seconds of a change.
//
// This is the "real-time push" cadence. For "near-real-time pull", run
// loop-ops-supabase.mjs + loop-ops-import.mjs on a launchd/cron interval instead.
//
// OPT-IN + long-running. No-op if unconfigured. Requires Realtime enabled on
// the table:  ALTER PUBLICATION supabase_realtime ADD TABLE <your_table>;
//
//   node sync/loop-ops-supabase-watch.mjs

import { createClient } from '@supabase/supabase-js';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isConfigured } from './loop-ops-supabase.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SB_URL   = process.env.LOOP_OPS_SUPABASE_URL;
const SB_KEY   = process.env.LOOP_OPS_SUPABASE_KEY;
const SB_TABLE = process.env.LOOP_OPS_SUPABASE_TABLE;
const OUT_PATH = process.env.LOOP_OPS_TRUTH
  || join(__dirname, '..', 'public', 'data', 'loop-ops', 'truth.csv');

// Coalesce bursts: if a change lands while a regen is running, run once more
// when it finishes rather than piling up child processes.
let running = false;
let pending = false;

function regenerate() {
  if (running) { pending = true; return; }
  running = true;
  const node = process.execPath;
  const pull = spawn(node, [join(__dirname, 'loop-ops-supabase.mjs')], { stdio: 'inherit', env: process.env });
  pull.on('close', () => {
    const imp = spawn(node, [join(__dirname, 'loop-ops-import.mjs'), '--truth', OUT_PATH], { stdio: 'inherit', env: process.env });
    imp.on('close', () => {
      running = false;
      if (pending) { pending = false; regenerate(); }
    });
  });
}

function main() {
  if (!isConfigured()) {
    console.log('loop-ops-supabase-watch: not configured — skipping. Set LOOP_OPS_SUPABASE_URL/_KEY/_TABLE.');
    return;
  }
  const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
  console.log(`loop-ops-supabase-watch: subscribing to realtime changes on "${SB_TABLE}"…`);
  regenerate(); // initial sync on startup
  sb.channel('loop-ops-truth')
    .on('postgres_changes', { event: '*', schema: 'public', table: SB_TABLE }, (payload) => {
      console.log(`loop-ops-supabase-watch: ${payload.eventType} on ${SB_TABLE} → regenerating`);
      regenerate();
    })
    .subscribe((status) => console.log(`loop-ops-supabase-watch: channel ${status}`));
}

main();
