// Upload public/data/sessions.json + cost-summary.json to Supabase Storage.
// Run after `node sync/export-local.mjs` (or use sync/full-sync.mjs which does both).
// Requires SUPABASE_URL + SUPABASE_SERVICE_KEY in .env

import { readFileSync, statSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..');
const DATA_DIR   = join(ROOT, 'public', 'data');
const ENV_FILE   = join(ROOT, '.env');
const BUCKET     = 'meow-ops';

// Load .env
if (existsSync(ENV_FILE)) {
  for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const m = line.match(/^([\w]+)=(.+)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env');
  process.exit(1);
}

async function uploadFile(localPath, objectKey) {
  if (!existsSync(localPath)) {
    console.warn(`⚠️  ${objectKey} not found at ${localPath} — skipping`);
    return;
  }
  const data   = readFileSync(localPath);
  const sizeKB = (statSync(localPath).size / 1024).toFixed(1);
  console.log(`📤 Uploading ${objectKey} (${sizeKB} KB) to ${BUCKET}...`);

  const url = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${objectKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'x-upsert': 'true',
      'Cache-Control': 'public, max-age=300', // 5-minute browser cache
    },
    body: data,
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`❌ Upload failed for ${objectKey} (${res.status}): ${text}`);
    return false;
  }

  const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${objectKey}`;
  console.log(`✅ ${objectKey} → ${publicUrl}`);
  return true;
}

const sessionsOk = await uploadFile(join(DATA_DIR, 'sessions.json'),     'sessions.json');
const summaryOk  = await uploadFile(join(DATA_DIR, 'cost-summary.json'), 'cost-summary.json');

if (!sessionsOk) {
  console.error('\nRun sync/export-local.mjs first to generate the data files.');
  process.exit(1);
}

if (sessionsOk && summaryOk) {
  console.log('\n✅ All files uploaded successfully.');
}
