// Pure reconciliation preview. Never mutates archives or resolves conflicting
// revisions by recency: a newer scan can contain less evidence than an old one.
import { pathToFileURL } from 'node:url';
import { existsSync, chmodSync, closeSync, fsyncSync, mkdirSync, openSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readSessionHistorySnapshot, updateSessionHistory } from './session-history.mjs';

const PRIVATE_KEYS = new Set(['cwd', 'raw_ref', 'session_title', 'first_user_message']);
const CODEX_UUID = /^(?:codex-)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const key of Object.keys(value).sort()) {
    if (PRIVATE_KEYS.has(key)) throw new Error('Reconciliation rejected content-bearing fields.');
    result[key] = canonicalValue(value[key]);
  }
  return result;
}

function canonicalSession(raw) {
  const session = canonicalValue(raw);
  const codexId = session.source === 'codex' ? CODEX_UUID.exec(session.session_id)?.[1] : null;
  if (codexId && session.session_id !== `codex-${codexId}`) session.session_id = `codex-${codexId}`;
  return session;
}

function identity(session) {
  return JSON.stringify([session.source, session.session_id]);
}

function writePrivate(path, value) {
  const fd = openSync(path, 'wx', 0o600);
  try { writeFileSync(fd, JSON.stringify(value)); fsyncSync(fd); } finally { closeSync(fd); }
}

