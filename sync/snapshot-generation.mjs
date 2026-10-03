import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const validId = value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
const digest = value => createHash('sha256').update(value).digest('hex');

function validate({ sessions, summary }) {
  const ids = new Set();
  if (!Array.isArray(sessions) || sessions.some(row => {
    const id = JSON.stringify([row?.source || 'claude', row?.session_id]);
    if (!row || typeof row.session_id !== 'string' || !row.session_id || ids.has(id)) return true;
    ids.add(id);
    return false;
  }) || !summary || typeof summary !== 'object' || Array.isArray(summary)
    || !Number.isSafeInteger(summary.archive?.total) || summary.archive.total < sessions.length
    || (summary.allTime?.sessions !== undefined && summary.allTime.sessions !== summary.archive.total)) {
    throw new Error('Invalid snapshot: session identities and archive totals must reconcile.');
  }
}

function durableWrite(path, content, flag = 'w') {
  const fd = openSync(path, flag, 0o600);
  try { writeFileSync(fd, content); fsyncSync(fd); } finally { closeSync(fd); }
}

function syncDirectory(path) {
  const fd = openSync(path, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

function promoteManifest(dir, name, manifest) {
  const temporary = join(dir, `${name}.${randomUUID()}.tmp`);
  durableWrite(temporary, JSON.stringify(manifest), 'wx');
  renameSync(temporary, join(dir, name));
  syncDirectory(dir);
}

function readManifest(dir, name) {
  const path = join(dir, name);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

function readGeneration(dir, reference) {
  if (!validId(reference?.id) || !/^[a-f0-9]{64}$/.test(reference?.sha256 || '')) throw new Error('Invalid generation reference.');
  const raw = readFileSync(join(dir, 'generations', `${reference.id}.json`));
  if (digest(raw) !== reference.sha256) throw new Error('Generation checksum mismatch.');
  const bundle = JSON.parse(raw);
  if (bundle.schemaVersion !== 1 || bundle.generation?.id !== reference.id) throw new Error('Generation identity mismatch.');
  validate(bundle);
  return bundle;
}

function findSnapshot(dir) {
  let pointerFound = false;
  for (const [pointerIndex, name] of ['snapshot-manifest.json', 'snapshot-manifest.previous.json'].entries()) {
    if (!existsSync(join(dir, name))) continue;
    pointerFound = true;
    let manifest;
    try { manifest = readManifest(dir, name); } catch { continue; }
    if (manifest?.schemaVersion !== 1) continue;
    for (const [index, reference] of [manifest.current, manifest.previous].entries()) {
      try {
        return { bundle: readGeneration(dir, reference), reference, lastGood: pointerIndex > 0 || index > 0,
          ...(pointerIndex > 0 ? { warning: 'current-manifest-invalid' }
            : index > 0 ? { warning: 'current-generation-invalid' } : {}) };
      } catch { /* Try an independently retained last good reference. */ }
    }
  }
  if (pointerFound) throw new Error('No valid snapshot generation remains.');
  return null;
}

// The only mutable pointer is promoted after the complete payload is durable.
// Failed writes leave old generations intact; no retention or deletion occurs here.
export function publishSnapshot(dir, { sessions, summary }, { now = new Date(), beforePromote } = {}) {
  validate({ sessions, summary });
  const generationsDir = join(dir, 'generations');
  mkdirSync(generationsDir, { recursive: true, mode: 0o700 });
  let previous = null;
  try { previous = findSnapshot(dir)?.reference || null; }
  catch { /* Publishing a validated generation can recover an invalid pointer. */ }
  const generation = {
    id: randomUUID(), createdAt: now.toISOString(), scope: 'local-archive',
    coverage: summary.sourceHealth || {}, archiveTotal: summary.archive.total,
    previewTotal: sessions.length,
    archiveVersion: summary.archive.version || null,
  };
  const bundle = { schemaVersion: 1, generation, sessions, summary };
  const raw = JSON.stringify(bundle);
  durableWrite(join(generationsDir, `${generation.id}.json`), raw, 'wx');
  syncDirectory(generationsDir);
  const manifest = { schemaVersion: 1, current: { id: generation.id, sha256: digest(raw) }, previous };
  beforePromote?.();
  // Keep a separately durable pointer before replacing current. First publish
  // establishes the backup after current is durable; later backups point only
  // to the already validated prior generation.
  if (previous) promoteManifest(dir, 'snapshot-manifest.previous.json', { schemaVersion: 1, current: previous, previous: null });
  promoteManifest(dir, 'snapshot-manifest.json', manifest);
  if (!previous) promoteManifest(dir, 'snapshot-manifest.previous.json', { schemaVersion: 1, current: manifest.current, previous: null });
  return manifest;
}

export function readSnapshot(dir) {
  const result = findSnapshot(dir);
  if (!result) return null; // Older installations have no generation contract.
  return { ...result.bundle, lastGood: result.lastGood, ...(result.warning ? { warning: result.warning } : {}) };
}
