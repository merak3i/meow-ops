import test from 'node:test';
import assert from 'node:assert/strict';
import { access, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { alignGuideMouth } from '../guide-mouth-alignment.mjs';

const audio = Buffer.alloc(44);
audio.write('RIFF');
audio.write('WAVE', 8);
const env = { MEOW_GUIDE_RHUBARB_BIN: '/local/rhubarb' };
const stdout = JSON.stringify({ metadata: { soundFile: '/private/speech.wav' }, mouthCues: [{ start: 0, end: 1, value: 'A', private: 'omit' }] });

test('alignment projects only cues and removes private audio after success', async () => {
  let path;
  const result = await alignGuideMouth(audio, { env, run: async (binary, args, options) => {
    assert.equal(binary, env.MEOW_GUIDE_RHUBARB_BIN);
    path = args[2];
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.equal((await stat(dirname(path))).mode & 0o777, 0o700);
    assert.equal(options.maxBuffer, 1024 * 1024);
    assert.equal(options.killSignal, 'SIGKILL');
    return { stdout };
  } });
  assert.deepEqual(result, { status: 'ok', mouthCues: [{ start: 0, end: 1, value: 'A' }] });
  await assert.rejects(access(dirname(path)), { code: 'ENOENT' });
});

test('failed and cancelled alignment clean up and release capacity', async () => {
  let path;
  const controller = new AbortController();
  const result = await alignGuideMouth(audio, { env, signal: controller.signal, run: async (_binary, args) => {
    path = args[2];
    assert.deepEqual(await alignGuideMouth(audio, { env }), { status: 'busy' });
    controller.abort();
    throw new Error('private analyzer failure');
  } });
  assert.deepEqual(result, { status: 'cancelled' });
  await assert.rejects(access(dirname(path)), { code: 'ENOENT' });
  assert.deepEqual(await alignGuideMouth(audio, { env, run: async () => { throw new Error('private'); } }), { status: 'unavailable' });
  assert.equal((await alignGuideMouth(audio, { env, run: async () => ({ stdout }) })).status, 'ok');
});

test('invalid audio, configuration and analyzer cues fail closed', async () => {
  assert.equal((await alignGuideMouth(Buffer.alloc(10), { env })).status, 'invalid-audio');
  assert.equal((await alignGuideMouth(Buffer.alloc(13 * 1024 * 1024), { env })).status, 'invalid-audio');
  assert.equal((await alignGuideMouth(audio, { env: {} })).status, 'not-configured');
  assert.equal((await alignGuideMouth(audio, { env: { MEOW_GUIDE_RHUBARB_BIN: 'rhubarb' } })).status, 'not-configured');
  assert.equal((await alignGuideMouth(audio, { env, run: async () => ({ stdout: '{"mouthCues":[]}' }) })).status, 'invalid-response');
});
