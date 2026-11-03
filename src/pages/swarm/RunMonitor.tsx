import { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, Square, RotateCcw, Send, Check, X as Deny, CopyPlus } from 'lucide-react';

import { Badge, Button, Card, Notice } from '../../components/ui';
import {
  GUIDED_FORMATS, KIND_LABEL, RUN_STATUS_META, STEP_STATUS_META, allowsText, answerPayload, declinePayload, elapsed, emptyAnswer, errorHint, finalStep, swarmControl, togglePick,
} from '../../lib/swarm-control';
import type { AnswerDraft, PendingDecision, PlanDraft, RunStep, SwarmRun } from '../../lib/swarm-control';
import { Pipeline } from './Pipeline';

export interface ProviderChoice { id: string; name: string; models: string[]; efforts: string[]; effortSupported: boolean | 'unknown' }

interface RunMonitorProps {
  runId: string;
  providers: readonly ProviderChoice[];
  nameOf: (provider: string) => string;
  onDuplicate?: (plan: PlanDraft) => void;
  onUsePlan?: (plan: PlanDraft) => void;
  onClose?: () => void;
}

const POLL_MS = 2000;
const ACTIVE = new Set(['queued', 'starting', 'running', 'waiting']);

function toPlan(run: SwarmRun): PlanDraft {
  return {
    title: `${run.title} (copy)`, brief: run.brief, workspace: run.workspace, maxParallel: run.maxParallel, peers: run.peers, tags: run.tags.filter((tag) => tag !== 'qa'),
    steps: run.steps.map(({ id, title, kind, instructions, dependsOn, provider, model, effort, raw }) => ({ id, title, kind, instructions, dependsOn, provider, model, effort, raw })),
  };
}

