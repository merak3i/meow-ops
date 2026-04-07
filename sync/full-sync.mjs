// Run a full sync: parse JSONL → write public/data/sessions.json → upload to Supabase
// One-stop command for keeping the dashboard fresh.

import { spawn } from 'child_process';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..');

function run(script) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [join(ROOT, 'sync', script)], { stdio: 'inherit', cwd: ROOT });
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${script} exited ${code}`)));
    child.on('error', reject);
  });
}

console.log('🐱 Meow Operations — Full Sync\n');
await run('export-local.mjs');
console.log('');
await run('upload-to-supabase.mjs');
console.log('\n✨ Done. Dashboard will pick up new data on next page load.');
