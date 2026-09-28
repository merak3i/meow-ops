import { useEffect, useRef, useState } from 'react';
import type { Session } from '@/types/session';
import { createVoiceboxGuideVoice, getLocalHelperBase, localGuideVoice } from './guide-voice';
import type { GuideVoice } from './guide-voice';
import { GuideCharacter } from './GuideCharacter';
import type { GuidePlayback } from './GuideCharacter';
import './sanctum-guide.css';

interface GuideAnswer {
  ok: boolean;
  error?: string;
  answer: string;
  kind: string;
  imported_at: string | null;
  unknowns: string[];
  evidence: { store: string; record_id: string; project: string; fields: Record<string, string | number | boolean | null> }[];
  capabilities: { id: string; status: string; source: string | null; fields: string[] }[];
  explanation?: { status: string; model?: string; answer?: string; citations?: string[] };
}

export function SanctumGuide({ session }: { session: Session | null }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const playback = useRef<GuidePlayback>({ audio: null, cues: null });
  const request = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const [question, setQuestion] = useState('What happened in this session?');
  const [answer, setAnswer] = useState<GuideAnswer | null>(null);
  const [status, setStatus] = useState('Ready');
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceId, setVoiceId] = useState('');
  const [rate, setRate] = useState(1);
  const [volume, setVolume] = useState(0.8);
  const [explain, setExplain] = useState(false);
  const voicebox = useRef<GuideVoice | null>(null);
  const [voiceboxAvailable, setVoiceboxAvailable] = useState(false);
  const [useVoicebox, setUseVoicebox] = useState(false);
  const stop = () => { sequence.current++; request.current?.abort(); localGuideVoice.cancel(); voicebox.current?.cancel(); setStatus('Stopped'); };
  useEffect(() => {
    const load = () => setVoices(speechSynthesis.getVoices().filter((voice) => voice.localService));
    if ('speechSynthesis' in window) {
      load();
      speechSynthesis.addEventListener('voiceschanged', load);
    }
    return () => {
      sequence.current++;
      request.current?.abort();
      localGuideVoice.cancel();
      voicebox.current?.cancel();
      if ('speechSynthesis' in window) speechSynthesis.removeEventListener('voiceschanged', load);
    };
  }, []);

  async function openGuide() {
    dialog.current?.showModal();
    setOpen(true);
    try {
      const base = getLocalHelperBase(import.meta.env.VITE_LOCAL_SYNC_URL);
      voicebox.current ??= createVoiceboxGuideVoice(base, (audio, cues) => { playback.current = { audio, cues }; });
      const response = await fetch(new URL('/loop-eng/guide-voice', base), { headers: { 'x-meow-ops-local': '1' }, redirect: 'error', signal: AbortSignal.timeout(6000) });
      const data = await response.json();
      const available = response.ok && data.available === true;
      setVoiceboxAvailable(available);
      if (!available) setUseVoicebox(false);
    } catch { setVoiceboxAvailable(false); setUseVoicebox(false); }
  }

  async function ask() {
    stop();
    const id = sequence.current;
    const controller = new AbortController();
    request.current = controller;
    setAnswer(null);
    setStatus('Reading local records…');
    const timeout = window.setTimeout(() => controller.abort(), explain ? 75_000 : 12_000);
    try {
      const base = getLocalHelperBase(import.meta.env.VITE_LOCAL_SYNC_URL);
      const response = await fetch(new URL('/loop-eng/sanctum-guide', base), {
        method: 'POST', signal: controller.signal,
        redirect: 'error',
        headers: { 'Content-Type': 'application/json', 'x-meow-ops-local': '1' },
        body: JSON.stringify({ question, session_id: session?.session_id, project: session?.project, explain }),
      });
      const data: GuideAnswer = await response.json();
      if (id !== sequence.current) return;
      if (!response.ok || !data.ok) throw new Error(data.error || 'The guide could not read this record.');
      setAnswer(data);
      setStatus('Ready');
    } catch (error) {
      if (id === sequence.current) setStatus(controller.signal.aborted ? 'The helper timed out. Retry or continue using the session panel.' : error instanceof TypeError ? 'Local helper unavailable. Check that it is running, then retry.' : error instanceof Error ? error.message : 'Local helper unavailable.');
    } finally { window.clearTimeout(timeout); }
  }

  function speak() {
    const voice = voices.find((item) => item.voiceURI === voiceId) || voices.find((item) => item.lang.startsWith('en')) || voices[0];
    if ((!useVoicebox && !voice) || !answer) return;
    stop();
    const id = sequence.current;
    const text = answer.explanation?.status === 'ok' ? `Local model interpretation. ${answer.explanation.answer}` : answer.answer;
    if (useVoicebox && text.length > 1500) { setStatus('This answer is too long for the Voicebox sample. Choose the system voice to read it in full.'); return; }
    const adapter = useVoicebox ? voicebox.current : localGuideVoice;
    if (!adapter) return;
    setStatus(useVoicebox ? 'Preparing local speech…' : 'Speaking');
    adapter.speak(text, voice || null, rate, volume,
      () => { if (id === sequence.current) setStatus('Ready'); },
      () => { if (id === sequence.current) setStatus('Audio unavailable. The answer remains below.'); },
      () => { if (id === sequence.current) setStatus('Speaking'); });
  }

  return <>
    <button className="guide-open" onClick={() => { void openGuide(); }}>Ask the guide</button>
    <dialog ref={dialog} className="sanctum-guide" aria-labelledby="guide-title" onClose={() => { stop(); setOpen(false); }} onCancel={stop} onKeyDown={(event) => event.stopPropagation()} onKeyUp={(event) => event.stopPropagation()}>
      <header><div><small>SANCTUM · READ-ONLY PROTOTYPE</small><h2 id="guide-title">Sanctum archive guide</h2></div><button onClick={() => dialog.current?.close()} aria-label="Close guide">Close</button></header>
      <p className="guide-intro">A quiet place to understand your agent’s work. The lifelike character is in development; this prototype reads session metrics, shows linked local evidence and explains concepts.</p>
      {open && <GuideCharacter playback={playback} motion={status === 'Speaking' ? 'explaining_gesture' : ['Reading local records…', 'Preparing local speech…'].includes(status) ? 'listening' : 'idle'} />}
      <p>{session ? <>Selected session: <strong>{session.project}</strong><br /><code>{session.session_id}</code></> : 'Select a session character in the archive to ask about its work. Concept explanations work without a selection.'}</p>
      <form onSubmit={(event) => { event.preventDefault(); void ask(); }}>
        <label htmlFor="guide-question">Your question</label>
        <textarea id="guide-question" value={question} maxLength={500} required onChange={(event) => setQuestion(event.target.value)} />
        <label><input type="checkbox" checked={explain} onChange={(event) => { stop(); setExplain(event.target.checked); }} />Explain linked evidence with local Qwen3 4B. Selected redacted excerpts stay on this computer.</label>
        <div className="guide-actions"><button type="submit">Ask</button><button type="button" onClick={stop}>Stop</button><button type="button" onClick={() => setQuestion('Explain context windows')}>Explain context windows</button></div>
      </form>
      <p role="status">{status}</p>
      {answer && <section aria-label="Guide answer">
        <small>{answer.kind === 'explanation' ? 'GENERAL EXPLANATION' : answer.kind === 'observed-metrics' ? 'IMPORTED SESSION METRICS' : answer.kind === 'observed-events' ? 'IMPORTED EVENT EVIDENCE' : 'CAPABILITY LIMIT'}</small>
        {answer.kind === 'observed-events' && <ol>{answer.evidence.map((item) => <li key={item.record_id}><p><strong>{String(item.fields.event_type)}</strong> · {String(item.fields.timestamp)}</p><blockquote>{String(item.fields.excerpt)}</blockquote><code>{item.record_id}</code></li>)}</ol>}
        <p className="guide-answer">{answer.answer}</p>
        {answer.explanation?.status === 'ok' && <section aria-label="Local model interpretation"><small>LOCAL MODEL INTERPRETATION · CHECK AGAINST THE RECORDS</small><p>{answer.explanation.answer}</p><p>Model: {answer.explanation.model}. Cited records: {answer.explanation.citations?.join(', ')}</p></section>}
        {answer.explanation && answer.explanation.status !== 'ok' && <p>{answer.explanation.status === 'busy' ? 'The local guide is already preparing another explanation. Try again when it finishes.' : `The local model explanation is unavailable (${answer.explanation.status}).`} The original evidence remains available below.</p>}
        {answer.unknowns.length > 0 && <ul>{answer.unknowns.map((item) => <li key={item}>{item}</li>)}</ul>}
        <label><input type="checkbox" checked={useVoicebox} disabled={!voiceboxAvailable} onChange={(event) => { stop(); setUseVoicebox(event.target.checked); }} />Use local Voicebox · George synthetic preset{!voiceboxAvailable ? ' (unavailable)' : ''}</label>
        {useVoicebox && <p>Voicebox stores the spoken answer and generated audio in its local history on this Mac. No voice is cloned. Sample limit: 1,500 characters.</p>}
        <div className="guide-actions"><button disabled={useVoicebox ? !voiceboxAvailable : !voices.length} onClick={speak}>Read aloud / replay</button><button onClick={stop}>Mute / stop</button></div>
        <label>Sample system voice<select value={voiceId} onChange={(event) => { stop(); setVoiceId(event.target.value); }}><option value="">Local English voice</option>{voices.map((voice) => <option key={voice.voiceURI} value={voice.voiceURI}>{voice.name} · {voice.lang}</option>)}</select></label>
        {!voices.length && <p>No local speech voice is available in this browser. Text remains available.</p>}
        <div className="guide-actions"><label>Speed<input aria-label="Speech speed" type="range" min="0.7" max="1.3" step="0.1" value={rate} onChange={(event) => { stop(); setRate(Number(event.target.value)); }} /></label><label>Volume<input aria-label="Speech volume" type="range" min="0" max="1" step="0.1" value={volume} onChange={(event) => { stop(); setVolume(Number(event.target.value)); }} /></label></div>
        <details><summary>Evidence and available capabilities</summary>
          <p>Session metrics imported: {answer.imported_at || 'unavailable'}. Event timestamps are shown separately. Coverage is the selected session’s available records, not a live transcript.</p>
          {answer.evidence.map((item) => <div key={item.record_id}><p><strong>{item.store}</strong><br /><code>{item.record_id}</code></p><dl>{Object.entries(item.fields).map(([field, value]) => <div key={field}><dt>{field}</dt><dd>{value === null ? 'unavailable' : String(value)}</dd></div>)}</dl></div>)}
          <ul>{answer.capabilities.map((item) => <li key={item.id}>{item.id}: {item.status}{item.source ? ` · ${item.source}` : ''}</li>)}</ul>
        </details>
      </section>}
    </dialog>
  </>;
}