export function RunMonitor({ runId, providers, nameOf, onDuplicate, onUsePlan, onClose }: RunMonitorProps) {
  const client = useMemo(() => swarmControl(), []);
  const [run, setRun] = useState<SwarmRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [now, setNow] = useState(Date.now);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const next = await client.getRun(runId, signal);
      if (signal?.aborted) return;
      setRun(next);
      setNow(Date.now());
      setError(null);
    } catch (reason) {
      if (!signal?.aborted) setError(reason instanceof Error ? reason.message : 'The run could not be read.');
    }
  }, [client, runId]);

  const live = Boolean(run && (run.status === 'running' || run.steps.some((step) => ACTIVE.has(step.status))));
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);
  useEffect(() => {
    if (!live) return undefined;
    const controller = new AbortController();
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(controller.signal); }, POLL_MS);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [live, refresh]);
  useEffect(() => {
    if (!run || selected) return;
    const attention = run.steps.find((step) => step.status === 'waiting') ?? run.steps.find((step) => ['failed', 'interrupted'].includes(step.status));
    if (attention) setSelected(attention.id);
  }, [run, selected]);

  const act = useCallback(async (key: string, action: () => Promise<SwarmRun>, done: string) => {
    setBusy(key);
    setMessage('');
    try { setRun(await action()); setMessage(done); setNow(Date.now()); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : 'That did not go through.'); }
    finally { setBusy(null); }
  }, []);

  const copy = useCallback(async (value: string, what: string) => {
    try { await navigator.clipboard.writeText(value); setMessage(`Copied ${what}.`); }
    catch { setMessage('Clipboard unavailable. Select the text to copy it.'); }
  }, []);

  if (!run) {
    return error ? <Notice>{error}</Notice> : <p className="sc-muted" role="status">Loading run…</p>;
  }

  const meta = RUN_STATUS_META[run.status];
  const step = run.steps.find((item) => item.id === selected) ?? null;
  const last = finalStep(run.steps);
  const done = run.steps.filter((item) => item.status === 'completed').length;
  const waiting = run.steps.reduce((total, item) => total + item.pending.length, 0);

  return (
    <div className="sc-monitor">
      <div className="sc-monitor__head">
        <div className="sc-monitor__title">
          <div className="sc-row">
            <h3>{run.title}</h3>
            <Badge tone={meta.tone} dot>{meta.label}</Badge>
            {run.tags.includes('qa') && <Badge tone="info">QA</Badge>}
            {run.purpose === 'plan' && <Badge tone="info">Breakdown</Badge>}
          </div>
          <p className="sc-muted">
            <span className="sc-mono">{run.workspace}</span> · {done} of {run.steps.length} done{waiting ? ` · ${waiting} waiting on you` : ''} · {run.dispatchedAt ? `ran ${elapsed(run.dispatchedAt, run.finishedAt ?? (live ? null : run.updatedAt), now)}` : 'not dispatched'}
          </p>
        </div>
        <div className="sc-row">
          {live && <Button size="sm" variant="danger" disabled={busy !== null} onClick={() => { void act('cancel-run', () => client.cancelRun(run.id), 'Cancel sent to every running step.'); }}><Square size={12} aria-hidden="true" />Cancel run</Button>}
          {onDuplicate && run.purpose === 'work' && <Button size="sm" onClick={() => onDuplicate(toPlan(run))}><CopyPlus size={12} aria-hidden="true" />Duplicate as plan</Button>}
          {onClose && <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>}
        </div>
      </div>

      {error && <Notice>{error} The last good read stays below.</Notice>}
      {message && <p className="sc-message" role="status">{message}</p>}

      {run.purpose === 'plan' && run.status === 'completed' && (
        run.proposal ? (
          <Card className="sc-proposal">
            <span className="mo-eyebrow">Proposed breakdown</span>
            <p className="sc-lead">{run.proposal.title}: {run.proposal.steps.length} steps across {[...new Set(run.proposal.steps.map((item) => nameOf(item.provider)))].join(', ')}.</p>
            <Pipeline steps={run.proposal.steps} nameOf={nameOf} label="Proposed breakdown" />
            {onUsePlan && <Button variant="primary" onClick={() => onUsePlan(run.proposal as PlanDraft)}>Load into the plan editor</Button>}
          </Card>
        ) : <Notice>The agent replied, but no valid plan could be read from its answer. Its reply is in the step below.</Notice>
      )}

      <div className="sc-monitor__grid">
        <Card pad={false} className="sc-monitor__pipeline">
          <Pipeline steps={run.steps} nameOf={nameOf} selected={selected} onSelect={(id) => setSelected((current) => (current === id ? null : id))} label={`Pipeline for ${run.title}`} />
        </Card>
        {step ? (
          <StepPanel
            key={step.id}
            run={run}
            step={step}
            providers={providers}
            nameOf={nameOf}
            busy={busy}
            now={now}
            onCopy={copy}
            onClose={() => setSelected(null)}
            onAct={act}
            client={client}
          />
        ) : (
          <Card className="sc-hint">
            <span className="mo-eyebrow">Steps</span>
            <ul className="sc-steplist">
              {run.steps.map((item) => (
                <li key={item.id}>
                  <button type="button" className="sc-link" onClick={() => setSelected(item.id)}>{item.id} · {item.title}</button>
                  <Badge tone={STEP_STATUS_META[item.status].tone} dot>{STEP_STATUS_META[item.status].label}</Badge>
                </li>
              ))}
            </ul>
            <p className="sc-muted">Select a step for its output, approvals, retry and follow-up.</p>
          </Card>
        )}
      </div>

      {run.purpose === 'work' && last && last.status === 'completed' && last.output && (
        <Card className="sc-final">
          <div className="sc-row sc-row--between">
            <span className="mo-eyebrow">Result · {last.id} · {nameOf(last.provider)}</span>
            <Button size="sm" onClick={() => { void copy(last.output ?? '', 'the result'); }}><Copy size={12} aria-hidden="true" />Copy</Button>
          </div>
          <pre className="sc-output">{last.output}</pre>
        </Card>
      )}

      <details className="sc-events">
        <summary>Event log ({run.events.length})</summary>
        <ol>
          {[...run.events].reverse().slice(0, 120).map((item, index) => (
            <li key={`${item.at}-${index}`}><span className="sc-mono">{new Date(item.at).toLocaleTimeString()}</span> {item.type.replaceAll('-', ' ')}{item.stepId ? ` · ${item.stepId}` : ''}{item.errorCode ? ` · ${item.errorCode}` : ''}</li>
          ))}
        </ol>
      </details>
    </div>
  );
}

