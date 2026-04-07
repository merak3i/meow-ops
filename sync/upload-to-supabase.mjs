// Upload public/data/sessions.json to Supabase Storage public bucket.
// Run after `node sync/export-local.mjs` (or use sync/full-sync.mjs which does both).
// Requires SUPABASE_URL + SUPABASE_SERVICE_KEY in .env

import { readFileSync, statSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..');
const SESSIONS_FILE = join(ROOT, 'public', 'data', 'sessions.json');
const ENV_FILE = join(ROOT, '.env');
const BUCKET = 'meow-ops';
const OBJECT_KEY = 'sessions.json';

// Load .env
if (existsSync(ENV_FILE)) {
  for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const m = line.match(/^([\w]+)=(.+)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env');
  process.exit(1);
}

if (!existsSync(SESSIONS_FILE)) {
  console.error(`No sessions.json at ${SESSIONS_FILE} — run sync/export-local.mjs first`);
  process.exit(1);
}

const data = readFileSync(SESSIONS_FILE);
const stat = statSync(SESSIONS_FILE);
const sizeKB = (stat.size / 1024).toFixed(1);

console.log(`📤 Uploading ${OBJECT_KEY} (${sizeKB} KB) to ${BUCKET}...`);

// Use upsert to overwrite existing file
const url = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${OBJECT_KEY}`;

const res = await fetch(url, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
    'x-upsert': 'true',
    'Cache-Control': 'public, max-age=300', // 5 minute browser cache
  },
  body: data,
});

if (!res.ok) {
  const text = await res.text();
  console.error(`❌ Upload failed (${res.status}): ${text}`);
  process.exit(1);
}

const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${OBJECT_KEY}`;
console.log(`✅ Uploaded. Public URL:`);
console.log(`   ${publicUrl}`);