function syncDirectory(path) {
  const fd = openSync(path, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

export function planSessionReconciliation(archives = []) {
  if (!Array.isArray(archives)) throw new Error('Reconciliation requires archive snapshots.');
  const identities = new Map();
  let inputSessions = 0;
  let normalizedIdentities = 0;
  let duplicateCopies = 0;
  for (const [archiveIndex, archive] of archives.entries()) {
    if (!Array.isArray(archive?.sessions)) throw new Error('Reconciliation requires archive sessions.');
    for (const raw of archive.sessions) {
      if (typeof raw?.source !== 'string' || !raw.source.trim()
        || typeof raw?.session_id !== 'string' || !raw.session_id.trim()) {
        throw new Error('Reconciliation rejected an invalid source/session identity.');
      }
      const session = canonicalSession(raw);
      // Codex's only accepted migration is the known prefix on the same UUID.
      // Similar timestamps, projects, models, or messages never establish identity.
      if (raw.session_id !== session.session_id) normalizedIdentities++;
      const identity = JSON.stringify([session.source, session.session_id]);
      const variants = identities.get(identity) || new Map();
      const fingerprint = JSON.stringify(session);
      const existing = variants.get(fingerprint);
      if (existing) {
        duplicateCopies++;
        if (!existing.archiveIndexes.includes(archiveIndex)) existing.archiveIndexes.push(archiveIndex);
      } else {
        variants.set(fingerprint, { session, archiveIndexes: [archiveIndex] });
      }
      identities.set(identity, variants);
      inputSessions++;
    }
  }

  const sessions = [];
  const conflicts = [];
  for (const variants of identities.values()) {
    const entries = [...variants.values()];
    if (entries.length === 1) sessions.push(entries[0].session);
    else conflicts.push({
      source: entries[0].session.source,
      session_id: entries[0].session.session_id,
      variants: entries,
    });
  }
  return {
    mode: 'preview-only',
    summary: {
      archives: archives.length,
      inputSessions,
      uniqueIdentities: identities.size,
      safeSessions: sessions.length,
      conflictingIdentities: conflicts.length,
      duplicateCopies,
      normalizedIdentities,
      incompleteArchives: archives.filter(archive => archive.incompleteTailBytes > 0).length,
    },
    sessions,
    conflicts,
  };
}

/** Build a separate, private candidate. Source archives are only read. */
export function stageSessionReconciliation(archives = [], { dir, now = new Date() } = {}) {
  if (!Array.isArray(archives) || archives.length < 2) throw new Error('Staging requires at least two archive snapshots.');
  if (archives.some((archive) => !Array.isArray(archive?.sessions) || archive.incompleteTailBytes > 0)) {
    throw new Error('Staging requires complete archive snapshots with no torn append tails.');
  }
  const destination = resolve(dir || '');
  if (!dir || existsSync(destination)) throw new Error('Choose a new, unused candidate directory.');
  const result = planSessionReconciliation(archives);
  const base = new Map(archives[0].sessions.map((raw) => {
    const session = canonicalSession(raw);
    return [identity(session), session];
  }));
  const staged = new Map(result.sessions.map((session) => [identity(session), session]));
  for (const conflict of result.conflicts) {
    const key = JSON.stringify([conflict.source, conflict.session_id]);
    const baseSession = base.get(key);
    if (baseSession) staged.set(key, baseSession);
  }
  const conflicts = result.conflicts.map((conflict) => ({
    source: conflict.source,
    session_id: conflict.session_id,
    selectedInCandidate: base.has(JSON.stringify([conflict.source, conflict.session_id])),
    variants: conflict.variants,
  }));
  const temporary = `${destination}.staging-${randomUUID()}`;
  try {
    mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
    mkdirSync(temporary, { mode: 0o700 });
    chmodSync(temporary, 0o700);
    updateSessionHistory([...staged.values()], { dir: temporary, updatedAt: now.toISOString() });
    writePrivate(join(temporary, 'reconciliation-conflicts.json'), {
      schemaVersion: 1,
      status: 'review-required',
      baseArchiveIndex: 0,
      policy: 'Preserve the base archive revision in the candidate when identities conflict; keep every variant here for inspection. Conflicts without a base revision are omitted from the candidate.',
      conflicts,
    });
    writePrivate(join(temporary, 'reconciliation-candidate.json'), {
      schemaVersion: 1,
      status: conflicts.length ? 'review-required' : 'ready-for-owner-review',
      createdAt: now.toISOString(),
      baseArchiveIndex: 0,
      archiveCount: archives.length,
      candidateSessions: staged.size,
      unresolvedIdentities: conflicts.length,
      selectedBaseConflictIdentities: conflicts.filter((conflict) => conflict.selectedInCandidate).length,
      omittedConflictsWithoutBase: conflicts.filter((conflict) => !conflict.selectedInCandidate).length,
    });
    syncDirectory(temporary);
    renameSync(temporary, destination);
    syncDirectory(dirname(destination));
  } catch (error) {
    rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
  return {
    status: result.conflicts.length ? 'review-required' : 'ready-for-owner-review',
    candidateSessions: staged.size,
    unresolvedIdentities: result.conflicts.length,
    selectedBaseConflictIdentities: conflicts.filter((conflict) => conflict.selectedInCandidate).length,
    omittedConflictsWithoutBase: conflicts.filter((conflict) => !conflict.selectedInCandidate).length,
    appendedCandidateSessions: staged.size - base.size,
    duplicateCopies: result.summary.duplicateCopies,
  };
}

// Explicit directories only. CLI output deliberately excludes paths, identities,
// project labels, session records, and conflict contents. Staging never changes inputs.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    const stage = args[0] === '--stage';
    const dirs = stage ? args.slice(2) : args;
    if (dirs.length < 2 || dirs.some(dir => dir.startsWith('-'))) {
      throw new Error(stage
        ? 'Provide a new candidate directory, then a base archive and at least one incoming archive.'
        : 'Provide at least two archive directories.');
    }
    if (dirs.some(dir => !existsSync(join(dir, 'sessions.jsonl')) && !existsSync(join(dir, 'current.json')))) {
      throw new Error('Archive files are missing.');
    }
    const snapshots = dirs.map(dir => readSessionHistorySnapshot({ dir }));
    if (stage) {
      const [, destination, ...archiveDirs] = args;
      if (!destination || archiveDirs.some(source => {
        const resolvedSource = resolve(source);
        const resolvedDestination = resolve(destination);
        return resolvedDestination === resolvedSource
          || resolvedDestination.startsWith(`${resolvedSource}/`)
          || resolvedSource.startsWith(`${resolvedDestination}/`);
      })) throw new Error('Candidate and source directories must be separate.');
      const result = stageSessionReconciliation(archiveDirs.map(dir => readSessionHistorySnapshot({ dir })), { dir: resolve(destination) });
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } else {
      const result = planSessionReconciliation(snapshots);
      process.stdout.write(`${JSON.stringify({ mode: result.mode, ...result.summary })}\n`);
    }
  } catch {
    process.stderr.write('Archive reconciliation failed. Check the explicit archive directories and use a new private candidate directory. Source archives are never changed.\n');
    process.exitCode = 1;
  }
}
