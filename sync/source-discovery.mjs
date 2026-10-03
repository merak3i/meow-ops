import fs from 'node:fs';
import { join } from 'node:path';

function reportFailure(error, operation, { onCoverage, optional = false }) {
  // A probed optional layout may legitimately be absent. Entries returned by a
  // directory scan are no longer optional: a disappearing entry is a scan gap.
  if (optional && ['ENOENT', 'ENOTDIR'].includes(error?.code)) return;
  onCoverage?.({ mode: 'failed', stage: 'discovery', operation, bytesRead: 0, parsedBytes: 0 });
}

export function readSourceDirectory(path, options = {}) {
  try { return fs.readdirSync(path); }
  catch (error) { reportFailure(error, 'readdir', options); return []; }
}

export function statSourcePath(path, options = {}) {
  try { return fs.statSync(path); }
  catch (error) { reportFailure(error, 'stat', options); return null; }
}

// An unreadable child cannot abort discovery of its readable siblings. Track
// directory identities so a symlink to an ancestor cannot recurse forever.
export function* walkSourceJsonl(dir, options = {}) {
  const visited = new Set();
  function* walk(path, stat, isSubagent) {
    if (!stat?.isDirectory()) return;
    const identity = `${stat.dev}:${stat.ino}`;
    if (visited.has(identity)) return;
    visited.add(identity);
    for (const name of readSourceDirectory(path, options)) {
      const filePath = join(path, name);
      const child = statSourcePath(filePath, options);
      if (child?.isDirectory()) yield* walk(filePath, child, isSubagent || name === 'subagents');
      else if (child?.isFile() && name.endsWith('.jsonl')) yield { filePath, name, isSubagent };
    }
  }
  yield* walk(dir, statSourcePath(dir, options), false);
}
