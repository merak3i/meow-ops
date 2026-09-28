import { validateMouthCues } from './guide-mouth.mjs';
import type { MouthCue } from './guide-mouth.mjs';

export interface GuideVoice {
  speak(text: string, voice: SpeechSynthesisVoice | null, rate: number, volume: number, onEnd: () => void, onError: () => void, onStart?: () => void): void;
  cancel(): void;
}

const LOCAL_HELPER_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

export function getLocalHelperBase(value: string | URL = 'http://127.0.0.1:7337'): URL {
  let base: URL;
  try { base = new URL(value); }
  catch { throw new Error('The guide requires a local helper.'); }
  if (base.protocol !== 'http:' || !LOCAL_HELPER_HOSTS.has(base.hostname) || base.username || base.password) {
    throw new Error('The guide requires a local helper.');
  }
  return base;
}

// Prototype adapter. Uses only voices the browser identifies as local.
export const localGuideVoice: GuideVoice = {
  speak(text, voice, rate, volume, onEnd, onError, onStart) {
    if (!voice?.localService) { onError(); return; }
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = voice;
    utterance.rate = rate;
    utterance.volume = volume;
    utterance.onend = onEnd;
    utterance.onerror = onError;
    utterance.onstart = onStart || null;
    speechSynthesis.speak(utterance);
  },
  cancel() { if ('speechSynthesis' in window) speechSynthesis.cancel(); },
};

export function createVoiceboxGuideVoice(base: URL, onPlayback?: (audio: HTMLAudioElement | null, cues: MouthCue[] | null) => void): GuideVoice {
  base = getLocalHelperBase(base);
  let controller: AbortController | null = null;
  let audio: HTMLAudioElement | null = null;
  let objectUrl: string | null = null;
  let cachedText = '';
  let cachedBlob: Blob | null = null;
  let cachedCues: MouthCue[] | null = null;
  const cancel = () => {
    controller?.abort();
    controller = null;
    if (audio) { audio.onended = null; audio.onerror = null; audio.onplay = null; audio.pause(); audio.removeAttribute('src'); audio.load(); audio = null; }
    if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
    onPlayback?.(null, null);
  };
  return {
    cancel,
    speak(text, _voice, rate, volume, onEnd, onError, onStart) {
      cancel();
      const current = new AbortController();
      controller = current;
      const timeout = window.setTimeout(() => current.abort(), 95_000);
      void (async () => {
        try {
          let blob = text === cachedText ? cachedBlob : null;
          let cues = text === cachedText ? cachedCues : null;
          if (!blob) {
            const response = await fetch(new URL('/loop-eng/guide-voice', base), {
              method: 'POST', signal: current.signal,
              redirect: 'error',
              headers: { 'Content-Type': 'application/json', 'x-meow-ops-local': '1' },
              body: JSON.stringify({ text, align: Boolean(onPlayback) }),
            });
            if (!response.ok) throw new Error('Voice unavailable');
            if (onPlayback && response.headers.get('content-type')?.startsWith('application/json')) {
              const data = await response.json();
              if (data.mime !== 'audio/wav' || typeof data.audio !== 'string' || data.audio.length > 17 * 1024 * 1024) throw new Error('Invalid audio');
              const raw = atob(data.audio);
              if (raw.slice(0, 4) !== 'RIFF' || raw.slice(8, 12) !== 'WAVE') throw new Error('Invalid WAV');
              blob = new Blob([Uint8Array.from(raw, char => char.charCodeAt(0))], { type: 'audio/wav' });
              cues = data.alignment?.status === 'ok' ? validateMouthCues(data.alignment) : null;
            } else {
              if (!response.headers.get('content-type')?.startsWith('audio/wav')) throw new Error('Voice unavailable');
              blob = await response.blob();
            }
          }
          if (controller !== current || current.signal.aborted) return;
          cachedText = text;
          cachedBlob = blob;
          cachedCues = cues;
          window.clearTimeout(timeout);
          objectUrl = URL.createObjectURL(blob);
          audio = new Audio(objectUrl);
          audio.playbackRate = rate;
          audio.volume = volume;
          onPlayback?.(audio, cues);
          audio.onended = () => { cancel(); onEnd(); };
          audio.onerror = () => { cancel(); onError(); };
          audio.onplay = onStart || null;
          await audio.play();
        } catch {
          if (controller === current) { cancel(); onError(); }
        } finally { window.clearTimeout(timeout); }
      })();
    },
  };
}
