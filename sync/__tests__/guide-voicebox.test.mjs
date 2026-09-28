import assert from 'node:assert/strict';
import test from 'node:test';
import { generateGuideVoice, guideVoiceStatus } from '../guide-voicebox.mjs';

const env = { MEOW_GUIDE_VOICEBOX_PROFILE: 'fixture-profile' };
const json = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
const wav = Buffer.from('RIFF0000WAVEfixture');
function fixture(overrides = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url: String(url), ...init });
    const path = url.pathname;
    if (overrides[path]) return overrides[path](init);
    if (path === '/models/status') return json({ models: [{ model_name: 'kokoro', downloaded: true }] });
    if (path === '/profiles/fixture-profile') return json({ voice_type: 'preset', preset_engine: 'kokoro', preset_voice_id: 'bm_george' });
    if (path === '/generate') return json({ id: 'fixture-generation', status: 'generating' });
    if (path === '/history/fixture-generation') return json({ status: 'completed' });
    if (path === '/audio/fixture-generation') return new Response(wav, { headers: { 'Content-Type': 'audio/wav' } });
    if (path.endsWith('/cancel')) return json({ ok: true });
    throw new Error('Unexpected fixture request');
  };
  return { fetch, calls, env, delay: async () => {} };
}

test('disabled and non-loopback configurations cannot send speech', async () => {
  let calls = 0;
  const fetch = async () => { calls++; throw Error('must not call'); };
  for (const config of [{}, { ...env, MEOW_GUIDE_VOICEBOX_URL: 'https://example.com' }, { ...env, MEOW_GUIDE_VOICEBOX_URL: 'http://127.0.0.1/path' }]) {
    assert.equal((await guideVoiceStatus({ env: config, fetch })).available, false);
    assert.equal((await generateGuideVoice('test', { env: config, fetch })).status, 'not-configured');
  }
  assert.equal(calls, 0);
});

test('only downloaded synthetic preset is enabled; no model downloads or clones', async () => {
  const options = fixture({ '/profiles/fixture-profile': () => json({ voice_type: 'cloned' }) });
  assert.equal((await generateGuideVoice('test', options)).status, 'preset-required');
  assert.equal(options.calls.length, 2);
});

test('speech is redacted, does not rewrite facts, returns bounded WAV and never exposes paths', async () => {
  const options = fixture();
  const result = await generateGuideVoice('password=not-a-real-secret, test passed', options);
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.bytes, wav);
  const request = JSON.parse(options.calls.find(call => call.method === 'POST').body);
  assert.doesNotMatch(request.text, /not-a-real-secret/);
  assert.equal(request.personality, false);
  assert.equal(request.engine, 'kokoro');
  assert.ok(options.calls.every(call => call.redirect === 'error' && call.url.startsWith('http://127.0.0.1:17493/')));
});

test('cancelling speech cancels only its created generation', async () => {
  const controller = new AbortController();
  const options = fixture();
  options.signal = controller.signal;
  options.delay = async () => { controller.abort(); throw new Error('aborted'); };
  assert.equal((await generateGuideVoice('test', options)).status, 'cancelled');
  assert.equal(options.calls.at(-1).url, 'http://127.0.0.1:17493/generate/fixture-generation/cancel');
});

test('bad audio and generation IDs cannot become playback or arbitrary URL requests', async () => {
  const invalidId = fixture({ '/generate': () => json({ id: '../other', status: 'completed' }) });
  assert.equal((await generateGuideVoice('test', invalidId)).status, 'invalid-response');
  const invalidAudio = fixture({ '/audio/fixture-generation': () => new Response('not audio', { headers: { 'Content-Type': 'audio/wav' } }) });
  assert.equal((await generateGuideVoice('test', invalidAudio)).status, 'invalid-audio');
  assert.equal((await generateGuideVoice('x'.repeat(1501), fixture())).status, 'invalid-text');
});

test('optional mouth alignment uses generated audio and preserves audio on alignment failure', async () => {
  const options = fixture();
  options.align = true;
  options.alignMouth = async (bytes, settings) => {
    assert.deepEqual(bytes, wav);
    assert.equal(settings.env, env);
    assert.ok(settings.signal instanceof AbortSignal);
    return { status: 'unavailable' };
  };
  const result = await generateGuideVoice('test', options);
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.bytes, wav);
  assert.deepEqual(result.alignment, { status: 'unavailable' });
  const controller = new AbortController();
  options.signal = controller.signal;
  options.alignMouth = async () => { controller.abort(); return { status: 'cancelled' }; };
  assert.equal((await generateGuideVoice('test', options)).status, 'cancelled');
});
