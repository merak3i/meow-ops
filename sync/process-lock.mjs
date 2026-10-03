import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

function readOwner(path) {
  try {
    const raw = readFileSync(path, 'utf8').trim();
    try {
      const value = JSON.parse(raw);
      return typeof value === 'number' ? { pid: value } : value;
    } catch {
      // The prior collector stored only a decimal PID and a newline.
      if (/^[0-9]+$/.test(raw)) return { pid: Number(raw) };
      return null;
    }
  } catch { return null; }
}
function alive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return true;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}

function remove(path) {
  try { unlinkSync(path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

function publish(path, claim) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(claim), { mode: 0o600, flag: 'wx' });
    renameSync(temporary, path);
  } finally { remove(temporary); }
}

function owners(dir) {
  const result = [];
  for (const name of readdirSync(dir).filter(name => /^[a-f0-9-]{36}\.json$/.test(name))) {
    const path = join(dir, name);
    const claim = readOwner(path);
    if (!claim) {
      try { statSync(path); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      result.push({ invalid: true });
      continue;
    }
    if (!alive(claim.pid)) { remove(path); continue; }
    if (claim.claimId !== name.slice(0, -5) || typeof claim.token !== 'string'
      || !Number.isSafeInteger(claim.ticket) || claim.ticket < 0 || typeof claim.choosing !== 'boolean') {
      result.push({ invalid: true });
      continue;
    }
    result.push(claim);
  }
  return result;
}

// Atomic per-process claims and bakery tickets avoid a recovery lock that could
// itself be stranded. A dead process cannot replace its removed unique claim.
// Parent and exporter share a token but retain separate claims, so either can
// die or release without clearing ownership held by the other.
export function acquireProcessLock(path, { inheritedToken } = {}) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  try { mkdirSync(path, { mode: 0o700 }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (!statSync(path).isDirectory()) {
      const owner = readOwner(path);
      if (!owner || alive(owner.pid)) return null;
      throw Object.assign(new Error('A legacy sync lock remains. Stop old collectors and preserve that lock before migrating it.'), {
        code: 'legacy_lock_migration_required',
      });
    }
  }
  chmodSync(path, 0o700);
  const claimId = randomUUID();
  const claimPath = join(path, `${claimId}.json`);
  const token = inheritedToken || randomUUID();
  const initial = owners(path);
  const parent = inheritedToken && initial.find(claim => claim.token === inheritedToken && !claim.choosing);
  if (initial.some(claim => claim.invalid) || (inheritedToken && !parent)) return null;
  const claim = { claimId, pid: process.pid, token, ticket: 0, choosing: true };
  publish(claimPath, claim);
  let acquired = false;
  try {
    const current = owners(path);
    if (current.some(owner => owner.invalid)) return null;
    if (parent) {
      // Publish before checking parent liveness. If the parent dies later, new
      // contenders already see this child's choosing flag and must wait.
      if (!current.some(owner => owner.claimId === parent.claimId) || !alive(parent.pid)) return null;
      claim.ticket = parent.ticket;
    } else {
      claim.ticket = 1 + Math.max(0, ...current.map(owner => owner.ticket));
    }
    claim.choosing = false;
    publish(claimPath, claim);
    const contenders = owners(path).filter(owner => owner.claimId !== claimId && owner.token !== token);
    if (contenders.some(owner => owner.invalid || owner.choosing || owner.ticket < claim.ticket
      || (owner.ticket === claim.ticket && owner.claimId < claimId))) return null;
    acquired = true;
    return { token, inherited: Boolean(parent), release() { remove(claimPath); } };
  } finally {
    if (!acquired) remove(claimPath);
  }
}
