import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { setImmediate } from 'node:timers/promises';
import ts from 'typescript';

const source = readFileSync(new URL('../guide-voice.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace("'./guide-mouth.mjs'", JSON.stringify(new URL('../guide-mouth.mjs', import.meta.url).href));
const { createVoiceboxGuideVoice, getLocalHelperBase } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('local helper URLs accept loopback and reject remote or credentialed hosts', () => {
  assert.equal(getLocalHelperBase().origin, 'http://127.0.0.1:7337');
  assert.equal(getLocalHelperBase('http://localhost:7444').origin, 'http://localhost:7444');
  assert.equal(getLocalHelperBase('http://[::1]:7555').origin, 'http://[::1]:7555');
  for (const value of ['https://localhost:7337', 'http://example.com:7337', 'http://user:pass@127.0.0.1:7337']) {
    assert.throws(() => getLocalHelperBase(value), /local helper/);
  }
});

test('aligned speech supplies validated cues, caches replay and clears animation on Stop', async (t) => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalAudio = Object.getOwnPropertyDescriptor(globalThis, 'Audio');
  globalThis.window = { setTimeout, clearTimeout };
  globalThis.Audio = class { async play() {} pause() {} removeAttribute() {} load() {} };
  t.after(() => {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow); else delete globalThis.window;
    if (originalAudio) Object.defineProperty(globalThis, 'Audio', originalAudio); else delete globalThis.Audio;
  });
  t.mock.method(URL, 'createObjectURL', () => 'blob:aligned');
  t.mock.method(URL, 'revokeObjectURL', () => {});
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    requests++;
    assert.equal(options.redirect, 'error');
    assert.equal(JSON.parse(options.body).align, true);
    return Response.json({ mime: 'audio/wav', audio: Buffer.from('RIFF0000WAVEfixture').toString('base64'), alignment: {
      status: 'ok', metadata: { soundFile: '/private/fixture' }, mouthCues: [{ start: 0, end: 1, value: 'A' }],
    } });
  });
  let active;
  const adapter = createVoiceboxGuideVoice(new URL('http://127.0.0.1:7437'), (audio, cues) => { active = { audio, cues }; });
  t.after(() => adapter.cancel());
  const speak = () => adapter.speak('aligned answer', null, 1, .8, () => {}, () => assert.fail('speech failed'));
  speak(); await setImmediate();
  assert.ok(active.audio);
  assert.deepEqual(active.cues, [{ start: 0, end: 1, value: 'A' }]);
  adapter.cancel(); assert.deepEqual(active, { audio: null, cues: null });
  speak(); await setImmediate();
  assert.equal(requests, 1);
  assert.deepEqual(active.cues, [{ start: 0, end: 1, value: 'A' }]);
});

test('voice playback reports start, reuses replay audio and cancels stale speech', async (t) => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousAudio = Object.getOwnPropertyDescriptor(globalThis, 'Audio');
  const players = [];
  let calls = 0;
  let revoked = 0;
  let started = 0;
  let ended = 0;
  globalThis.window = { setTimeout, clearTimeout };
  globalThis.Audio = class {
    constructor() { this.paused = false; players.push(this); }
    async play() { this.onplay?.(); }
    pause() { this.paused = true; }
    removeAttribute() {}
    load() {}
  };
  t.after(() => {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow); else delete globalThis.window;
    if (previousAudio) Object.defineProperty(globalThis, 'Audio', previousAudio); else delete globalThis.Audio;
  });
  t.mock.method(URL, 'createObjectURL', () => 'blob:fixture');
  t.mock.method(URL, 'revokeObjectURL', () => { revoked++; });
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response('fixture', { headers: { 'Content-Type': 'audio/wav' } }); });
  const adapter = createVoiceboxGuideVoice(new URL('http://127.0.0.1:7437'));
  t.after(() => adapter.cancel());
  const speak = text => adapter.speak(text, null, 1, .8, () => { ended++; }, () => assert.fail('unexpected playback error'), () => { started++; });
  speak('same answer');
  await setImmediate();
  assert.equal(started, 1);
  players[0].onended();
  assert.equal(ended, 1);
  speak('same answer');
  await setImmediate();
  assert.equal(calls, 1, 'replay should not generate a second copy');
  adapter.cancel();
  assert.equal(players[1].paused, true);
  assert.equal(players[1].onended, null);
  assert.equal(revoked, 2);
  let finish;
  t.mock.method(globalThis, 'fetch', () => new Promise(resolve => { finish = resolve; }));
  speak('new answer');
  adapter.cancel();
  finish(new Response('fixture', { headers: { 'Content-Type': 'audio/wav' } }));
  await setImmediate();
  assert.equal(players.length, 2, 'a late response after Stop cannot play');
  assert.throws(() => createVoiceboxGuideVoice(new URL('https://example.com')));
});
