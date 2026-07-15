import { FormEvent, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Cat, Check, LockKeyhole, RotateCcw, Save, ShieldCheck } from 'lucide-react';
import {
  fetchCompanionSoul, resetCompanionSoul, saveCompanionSoul,
} from '../../lib/loop-api';
import type {
  CompanionSoulProfile, SoulPreset, SoulPresetId, UncertaintyPolicy,
} from '../../lib/loop-api';
import './SoulStudio.css';

const FALLBACK_PRESETS: SoulPreset[] = [
  {
    id: 'clear-operator', name: 'Clear Operator', description: 'Direct, compact, and action-first.',
    instruction: 'Lead with the outcome. Use compact language and end with the smallest useful next action.',
  },
  {
    id: 'warm-strategist', name: 'Warm Strategist', description: 'Thoughtful, encouraging, and decision-oriented.',
    instruction: 'Sound like a trusted strategic partner. Be warm without padding. Make tradeoffs easy to evaluate.',
  },
  {
    id: 'critical-partner', name: 'Critical Partner', description: 'Challenges assumptions and protects focus.',
    instruction: 'Pressure-test assumptions. Name contradictions and opportunity costs plainly, then recommend a path.',
  },
  {
    id: 'curious-explorer', name: 'Curious Explorer', description: 'Surfaces patterns, possibilities, and missing questions.',
    instruction: 'Look for overlooked patterns and useful questions. Keep possibilities separate from verified facts.',
  },
];

export const DEFAULT_SOUL_PROFILE: CompanionSoulProfile = {
  schema_version: 1,
  profile_id: 'primary',
  revision: 0,
  updated_at: null,
  name: 'Companion',
  preset: 'clear-operator',
  custom_instructions: '',
  uncertainty_policy: 'evidence-led',
  memory: { session_metrics: true, project_facts: true, inferred_claims: true },
  model_synthesis: true,
};

const UNCERTAINTY_OPTIONS: Array<{ id: UncertaintyPolicy; label: string; detail: string }> = [
  { id: 'strict', label: 'Strict evidence', detail: 'Stops when verified evidence runs out.' },
  { id: 'evidence-led', label: 'Evidence-led', detail: 'Shows clearly labeled hypotheses for confirmation.' },
  { id: 'exploratory', label: 'Exploratory', detail: 'Surfaces possibilities while preserving every evidence label.' },
];

const MATRIX = [
  ['Known known', 'Verified', 'Answer from local evidence.'],
  ['Known unknown', 'Needs teaching', 'Ask one focused question.'],
  ['Unknown known', 'Hypothesis', 'Surface and request confirmation.'],
  ['Unknown unknown', 'Blind spot', 'Name the missing reasoning path.'],
] as const;

type Props = {
  onClose: () => void;
  onProfile: (profile: CompanionSoulProfile) => void;
};

function cloneProfile(profile: CompanionSoulProfile): CompanionSoulProfile {
  return { ...profile, memory: { ...profile.memory } };
}

