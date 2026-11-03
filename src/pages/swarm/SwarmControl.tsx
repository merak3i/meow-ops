import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Copy, CopyPlus, Plus, Sparkles, Trash2, Zap } from 'lucide-react';

import { Badge, Button, Card, EmptyState, Notice } from '../../components/ui';
import { AUTOSWARM_INSTALL_COMMAND, SAMPLE_SWARM, STATE_META, fetchSwarmSnapshot, isLocalSwarmSurface } from '../../lib/swarm-api';
import type { SwarmSnapshot } from '../../lib/swarm-api';
import {
  KIND_LABEL, TEMPLATES, emptyPlan, nextStepId, pipelineLayout, planProblems, planTemplate, stepCommand, swarmControl,
} from '../../lib/swarm-control';
import type { PlanDraft, PlanStep, StepKind, TemplateId } from '../../lib/swarm-control';
import { Pipeline } from './Pipeline';
import { RunMonitor } from './RunMonitor';
import type { ProviderChoice } from './RunMonitor';
import './control.css';

// Swarm · Control. Write the goal, break it into steps (by template, by hand,
// or by asking an agent), give each step a harness and optionally a native
// model and effort, check the pipeline, then dispatch. The run engine in the
// local helper hands each ready step to AutoSwarm and stitches upstream
// outputs into the steps that depend on them.

const PLAN_KEY = 'meow-ops-swarm-plan';
const EFFORT_HINTS: Readonly<Record<string, string[]>> = {
  codex: ['minimal', 'low', 'medium', 'high', 'xhigh'],
  'claude-code': ['low', 'medium', 'high', 'max'],
  grok: ['low', 'high'],
};
const STATE_ORDER = ['verified', 'replied', 'running', 'waiting', 'found', 'failing', 'off'];

function loadPlan(): PlanDraft | null {
  try {
    const value = JSON.parse(localStorage.getItem(PLAN_KEY) ?? 'null') as PlanDraft | null;
    return value && Array.isArray(value.steps) ? { ...emptyPlan(), ...value } : null;
  } catch { return null; }
}

function storePlan(plan: PlanDraft) {
  try { localStorage.setItem(PLAN_KEY, JSON.stringify(plan)); } catch { /* storage blocked */ }
}

export function providerChoices(snapshot: SwarmSnapshot): ProviderChoice[] {
  return snapshot.providers
    .filter((provider) => !provider.hidden && provider.state !== 'off')
    .sort((a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state))
    .map((provider) => {
      const catalog = provider.models ?? { effort: { supported: 'unknown' as const, evidence: null }, models: [] };
      const observed = snapshot.calls.filter((call) => call.provider === provider.id && call.effort).map((call) => call.effort as string);
      return {
        id: provider.id,
        name: provider.name,
        models: [...new Set([provider.model, ...catalog.models.map((model) => model.id)].filter((value): value is string => Boolean(value)))],
        efforts: [...new Set([provider.effort, ...observed, ...(EFFORT_HINTS[provider.id] ?? [])].filter((value): value is string => Boolean(value)))],
        effortSupported: catalog.effort.supported,
      };
    });
}

interface ControlProps {
  /** Opens a run that already exists, for links from Runs. */
  initialRunId?: string | null;
}

