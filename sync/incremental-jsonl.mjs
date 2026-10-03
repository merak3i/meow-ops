// Private, disposable parser checkpoints. Sources and transcript bytes are never
// modified. A checkpoint commits only complete lines; a trailing line is replayed.
import {
  chmodSync, closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync,
  readSync, renameSync, statSync, writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { assertHistoryOutsideWorktree } from './session-history.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const identity = stat => ({ dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs });
const sameFile = (a, b) => a?.dev === b.dev && a?.ino === b.ino;
const checkpointDigest = ({ digest: _digest, ...checkpoint }) => hash(JSON.stringify(checkpoint));
const INTEGRITY_VERSION = 'sha256-committed-prefix-v1';

function hashPrefix(fd, offset, report) {
  const digest = createHash('sha256');
  const buffer = Buffer.allocUnsafe(Math.min(offset, 1 << 20));
  let position = 0;
  while (position < offset) {
    const count = readSync(fd, buffer, 0, Math.min(buffer.length, offset - position), position);
    if (!count) throw new Error('Source changed.');
    digest.update(buffer.subarray(0, count));
    position += count;
    report.bytesRead += count;
  }
  return digest;
}

export function readJsonlWithCheckpoint(filePath, options) {
  const report = { mode: 'full', bytesRead: 0, parsedBytes: 0, malformedLines: 0, pendingBytes: 0 };
  let stage = 'stat';
  let fd;
  try {
    const before = statSync(filePath);
    if (!before.isFile()) throw new Error('Source is not a file.');
    const file = identity(before);
    const hydrate = options.hydrate || (value => value);
    const dehydrate = options.dehydrate || (value => value);
    let checkpoint;
    let checkpointPath;
    stage = 'checkpoint';
    if (options.checkpointDir) {
      assertHistoryOutsideWorktree(options.checkpointDir);
      checkpointPath = join(options.checkpointDir, `${hash(resolve(filePath))}.json`);
      if (existsSync(checkpointPath)) {
        try {
          const saved = JSON.parse(readFileSync(checkpointPath, 'utf8'));
          if (saved?.digest === checkpointDigest(saved)) checkpoint = saved;
        } catch { /* Rebuild a disposable cache. */ }
      }
    }
    if (checkpoint?.version !== options.version || checkpoint?.integrityVersion !== INTEGRITY_VERSION
      || !/^[a-f0-9]{64}$/.test(checkpoint?.prefixSha256 || '') || !sameFile(checkpoint?.file, file)
      || !Number.isSafeInteger(checkpoint?.offset) || checkpoint.offset < 0
      || checkpoint.offset > file.size || checkpoint.file.size > file.size
      || !Object.hasOwn(checkpoint || {}, 'state') || !Object.hasOwn(checkpoint || {}, 'output')) checkpoint = null;
    if (checkpoint && checkpoint.file.size === file.size && checkpoint.file.mtimeMs === file.mtimeMs
      && checkpoint.file.ctimeMs === file.ctimeMs) {
      options.onCoverage?.({ ...report, ...checkpoint.coverage, mode: 'cached', bytesRead: 0, parsedBytes: 0 });
      return structuredClone(checkpoint.output);
    }

    stage = 'read';
    fd = openSync(filePath, 'r');
    if (!sameFile(identity(fstatSync(fd)), file)) throw new Error('Source replaced.');
    // Changed files reread the committed prefix for integrity, but do not parse
    // it again unless it changed. Sampling only the ends misses middle rewrites
    // when a source is rebuilt in place and grows past its previous size.
    let sourceHash = createHash('sha256');
    if (checkpoint) {
      if (checkpoint.file.size === file.size) checkpoint = null;
      else {
        sourceHash = hashPrefix(fd, checkpoint.offset, report);
        if (sourceHash.copy().digest('hex') !== checkpoint.prefixSha256) checkpoint = null;
      }
    }
    let state;
    try { state = checkpoint ? hydrate(checkpoint.state) : options.createState(); }
    catch { checkpoint = null; state = options.createState(); }
    if (!checkpoint) sourceHash = createHash('sha256');
    let prefixSha256 = sourceHash.copy().digest('hex');
    let offset = checkpoint?.offset || 0;
    report.mode = checkpoint ? 'incremental' : 'full';
    report.malformedLines = checkpoint?.coverage?.malformedLines || 0;
    const decoder = new StringDecoder('utf8');
    const buffer = Buffer.allocUnsafe(1 << 20);
    let pending = '';
    let position = offset;
    const consume = (line, target, committed) => {
      if (!line.trim()) return;
      let entry;
      try { entry = JSON.parse(line); }
      catch { if (committed) report.malformedLines++; return; }
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        if (committed) report.malformedLines++;
        return;
      }
      stage = 'parse';
      options.reduceEntry(target, entry);
      stage = 'read';
    };
    while (position < file.size) {
      const count = readSync(fd, buffer, 0, Math.min(buffer.length, file.size - position), position);
      if (!count) throw new Error('Source shortened.');
      position += count;
      report.bytesRead += count;
      report.parsedBytes += count;
      const lines = (pending + decoder.write(buffer.subarray(0, count))).split('\n');
      pending = lines.pop() || '';
      for (const line of lines) {
        consume(line, state, true);
      }
      const lastNewline = buffer.subarray(0, count).lastIndexOf(0x0a);
      if (lastNewline >= 0) {
        offset = position - count + lastNewline + 1;
        prefixSha256 = sourceHash.copy().update(buffer.subarray(0, lastNewline + 1)).digest('hex');
      }
      sourceHash.update(buffer.subarray(0, count));
    }
    pending += decoder.end();
    report.pendingBytes = file.size - offset;
    const committedState = dehydrate(state);
    // Preserve the old parser's support for valid final JSON without a newline,
    // but do not commit it until its newline arrives. Raw tail text is not saved.
    const displayState = hydrate(structuredClone(committedState));
    if (pending.trim()) consume(pending, displayState, false);
    stage = 'parse';
    const output = options.finish(displayState);
    stage = 'read';
    const after = identity(fstatSync(fd));
    if (!sameFile(file, after) || after.size < file.size
      || (after.size === file.size && (after.mtimeMs !== file.mtimeMs || after.ctimeMs !== file.ctimeMs))) {
      throw new Error('Source changed during parse.');
    }
    if (checkpointPath) {
      stage = 'checkpoint-write';
      mkdirSync(options.checkpointDir, { recursive: true, mode: 0o700 });
      chmodSync(options.checkpointDir, 0o700);
      const temporary = `${checkpointPath}.${process.pid}.tmp`;
      const saved = {
        version: options.version, integrityVersion: INTEGRITY_VERSION, file, offset, prefixSha256,
        state: committedState, output, coverage: { malformedLines: report.malformedLines, pendingBytes: report.pendingBytes },
      };
      writeFileSync(temporary, JSON.stringify({ ...saved, digest: checkpointDigest(saved) }), { mode: 0o600 });
      renameSync(temporary, checkpointPath);
      chmodSync(checkpointPath, 0o600);
    }
    options.onCoverage?.(report);
    return output;
  } catch {
    options.onCoverage?.({ ...report, mode: 'failed', stage });
    throw Object.assign(new Error(`Local session collection failed at ${stage}; source content was not logged.`), {
      code: 'source_read_failed', stage,
    });
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