interface QuestionFormProps {
  run: SwarmRun;
  step: RunStep;
  item: PendingDecision;
  busy: string | null;
  onAct: StepPanelProps['onAct'];
  onCopy: StepPanelProps['onCopy'];
  client: ReturnType<typeof swarmControl>;
}

// A native question (AskUserQuestion and friends): pick options or type, then
// send. Formats the panel cannot guide take a JSON reply AutoSwarm validates.
function QuestionForm({ run, step, item, busy, onAct, onCopy, client }: QuestionFormProps) {
  const detail = item.question ?? null;
  const [draft, setDraft] = useState<AnswerDraft>(emptyAnswer);
  const [raw, setRaw] = useState('');
  const guided = Boolean(detail && GUIDED_FORMATS.includes(detail.format) && detail.questions.length > 0);
  const payload = detail && guided ? answerPayload(detail, draft) : null;
  const decline = detail ? declinePayload(detail) : null;
  let rawValue: Record<string, unknown> | null = null;
  let rawError: string | null = null;
  if (!guided && raw.trim()) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) rawValue = parsed as Record<string, unknown>;
      else rawError = 'An answer is a JSON object.';
    } catch { rawError = 'Not valid JSON yet.'; }
  }
  const response = payload ?? rawValue;
  const send = (body: Record<string, unknown>, done: string) => onAct(`answer-${item.requestId}`, () => client.answer(run.id, step.id, item.requestId, body), done);
  const command = `autoswarm answer ${step.callId ?? '<call>'} ${item.requestId} --input answer.json --by user`;
  return (
    <div className="sc-question">
      {detail && guided ? detail.questions.map((question) => (
        <fieldset key={question.key} className="sc-question__item">
          <legend>{question.text ?? 'Question'}{question.multi ? <span className="sc-muted"> · pick any</span> : null}</legend>
          {question.options.length > 0 && (
            <div className="sc-deps" role="group" aria-label={question.text ?? 'Options'}>
              {question.options.map((option) => {
                const on = (draft.picks[question.key] ?? []).includes(option.id);
                return <button key={option.id} type="button" aria-pressed={on} title={option.description} className={`sc-dep${on ? ' is-on' : ''}`} onClick={() => setDraft((current) => togglePick(current, question, option.id))}>{option.label}</button>;
              })}
            </div>
          )}
          {allowsText(detail.format, question) && (
            <input aria-label={`Your answer to: ${question.text ?? 'the question'}`} value={draft.text[question.key] ?? ''} placeholder={question.options.length ? 'Or type your own answer' : 'Type your answer'}
              onChange={(event) => { const value = event.target.value; setDraft((current) => ({ ...current, text: { ...current.text, [question.key]: value } })); }} />
          )}
        </fieldset>
      )) : (
        <label className="sc-question__raw">
          <span>Reply as JSON{detail?.help ? `. Expected: ${detail.help}` : ''}</span>
          <textarea rows={3} className="sc-mono-input" value={raw} placeholder='{"action":"cancel"}' onChange={(event) => setRaw(event.target.value)} />
          {rawError && <span className="sc-muted">{rawError}</span>}
        </label>
      )}
      <div className="sc-row">
        <Button size="sm" variant="primary" disabled={busy !== null || !response} onClick={() => { if (response) void send(response, 'Answered. The agent continues.'); }}><Send size={12} aria-hidden="true" />Send answer</Button>
        {decline && <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => { void send(decline, 'Declined. The agent was told you skipped it.'); }}>Decline</Button>}
        <Button size="sm" variant="ghost" onClick={() => { void onCopy(command, 'the answer command'); }}><Copy size={12} aria-hidden="true" />CLI</Button>
      </div>
      {detail?.userRequired && <p className="sc-muted">This form needs your own answer. AutoSwarm will not let an agent fill it in.</p>}
    </div>
  );
}

