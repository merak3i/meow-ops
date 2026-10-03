import { execFile } from 'node:child_process';
import { lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { registeredStorageRoots, scanStorageInventory } from './storage-inventory.mjs';

export function createStorageService({ env = process.env, home = homedir(), scan = scanStorageInventory, open = execFile } = {}) {
  const file = join(env.MEOW_RUNTIME_DIR || join(home, '.meow-ops', 'runtime'), 'storage-snapshot.json');
  let snapshot = null;
  let running = null;
  let error = null;
  try {
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    if (saved.schemaVersion === 1 && saved.scope === 'local-metadata-only') snapshot = saved;
  } catch { /* First measurement has no baseline. */ }
  const status = () => ({ ok: true, snapshot, refreshing: Boolean(running), error });
  return {
    status,
    refresh() {
      if (running) return running;
      error = null;
      running = (async () => {
        try {
          const next = await scan({ env, home, previous: snapshot });
          mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
          const temp = `${file}.${process.pid}.tmp`;
          writeFileSync(temp, JSON.stringify(next), { mode: 0o600 });
          renameSync(temp, file);
          snapshot = next;
        } catch { error = 'Storage measurement failed. The last saved measurement is retained.'; }
        finally { running = null; }
        return status();
      })();
      return running;
    },
    async openFolder(rootId) {
      const root = registeredStorageRoots({ env, home }).find(item => item.id === rootId);
      if (!root) throw new Error('Unknown registered storage location.');
      const measured = snapshot?.roots.find(item => item.id === rootId && item.path === root.path);
      if (!measured || measured.status === 'missing') throw new Error('Measure this location before opening it.');
      const stat = lstatSync(root.path);
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw new Error('This location is not a regular file or folder.');
      const folder = stat.isDirectory() ? root.path : dirname(root.path);
      // Recheck the registered location immediately before invoking the OS.
      // Arguments are passed directly, never through a shell or supplied path.
      if (realpathSync(folder) !== folder) throw new Error('Linked storage locations cannot be opened here.');
      await new Promise((resolve, reject) => open('/usr/bin/open', [folder], { timeout: 5000 }, err => err ? reject(new Error('The folder could not be opened.')) : resolve()));
      return { ok: true };
    },
  };
}
