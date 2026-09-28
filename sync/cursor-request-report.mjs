import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const worker = fileURLToPath(new URL('./cursor-request-worker.mjs', import.meta.url));
let cached = null;
let pending = null;
let checkedAt = 0;

// Memory only. A shared worker keeps simultaneous browser requests from
// repeating the database scan. Nothing is saved under public/data or in Git.
export function getCursorRequestReport() {
  if (cached && Date.now() - checkedAt < 5 * 60_000) return Promise.resolve(cached);
  if (pending) return pending;
  pending = new Promise(resolve => {
    execFile(process.execPath, [worker], { timeout: 120_000, maxBuffer: 2 * 1024 * 1024 }, (error, stdout) => {
      try {
        if (error) throw error;
        cached = JSON.parse(stdout);
      } catch {
        cached = { status: 'unreadable', matched_sessions: 0, by_model: [], limitation: 'Local Cursor request metadata could not be read. No usage has been estimated.' };
      }
      checkedAt = Date.now();
      pending = null;
      resolve(cached);
    });
  });
  return pending;
}