interface StepPanelProps {
  run: SwarmRun;
  step: RunStep;
  providers: readonly ProviderChoice[];
  nameOf: (provider: string) => string;
  busy: string | null;
  now: number;
  onCopy: (value: string, what: string) => Promise<void>;
  onClose: () => void;
  onAct: (key: string, action: () => Promise<SwarmRun>, done: string) => Promise<void>;
  client: ReturnType<typeof swarmControl>;
}

function StepPanel({ run, step, providers, nameOf, busy, now, onCopy, onClose, onAct, client }: StepPanelProps) {
  const meta = STEP_STATUS_META[step.status];
  const [retryProvider, setRetryProvider] = useState(step.provider);
  const [retryModel, setRetryModel] = useState(step.model ?? '');
  const [retryEffort, setRetryEffort] = useState(step.effort ?? '');
  const [followUp, setFollowUp] = useState('');
  const choice = providers.find((item) => item.id === retryProvider);
  const canRetry = ['failed', 'cancelled', 'interrupted'].includes(step.status);
  const canFollowUp = ['completed', 'failed', 'interrupted'].includes(step.status) && Boolean(step.nativeSessionId && step.callId);
  const canCancel = ['queued', 'starting', 'running', 'waiting'].includes(step.status);

  return (
    <Card className="sc-step" accent={`var(--${meta.tone === 'positive' ? 'green' : meta.tone === 'danger' ? 'red' : meta.tone === 'warning' ? 'amber' : meta.tone === 'accent' ? 'accent' : 'border-hover'})`}>
      <div className="sc-row sc-row--between">
        <div>
          <h4>{step.id} · {step.title}</h4>
          <p className="sc-muted">{KIND_LABEL[step.kind]} · {nameOf(step.provider)}{step.model ? ` · ${step.model}` : ' · native model'}{step.effort ? ` · ${step.effort}` : ''}</p>
        </div>
        <Button variant="ghost" size="sm" icon label="Close step" onClick={onClose}><Deny size={14} aria-hidden="true" /></Button>
      </div>
      <div className="sc-row">
        <Badge tone={meta.tone} dot>{meta.label}</Badge>
        <span className="sc-muted">{step.startedAt ? elapsed(step.startedAt, step.finishedAt, now) : 'Not started'}{step.dependsOn.length ? ` · after ${step.dependsOn.join(', ')}` : ''}</span>
      </div>

      {step.pending.length > 0 && (
        <div className="sc-decisions">
          {step.pending.map((item) => (
            <div key={item.requestId} className="sc-decision">
              <div><strong>{item.kind === 'question' ? 'Question' : 'Permission'}</strong> <span className="sc-muted">{nameOf(step.provider)} asks</span></div>
              {(item.kind === 'permission' || !item.question?.questions.length) && <p>{item.title}</p>}
              {item.kind === 'permission' ? (
                <div className="sc-row">
                  <Button size="sm" variant="primary" disabled={busy !== null} onClick={() => { void onAct(`allow-${item.requestId}`, () => client.decide(run.id, step.id, item.requestId, 'allow'), 'Approved. The agent continues.'); }}><Check size={12} aria-hidden="true" />Approve</Button>
                  <Button size="sm" variant="danger" disabled={busy !== null} onClick={() => { void onAct(`deny-${item.requestId}`, () => client.decide(run.id, step.id, item.requestId, 'deny'), 'Denied. The agent was told no.'); }}><Deny size={12} aria-hidden="true" />Deny</Button>
                </div>
              ) : (
                <QuestionForm run={run} step={step} item={item} busy={busy} onAct={onAct} onCopy={onCopy} client={client} />
              )}
            </div>
          ))}
        </div>
      )}

      {(step.errorCode || step.error) && step.status !== 'completed' && (
        <div className="sc-error">
          <strong>{step.errorCode ?? 'error'}</strong>{step.error ? `: ${step.error}` : ''}
          {errorHint(step.errorCode, nameOf(step.provider)) && <p className="sc-error__hint">{errorHint(step.errorCode, nameOf(step.provider))}</p>}
        </div>
      )}
      {step.status === 'blocked' && <p className="sc-muted">Waiting on a step that failed or was cancelled. Retry that step to unblock this one.</p>}

      {step.output && (
        <div className="sc-stack">
          <div className="sc-row sc-row--between">
            <span className="mo-eyebrow">Output{step.outputChars > (step.output?.length ?? 0) ? ' (trimmed)' : ''}</span>
            <Button size="sm" onClick={() => { void onCopy(step.output ?? '', 'the output'); }}><Copy size={12} aria-hidden="true" />Copy</Button>
          </div>
          <pre className="sc-output">{step.output}</pre>
        </div>
      )}

      {canCancel && (
        <Button size="sm" variant="danger" disabled={busy !== null} onClick={() => { void onAct(`cancel-${step.id}`, () => client.cancelStep(run.id, step.id), 'Cancel sent.'); }}><Square size={12} aria-hidden="true" />Cancel step</Button>
      )}

      {canRetry && (
        <div className="sc-stack sc-form">
          <span className="mo-eyebrow">Retry or reassign</span>
          <div className="sc-grid3">
            <label>Harness<select value={retryProvider} onChange={(event) => { setRetryProvider(event.target.value); setRetryModel(''); setRetryEffort(''); }}>{providers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label>Model<input list={`sc-retry-models-${step.id}`} value={retryModel} placeholder="Native default" onChange={(event) => setRetryModel(event.target.value.trim())} /><datalist id={`sc-retry-models-${step.id}`}>{(choice?.models ?? []).map((model) => <option key={model} value={model} />)}</datalist></label>
            <label>Effort<input list={`sc-retry-efforts-${step.id}`} value={retryEffort} placeholder={choice?.effortSupported === false ? 'Not supported' : 'Native default'} disabled={choice?.effortSupported === false} onChange={(event) => setRetryEffort(event.target.value.trim())} /><datalist id={`sc-retry-efforts-${step.id}`}>{(choice?.efforts ?? []).map((effort) => <option key={effort} value={effort} />)}</datalist></label>
          </div>
          <Button size="sm" variant="primary" disabled={busy !== null} onClick={() => { void onAct(`retry-${step.id}`, () => client.retryStep(run.id, step.id, { provider: retryProvider, model: retryModel || null, effort: retryEffort || null }), `Retry dispatched to ${nameOf(retryProvider)}.`); }}><RotateCcw size={12} aria-hidden="true" />Retry on {nameOf(retryProvider)}</Button>
          <p className="sc-muted">A new call. The failed one is kept in the history; nothing is re-run blindly.</p>
        </div>
      )}

      {canFollowUp && (
        <div className="sc-stack sc-form">
          <span className="mo-eyebrow">Follow up in the same session</span>
          <textarea rows={3} value={followUp} placeholder="e.g. Tighten the error handling and add a test for the empty case." onChange={(event) => setFollowUp(event.target.value)} />
          <Button size="sm" disabled={busy !== null || !followUp.trim()} onClick={() => { void onAct(`follow-${step.id}`, () => client.followUp(run.id, step.id, followUp), 'Follow-up sent. The step resumes its native session.').then(() => setFollowUp('')); }}><Send size={12} aria-hidden="true" />Send follow-up</Button>
        </div>
      )}

      {step.callId && (
        <div className="sc-command"><code>{`autoswarm inspect ${step.callId}`}</code><Button size="sm" onClick={() => { void onCopy(`autoswarm inspect ${step.callId}`, 'the inspect command'); }}><Copy size={12} aria-hidden="true" /></Button></div>
      )}

      {step.attempts.length > 1 && (
        <details className="sc-attempts">
          <summary>Attempts ({step.attempts.length})</summary>
          <ol>{step.attempts.map((attempt) => <li key={`${attempt.attempt}-${attempt.callId}`}>{attempt.kind === 'follow-up' ? 'Follow-up' : 'Run'} on {nameOf(attempt.provider)}{attempt.model ? ` · ${attempt.model}` : ''}: {attempt.status}{attempt.errorCode ? ` (${attempt.errorCode})` : ''}</li>)}</ol>
        </details>
      )}
    </Card>
  );
}
