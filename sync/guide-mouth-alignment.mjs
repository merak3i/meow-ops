import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { validateMouthCues } from '../src/pages/sanctum/guide-mouth.mjs';

const run = promisify(execFile);
let busy = false;

// Audio remains local, with a private temporary directory removed on every exit.
// Only validated timing cues leave this adapter; analyzer paths never do.
export async function alignGuideMouth(bytes, options = {}) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 44 || bytes.length > 12 * 1024 * 1024
      || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') {
    return { status: 'invalid-audio' };
  }
  const executable = (options.env || process.env).MEOW_GUIDE_RHUBARB_BIN;
  if (typeof executable !== 'string' || !isAbsolute(executable)) return { status: 'not-configured' };
  if (busy) return { status: 'busy' };
  busy = true;
  const signal = options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(60_000)])
    : AbortSignal.timeout(60_000);
  let directory;
  try {
    signal.throwIfAborted();
    directory = await mkdtemp(join(tmpdir(), 'meow-guide-mouth-'));
    const audio = join(directory, 'speech.wav');
    await writeFile(audio, bytes, { mode: 0o600, signal });
    const { stdout } = await (options.run || run)(executable, ['-f', 'json', audio], {
      signal, timeout: 60_000, maxBuffer: 1024 * 1024, encoding: 'utf8',
      killSignal: 'SIGKILL',
    });
    const mouthCues = validateMouthCues(JSON.parse(stdout));
    return mouthCues ? { status: 'ok', mouthCues } : { status: 'invalid-response' };
  } catch {
    return { status: signal.aborted ? 'cancelled' : 'unavailable' };
  } finally {
    try {
      if (directory) await rm(directory, { recursive: true, force: true });
    } finally { busy = false; }
  }
}