export default function SoulStudio({ onClose, onProfile }: Props) {
  const [profile, setProfile] = useState<CompanionSoulProfile>(() => cloneProfile(DEFAULT_SOUL_PROFILE));
  const [presets, setPresets] = useState<SoulPreset[]>(FALLBACK_PRESETS);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<'loading' | 'ready' | 'saved' | 'offline' | 'error'>('loading');

  useEffect(() => {
    let mounted = true;
    fetchCompanionSoul().then((result) => {
      if (!mounted) return;
      if (result?.profile) {
        setProfile(cloneProfile(result.profile));
        onProfile(result.profile);
        if (result.presets?.length) setPresets(result.presets);
        setStatus(result.profile.updated_at ? 'saved' : 'ready');
      } else {
        setStatus('offline');
      }
    });
    return () => { mounted = false; };
  }, [onProfile]);

  const selected = useMemo(
    () => presets.find((preset) => preset.id === profile.preset) || presets[0],
    [presets, profile.preset],
  );

  function selectPreset(id: SoulPresetId) {
    setProfile((current) => ({ ...current, preset: id }));
    setStatus('ready');
  }

  function setMemory(key: keyof CompanionSoulProfile['memory'], value: boolean) {
    setProfile((current) => ({
      ...current,
      memory: {
        ...current.memory,
        [key]: value,
        ...(key === 'project_facts' && !value ? { inferred_claims: false } : {}),
      },
    }));
    setStatus('ready');
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!profile.name.trim() || busy) return;
    setBusy(true);
    const result = await saveCompanionSoul({ ...profile, name: profile.name.trim() });
    if (result?.profile) {
      setProfile(cloneProfile(result.profile));
      onProfile(result.profile);
      setStatus('saved');
    } else {
      setStatus(result ? 'error' : 'offline');
    }
    setBusy(false);
  }

  async function reset() {
    if (busy) return;
    setBusy(true);
    const result = await resetCompanionSoul();
    if (result?.profile) {
      setProfile(cloneProfile(result.profile));
      onProfile(result.profile);
      setStatus('saved');
    } else {
      setStatus(result ? 'error' : 'offline');
    }
    setBusy(false);
  }

  return (
    <form className="soul-studio" onSubmit={save}>
      <header className="soul-studio__heading">
        <button type="button" onClick={onClose} aria-label="Back to chat"><ArrowLeft size={15} /></button>
        <div><p>PERSONALIZATION</p><h2>Soul Studio</h2><span>Shape how Companion thinks with you.</span></div>
        <span className="soul-studio__revision">v{profile.revision}</span>
      </header>

      <section className="soul-studio__preview" aria-label="Soul preview">
        <span><Cat size={20} /></span>
        <div><strong>{profile.name || 'Companion'}</strong><small>{selected?.name}</small><p>{selected?.instruction}</p></div>
      </section>

      <section className="soul-studio__section">
        <div className="soul-studio__section-title"><div><h3>Identity</h3><p>Pick a foundation, then make it yours.</p></div></div>
        <label className="soul-studio__field">Companion name<input aria-label="Companion name" value={profile.name} maxLength={40} onChange={(event) => { setProfile({ ...profile, name: event.target.value }); setStatus('ready'); }} /></label>
        <div className="soul-studio__presets">
          {presets.map((preset) => (
            <button key={preset.id} type="button" aria-pressed={profile.preset === preset.id} onClick={() => selectPreset(preset.id)}>
              <span>{profile.preset === preset.id && <Check size={11} />}{preset.name}</span><small>{preset.description}</small>
            </button>
          ))}
        </div>
      </section>

      <section className="soul-studio__section">
        <div className="soul-studio__section-title"><div><h3>Owner meta-prompt</h3><p>Your durable working preferences, applied after the preset.</p></div></div>
        <label className="soul-studio__field soul-studio__field--textarea">
          Custom instructions
          <textarea aria-label="Owner meta-prompt" value={profile.custom_instructions} maxLength={8000} rows={6} placeholder="Example: Lead with the decision. Challenge scope creep. Keep the next action concrete." onChange={(event) => { setProfile({ ...profile, custom_instructions: event.target.value }); setStatus('ready'); }} />
          <small>{profile.custom_instructions.length.toLocaleString()} / 8,000</small>
        </label>
      </section>

      <section className="soul-studio__section">
        <div className="soul-studio__section-title"><div><h3>Uncertainty posture</h3><p>Choose how Companion behaves at the edge of its knowledge.</p></div></div>
        <div className="soul-studio__uncertainty">
          {UNCERTAINTY_OPTIONS.map((option) => (
            <label key={option.id}>
              <input type="radio" name="uncertainty" value={option.id} checked={profile.uncertainty_policy === option.id} onChange={() => { setProfile({ ...profile, uncertainty_policy: option.id }); setStatus('ready'); }} />
              <span><strong>{option.label}</strong><small>{option.detail}</small></span>
            </label>
          ))}
        </div>
      </section>

      <section className="soul-studio__section">
        <div className="soul-studio__section-title"><div><h3>Memory permissions</h3><p>Control which local evidence may shape an answer.</p></div></div>
        <div className="soul-studio__switches">
          <label><span><strong>Session metrics</strong><small>Time, cost, source, and activity aggregates.</small></span><input type="checkbox" aria-label="Use session metrics" checked={profile.memory.session_metrics} onChange={(event) => setMemory('session_metrics', event.target.checked)} /></label>
          <label><span><strong>Confirmed project facts</strong><small>Your saved missions, outcomes, priorities, and constraints.</small></span><input type="checkbox" aria-label="Use confirmed project facts" checked={profile.memory.project_facts} onChange={(event) => setMemory('project_facts', event.target.checked)} /></label>
          <label className={!profile.memory.project_facts ? 'is-disabled' : ''}><span><strong>Unconfirmed hypotheses</strong><small>Patterns that still require confirmation.</small></span><input type="checkbox" aria-label="Use unconfirmed hypotheses" disabled={!profile.memory.project_facts || profile.uncertainty_policy === 'strict'} checked={profile.memory.inferred_claims && profile.uncertainty_policy !== 'strict'} onChange={(event) => setMemory('inferred_claims', event.target.checked)} /></label>
          <label><span><strong>Model synthesis for blind spots</strong><small>Allow labeled model help when deterministic evidence ends.</small></span><input type="checkbox" aria-label="Allow model synthesis" disabled={profile.uncertainty_policy === 'strict'} checked={profile.model_synthesis && profile.uncertainty_policy !== 'strict'} onChange={(event) => { setProfile({ ...profile, model_synthesis: event.target.checked }); setStatus('ready'); }} /></label>
        </div>
      </section>

      <section className="soul-studio__contract">
        <header><LockKeyhole size={14} /><div><h3>Evidence gates cannot be overridden</h3><p>Your soul changes voice and exploration, never truth status.</p></div></header>
        <div>{MATRIX.map(([name, gate, behavior]) => <p key={name}><strong>{name}</strong><span>{gate}</span><small>{behavior}</small></p>)}</div>
      </section>

      <footer className="soul-studio__footer">
        <span className={`soul-studio__status soul-studio__status--${status}`}>
          {status === 'loading' && 'Loading private profile'}
          {status === 'saved' && <><ShieldCheck size={12} /> Saved locally</>}
          {status === 'offline' && 'Local helper offline. Preview only.'}
          {status === 'error' && 'Could not save this profile.'}
          {status === 'ready' && (profile.updated_at ? 'Unsaved changes' : 'Private by default')}
        </span>
        <div><button type="button" onClick={() => void reset()} disabled={busy}><RotateCcw size={12} /> Reset</button><button type="submit" disabled={busy || !profile.name.trim()}><Save size={12} /> Save soul</button></div>
      </footer>
    </form>
  );
}
