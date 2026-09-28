import { setTimeout as delay } from 'node:timers/promises';
import { redactEvidenceText } from './project-evidence.mjs';
import { alignGuideMouth } from './guide-mouth-alignment.mjs';

const MAX_AUDIO_BYTES = 12 * 1024 * 1024;
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
let busy = false;

function configuration(env) {
  if (!validId(env.MEOW_GUIDE_VOICEBOX_PROFILE)) return null;
  try {
    const base = new URL(env.MEOW_GUIDE_VOICEBOX_URL || 'http://127.0.0.1:17493');
    if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1' || base.username || base.password || base.pathname !== '/' || base.search || base.hash) return null;
    return { base, profile: env.MEOW_GUIDE_VOICEBOX_PROFILE };
  } catch { return null; }
}

export async function guideVoiceStatus(options = {}) {
  const config = configuration(options.env || process.env);
  if (!config) return { available: false, status: 'not-configured' };
  const fetcher = options.fetch || fetch;
  const signal = options.signal || AbortSignal.timeout(5000);
  try {
    const [models, profile] = await Promise.all([
      fetcher(new URL('/models/status', config.base), { redirect: 'error', signal }),
      fetcher(new URL(`/profiles/${config.profile}`, config.base), { redirect: 'error', signal }),
    ]);
    if (!models.ok || !profile.ok) return { available: false, status: 'unavailable' };
    const modelData = await models.json();
    const voice = await profile.json();
    if (voice.voice_type !== 'preset' || voice.preset_engine !== 'kokoro' || voice.preset_voice_id !== 'bm_george') return { available: false, status: 'preset-required' };
    if (!modelData.models?.some(model => model.model_name === 'kokoro' && model.downloaded && !model.downloading)) return { available: false, status: 'model-not-downloaded' };
    return { available: true, status: 'ready', voice: 'Kokoro George preset' };
  } catch { return { available: false, status: 'unavailable' }; }
}

// Generate only explicitly requested speech. Voicebox retains its local history;
// no audio path, profile metadata, cloud endpoint or private history is exposed.
export async function generateGuideVoice(text, options = {}) {
  if (typeof text !== 'string' || !text.trim() || text.length > 1500) return { status: 'invalid-text' };
  const config = configuration(options.env || process.env);
  if (!config) return { status: 'not-configured' };
  if (busy) return { status: 'busy' };
  busy = true;
  const fetcher = options.fetch || fetch;
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(90_000)]) : AbortSignal.timeout(90_000);
  let generation;
  let completed = false;
  try {
    const readiness = await guideVoiceStatus({ ...options, signal });
    if (!readiness.available) return { status: readiness.status };
    const response = await fetcher(new URL('/generate', config.base), {
      method: 'POST', redirect: 'error', signal, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile_id: config.profile, text: redactEvidenceText(text.trim()), language: 'en', engine: 'kokoro', personality: false, effects_chain: [], seed: 17 }),
    });
    if (!response.ok) return { status: 'unavailable' };
    let item = await response.json();
    if (!validId(item.id)) return { status: 'invalid-response' };
    generation = item.id;
    while (item.status !== 'completed') {
      if (!['pending', 'queued', 'generating'].includes(item.status)) return { status: 'generation-failed' };
      await (options.delay || delay)(500, undefined, { signal });
      const poll = await fetcher(new URL(`/history/${generation}`, config.base), { redirect: 'error', signal });
      if (!poll.ok) return { status: 'unavailable' };
      item = await poll.json();
    }
    completed = true;
    const audio = await fetcher(new URL(`/audio/${generation}`, config.base), { redirect: 'error', signal });
    if (!audio.ok || !/^audio\/(wav|x-wav|wave)(;|$)/i.test(audio.headers.get('content-type') || '')) return { status: 'invalid-audio' };
    const chunks = [];
    let size = 0;
    for await (const chunk of audio.body) {
      size += chunk.byteLength;
      if (size > MAX_AUDIO_BYTES) return { status: 'audio-too-large' };
      chunks.push(Buffer.from(chunk));
    }
    const bytes = Buffer.concat(chunks);
    if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') return { status: 'invalid-audio' };
    if (options.align === true) {
      const alignment = await (options.alignMouth || alignGuideMouth)(bytes, { env: options.env || process.env, signal });
      if (signal.aborted) return { status: 'cancelled' };
      return { status: 'ok', bytes, alignment };
    }
    return { status: 'ok', bytes };
  } catch { return { status: signal.aborted ? 'cancelled' : 'unavailable' }; }
  finally {
    if (generation && !completed) {
      try { await fetcher(new URL(`/generate/${generation}/cancel`, config.base), { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(3000) }); } catch { /* Keep failures local and sanitized. */ }
    }
    busy = false;
  }
}