export default function SwarmControl({ initialRunId = null }: ControlProps) {
  const [local] = useState(isLocalSwarmSurface);
  const client = useMemo(() => swarmControl(), []);
  const [snapshot, setSnapshot] = useState<SwarmSnapshot | null>(local ? null : SAMPLE_SWARM);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlanDraft>(() => loadPlan() ?? emptyPlan());
  const [draftId, setDraftId] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(initialRunId);
  const [planRunId, setPlanRunId] = useState<string | null>(null);
  const [planner, setPlanner] = useState('');
  const [pendingTemplate, setPendingTemplate] = useState<TemplateId | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!local) return undefined;
    const controller = new AbortController();
    const read = () => fetchSwarmSnapshot(controller.signal).then((next) => { setSnapshot(next); setStatusError(null); }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setStatusError(reason instanceof Error ? reason.message : 'AutoSwarm status is unavailable.');
    });
    void read();
    const timer = window.setInterval(() => { if (!document.hidden) void read(); }, 30_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [local]);

  useEffect(() => { storePlan(plan); }, [plan]);
  useEffect(() => { if (initialRunId) setActiveRunId(initialRunId); }, [initialRunId]);

  const choices = useMemo(() => (snapshot ? providerChoices(snapshot) : []), [snapshot]);
  const byId = useMemo(() => new Map((snapshot?.providers ?? []).map((provider) => [provider.id, provider])), [snapshot]);
  const nameOf = useCallback((id: string) => byId.get(id)?.name ?? id, [byId]);
  const providerIds = choices.map((choice) => choice.id);
  const control = snapshot?.control ?? null;
  const canDispatch = local && Boolean(control?.dispatch) && control?.enabled !== false;

  // First visit: seed the workspace from the roster or the latest AutoSwarm call.
  useEffect(() => {
    if (!snapshot) return;
    setPlan((current) => (current.workspace || !snapshot.workspace ? current : { ...current, workspace: snapshot.workspace }));
    setPlanner((current) => current || choices[0]?.id || '');
    if (!local) setPlan((current) => (current.steps.length ? current : { ...current, title: 'Example: add rate limiting', brief: 'Add rate limiting to the public API with tests and a security review.', steps: planTemplate('build-review', providerIds) }));
  }, [snapshot]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (patch: Partial<PlanDraft>) => { setPlan((current) => ({ ...current, ...patch })); setDraftId(null); };
  const updateStep = (id: string, patch: Partial<PlanStep>) => update({ steps: plan.steps.map((item) => (item.id === id ? { ...item, ...patch } : item)) });
  const removeStep = (id: string) => update({ steps: plan.steps.filter((item) => item.id !== id).map((item) => ({ ...item, dependsOn: item.dependsOn.filter((dep) => dep !== id) })) });
  const moveStep = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    const steps = [...plan.steps];
    const [moving, other] = [steps[index], steps[target]];
    if (!moving || !other) return;
    if (delta === -1 && moving.dependsOn.includes(other.id)) { setMessage(`${moving.id} depends on ${other.id}, so it has to stay below it.`); return; }
    if (delta === 1 && other.dependsOn.includes(moving.id)) { setMessage(`${other.id} depends on ${moving.id}, so ${moving.id} has to stay above it.`); return; }
    steps[index] = other;
    steps[target] = moving;
    update({ steps });
  };
  const addStep = () => {
    const id = nextStepId(plan.steps);
    const last = plan.steps[plan.steps.length - 1];
    update({ steps: [...plan.steps, { id, title: '', kind: 'execute', instructions: '', dependsOn: last ? [last.id] : [], provider: providerIds[plan.steps.length % Math.max(1, providerIds.length)] ?? 'codex', model: null, effort: null, raw: false }] });
  };
  const duplicateStep = (source: PlanStep) => {
    const id = nextStepId(plan.steps);
    const index = plan.steps.findIndex((item) => item.id === source.id);
    const steps = [...plan.steps];
    steps.splice(index + 1, 0, { ...source, id, title: source.title ? `${source.title} (copy)` : '' });
    update({ steps });
  };
  const applyTemplate = (template: TemplateId) => {
    if (plan.steps.length && pendingTemplate !== template) { setPendingTemplate(template); return; }
    setPendingTemplate(null);
    update({ steps: planTemplate(template, providerIds) });
    setMessage(`${TEMPLATES.find((item) => item.id === template)?.label} loaded. Edit each step, then dispatch.`);
  };

  const problems = planProblems(plan);
  const used = [...new Set(plan.steps.map((item) => item.provider))];
  const unverified = used.filter((id) => byId.get(id)?.evidence.probe?.status !== 'verified');
  const effortConflicts = plan.steps.filter((item) => item.effort && choices.find((choice) => choice.id === item.provider)?.effortSupported === false);
  const emptyIntegrations = plan.steps.filter((item) => item.kind !== 'execute' && !item.dependsOn.length);
  const missing = used.filter((id) => !providerIds.includes(id));
  const layout = pipelineLayout(plan.steps);

  async function saveDraft(): Promise<string | null> {
    try {
      const saved = await client.saveDraft({ ...plan, title: plan.title.trim() || plan.brief.trim().split('\n')[0]?.slice(0, 80) || 'Untitled run' }, draftId);
      setDraftId(saved.id);
      return saved.id;
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'The draft could not be saved.');
      return null;
    }
  }

  async function dispatch() {
    setBusy('dispatch');
    setMessage('');
    try {
      const id = draftId ?? await saveDraft();
      if (!id) return;
      const run = await client.dispatch(id);
      setConfirming(false);
      setDraftId(null);
      setActiveRunId(run.id);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Dispatch failed.');
    } finally {
      setBusy(null);
    }
  }

  async function askPlanner() {
    if (!plan.brief.trim()) { setMessage('Describe the goal first, then ask an agent to break it down.'); return; }
    setBusy('planner');
    setMessage('');
    try {
      const choice = choices.find((item) => item.id === planner);
      const run = await client.draftPlan({ brief: plan.brief, workspace: plan.workspace, provider: planner, model: null, effort: null });
      setPlanRunId(run.id);
      setMessage(`${choice?.name ?? planner} is drafting the breakdown.`);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'The breakdown request failed.');
    } finally {
      setBusy(null);
    }
  }

  if (!snapshot) {
    return statusError ? <EmptyState title="Swarm control unavailable" body={statusError} /> : <p className="sc-muted" role="status">Reading AutoSwarm…</p>;
  }

  if (activeRunId) {
    return (
      <div className="sc">
        <div className="sc-row sc-row--between">
          <span className="sc-muted">Live run. It keeps going if you leave this page; Runs lists it.</span>
          <Button size="sm" onClick={() => setActiveRunId(null)}><Plus size={12} aria-hidden="true" />New plan</Button>
        </div>
        <RunMonitor runId={activeRunId} providers={choices} nameOf={nameOf} onDuplicate={(copy) => { setPlan(copy); setActiveRunId(null); setMessage('Copied into the editor as a new plan.'); }} />
      </div>
    );
  }

  return (
    <div className="sc">
      {!local && (
        <Notice action={<a className="mo-btn" href="http://127.0.0.1:4273/#/swarm/control">Open local dashboard</a>}>
          <strong>Preview</strong>. Plans dispatch from the local dashboard, where AutoSwarm and your harnesses run. This editor shows an example team.
        </Notice>
      )}
      {local && control && !control.dispatch && (
        <Notice command={AUTOSWARM_INSTALL_COMMAND}>{control.error ?? 'AutoSwarm is not installed where the helper can run it.'} You can still plan and save drafts.</Notice>
      )}
      {local && control?.enabled === false && <Notice>Dispatch is switched off on this machine (MEOW_SWARM_DISPATCH=0). Plans can be drafted, not run.</Notice>}
      {statusError && <Notice>{statusError}</Notice>}
      {message && <p className="sc-message" role="status">{message}</p>}

      <div className="sc-layout">
        <div className="sc-editor">
          <Card className="sc-brief">
            <label className="sc-field">
              <span className="mo-eyebrow">Goal</span>
              <textarea rows={3} value={plan.brief} placeholder="What should the team get done? e.g. Add rate limiting to the public API, with tests and a security review." onChange={(event) => update({ brief: event.target.value })} />
            </label>
            <div className="sc-grid3 sc-grid3--wide">
              <label className="sc-field">
                <span className="mo-eyebrow">Run name</span>
                <input value={plan.title} placeholder="Defaults to the first line of the goal" onChange={(event) => update({ title: event.target.value })} />
              </label>
              <label className="sc-field">
                <span className="mo-eyebrow">Workspace</span>
                <input className="sc-mono-input" value={plan.workspace} placeholder="~/Repos/project" list="sc-workspaces" onChange={(event) => update({ workspace: event.target.value })} />
                <datalist id="sc-workspaces">{[snapshot.workspace].filter(Boolean).map((value) => <option key={value} value={value as string} />)}</datalist>
              </label>
              <label className="sc-field">
                <span className="mo-eyebrow">At once</span>
                <select value={plan.maxParallel} onChange={(event) => update({ maxParallel: Number(event.target.value) })}>
                  {[1, 2, 3, 4, 5, 6, 8].map((value) => <option key={value} value={value}>{value} {value === 1 ? 'step' : 'steps'}</option>)}
                </select>
              </label>
            </div>
            <label className="sc-check"><input type="checkbox" checked={plan.peers} onChange={(event) => update({ peers: event.target.checked })} /> Let steps message the steps they depend on while running</label>
          </Card>

          <Card className="sc-breakdown">
            <span className="mo-eyebrow">Break it down</span>
            <div className="sc-templates">
              {TEMPLATES.map((template) => (
                <button key={template.id} type="button" className={`sc-template${pendingTemplate === template.id ? ' is-pending' : ''}`} onClick={() => applyTemplate(template.id)} title={template.hint}>
                  <strong>{pendingTemplate === template.id ? `Replace ${plan.steps.length} steps?` : template.label}</strong>
                  <span>{pendingTemplate === template.id ? 'Click again to confirm' : template.hint}</span>
                </button>
              ))}
            </div>
            <div className="sc-row sc-planner">
              <Sparkles size={14} aria-hidden="true" />
              <span>Or ask</span>
              <select aria-label="Agent to draft the breakdown" value={planner} onChange={(event) => setPlanner(event.target.value)}>
                {choices.map((choice) => <option key={choice.id} value={choice.id}>{choice.name}</option>)}
              </select>
              <Button size="sm" disabled={!canDispatch || busy !== null || !plan.workspace.trim()} onClick={() => { void askPlanner(); }}>{busy === 'planner' ? 'Asking…' : 'Draft the breakdown'}</Button>
              <span className="sc-muted">One model call. You edit what comes back.</span>
            </div>
          </Card>

          {planRunId && (
            <Card className="sc-planrun">
              <RunMonitor runId={planRunId} providers={choices} nameOf={nameOf} onClose={() => setPlanRunId(null)} onUsePlan={(proposal) => {
                update({ steps: proposal.steps, title: plan.title || proposal.title });
                setPlanRunId(null);
                setMessage(`Loaded ${proposal.steps.length} steps. Review the harness, model and instructions of each.`);
              }} />
            </Card>
          )}

          {plan.steps.length === 0 && (
            <EmptyState title="No steps yet" body="Pick a template, ask an agent for a breakdown, or add the first step yourself." action={<Button onClick={addStep}><Plus size={13} aria-hidden="true" />Add a step</Button>} />
          )}

          {plan.steps.map((item, index) => {
            const provider = byId.get(item.provider);
            const choice = choices.find((entry) => entry.id === item.provider);
            const earlier = plan.steps.slice(0, index);
            return (
              <Card key={item.id} className="sc-stepcard">
                <div className="sc-stepcard__head">
                  <span className="sc-chip">{item.id}</span>
                  <input className="sc-title-input" aria-label={`Title of ${item.id}`} value={item.title} placeholder="Step title" onChange={(event) => updateStep(item.id, { title: event.target.value })} />
                  <div className="sc-seg" role="radiogroup" aria-label={`Kind of ${item.id}`}>
                    {(['execute', 'review', 'integrate'] as StepKind[]).map((kind) => (
                      <button key={kind} type="button" role="radio" aria-checked={item.kind === kind} className={item.kind === kind ? 'is-on' : undefined} onClick={() => updateStep(item.id, { kind })}>{KIND_LABEL[kind]}</button>
                    ))}
                  </div>
                  <div className="sc-row sc-stepcard__tools">
                    <Button size="sm" variant="ghost" icon label={`Move ${item.id} up`} disabled={index === 0} onClick={() => moveStep(index, -1)}><ArrowUp size={13} aria-hidden="true" /></Button>
                    <Button size="sm" variant="ghost" icon label={`Move ${item.id} down`} disabled={index === plan.steps.length - 1} onClick={() => moveStep(index, 1)}><ArrowDown size={13} aria-hidden="true" /></Button>
                    <Button size="sm" variant="ghost" icon label={`Duplicate ${item.id}`} onClick={() => duplicateStep(item)}><CopyPlus size={13} aria-hidden="true" /></Button>
                    <Button size="sm" variant="ghost" icon label={`Remove ${item.id}`} onClick={() => removeStep(item.id)}><Trash2 size={13} aria-hidden="true" /></Button>
                  </div>
                </div>
                <div className="sc-grid3">
                  <label className="sc-field">
                    <span className="mo-eyebrow">Harness</span>
                    <select value={item.provider} onChange={(event) => updateStep(item.id, { provider: event.target.value, model: null, effort: null })}>
                      {!choice && <option value={item.provider}>{nameOf(item.provider)} (not found)</option>}
                      {choices.map((entry) => <option key={entry.id} value={entry.id}>{entry.name} · {STATE_META[byId.get(entry.id)?.state ?? 'found'].short}</option>)}
                    </select>
                  </label>
                  <label className="sc-field">
                    <span className="mo-eyebrow">Model</span>
                    <input list={`sc-models-${item.id}`} value={item.model ?? ''} placeholder="Native default" onChange={(event) => updateStep(item.id, { model: event.target.value.trim() || null })} />
                    <datalist id={`sc-models-${item.id}`}>{(choice?.models ?? []).map((model) => <option key={model} value={model} />)}</datalist>
                  </label>
                  <label className="sc-field">
                    <span className="mo-eyebrow">Effort</span>
                    <input list={`sc-efforts-${item.id}`} value={item.effort ?? ''} placeholder={choice?.effortSupported === false ? 'Not supported here' : 'Native default'} onChange={(event) => updateStep(item.id, { effort: event.target.value.trim() || null })} />
                    <datalist id={`sc-efforts-${item.id}`}>{(choice?.efforts ?? []).map((effort) => <option key={effort} value={effort} />)}</datalist>
                  </label>
                </div>
                <label className="sc-field">
                  <span className="mo-eyebrow">Instructions</span>
                  <textarea rows={3} value={item.instructions} placeholder={item.kind === 'review' ? 'What should the reviewer check? It reads the outputs of the steps it runs after.' : item.kind === 'integrate' ? 'How should the inputs be combined into one deliverable?' : 'What should this step produce?'} onChange={(event) => updateStep(item.id, { instructions: event.target.value })} />
                </label>
                {earlier.length > 0 && (
                  <div className="sc-deps">
                    <span className="mo-eyebrow">Runs after</span>
                    {earlier.map((dep) => {
                      const on = item.dependsOn.includes(dep.id);
                      return <button key={dep.id} type="button" aria-pressed={on} className={`sc-dep${on ? ' is-on' : ''}`} onClick={() => updateStep(item.id, { dependsOn: on ? item.dependsOn.filter((value) => value !== dep.id) : [...item.dependsOn, dep.id] })}>{dep.id}{dep.title ? ` · ${dep.title}` : ''}</button>;
                    })}
                    <span className="sc-muted">{item.dependsOn.length ? 'Their outputs are stitched into this step.' : 'Starts right away.'}</span>
                  </div>
                )}
                <div className="sc-hints">
                  {provider && provider.evidence.probe?.status !== 'verified' && <span>{provider.name} is found but not verified; its first call here doubles as the proof.</span>}
                  {item.effort && choice?.effortSupported === false && <span className="is-warn">{choice.name} rejected effort overrides before. Clear the effort or this step will fail.</span>}
                  {provider?.note && <span>{provider.note}</span>}
                </div>
                <details className="sc-advanced">
                  <summary>Advanced</summary>
                  <label className="sc-check"><input type="checkbox" checked={item.raw} onChange={(event) => updateStep(item.id, { raw: event.target.checked })} /> Send the instructions verbatim, without run context or upstream outputs</label>
                </details>
              </Card>
            );
          })}
          {plan.steps.length > 0 && <Button onClick={addStep}><Plus size={13} aria-hidden="true" />Add step</Button>}
        </div>

        <aside className="sc-aside">
          <Card pad={false} className="sc-preview">
            <div className="sc-preview__head"><span className="mo-eyebrow">Pipeline</span><span className="sc-muted">{layout.levels ? `${layout.levels} ${layout.levels === 1 ? 'stage' : 'stages'}, left to right` : 'Empty'}</span></div>
            <Pipeline steps={plan.steps} nameOf={nameOf} label="Plan pipeline" fit />
          </Card>
          <Card className="sc-dispatch">
            <span className="mo-eyebrow">Dispatch</span>
            <p className="sc-lead">
              {plan.steps.length} {plan.steps.length === 1 ? 'step' : 'steps'} · {used.length} {used.length === 1 ? 'harness' : 'harnesses'} · up to {plan.maxParallel} at once
            </p>
            {used.length > 0 && <div className="sc-row sc-wrap">{used.map((id) => <Badge key={id} tone={byId.get(id)?.evidence.probe?.status === 'verified' ? 'positive' : 'neutral'} dot>{nameOf(id)}</Badge>)}</div>}
            {problems.length > 0 && <ul className="sc-problems">{problems.slice(0, 6).map((problem) => <li key={problem}>{problem}</li>)}</ul>}
            {problems.length === 0 && (
              <ul className="sc-notes">
                {missing.length > 0 && <li className="is-warn">Not found on this machine: {missing.map(nameOf).join(', ')}.</li>}
                {effortConflicts.length > 0 && <li className="is-warn">Effort set where the harness rejected it before: {effortConflicts.map((item) => item.id).join(', ')}.</li>}
                {emptyIntegrations.length > 0 && <li className="is-warn">{emptyIntegrations.map((item) => item.id).join(', ')} {emptyIntegrations.length === 1 ? 'reviews or integrates' : 'review or integrate'} nothing yet. Pick what it runs after.</li>}
                {unverified.length > 0 && <li>Not yet verified: {unverified.map(nameOf).join(', ')}. Their first call here is the proof.</li>}
                <li>Spends model calls on every harness used. Approvals wait for you on the run page.</li>
              </ul>
            )}
            <details className="sc-commands">
              <summary>Exact AutoSwarm commands</summary>
              <pre>{plan.steps.map((item) => stepCommand(item, plan.workspace, plan.peers)).join('\n')}</pre>
            </details>
            <div className="sc-row">
              <Button disabled={!local || problems.length > 0 || busy !== null} onClick={() => { void saveDraft().then((id) => id && setMessage('Draft saved. It appears in Runs.')); }}>{draftId ? 'Saved' : 'Save draft'}</Button>
              <Button variant="primary" disabled={!canDispatch || problems.length > 0 || missing.length > 0 || busy !== null} onClick={() => setConfirming(true)}><Zap size={13} aria-hidden="true" />Dispatch</Button>
            </div>
            {!local && <p className="sc-muted">Dispatch runs in the local dashboard.</p>}
          </Card>
        </aside>
      </div>

      {confirming && (
        <div className="sc-modal" role="dialog" aria-modal="true" aria-label="Confirm dispatch">
          <Card className="sc-modal__card">
            <h3>Dispatch {plan.steps.length} {plan.steps.length === 1 ? 'step' : 'steps'}?</h3>
            <ul className="sc-notes">
              <li>{used.map(nameOf).join(', ')} will work in <span className="sc-mono">{plan.workspace}</span>.</li>
              <li>This spends model calls on each harness.</li>
              <li>Steps start as soon as their inputs are ready, up to {plan.maxParallel} at once.</li>
              <li>Native approvals pause their step until you decide on the run page.</li>
            </ul>
            <div className="sc-row">
              <Button onClick={() => setConfirming(false)} disabled={busy !== null}>Cancel</Button>
              <Button variant="primary" onClick={() => { void dispatch(); }} disabled={busy !== null}><Zap size={13} aria-hidden="true" />{busy === 'dispatch' ? 'Dispatching…' : 'Dispatch now'}</Button>
            </div>
          </Card>
        </div>
      )}

      <p className="sc-foot">
        Control talks to AutoSwarm through the local helper. Your plan stays in this browser until you save or dispatch it. <button type="button" className="sc-link" onClick={() => { void navigator.clipboard?.writeText(plan.steps.map((item) => stepCommand(item, plan.workspace, plan.peers)).join('\n')).then(() => setMessage('Copied the commands.')).catch(() => setMessage('Clipboard unavailable.')); }}><Copy size={11} aria-hidden="true" /> Copy commands</button>
      </p>
    </div>
  );
}

