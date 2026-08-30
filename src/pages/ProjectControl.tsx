import { useEffect, useMemo, useState } from 'react';
import {
  BookOpen, CheckCircle2, ChevronRight, Eye, FileSearch, Plus, RefreshCw, ShieldCheck,
  TriangleAlert,
} from 'lucide-react';

import {
  applyProjectContextAdapters,
  decideProjectLearning,
  fetchProjectControlPortfolio,
  fetchProjectEvidence,
  fetchProjectLearningState,
  previewProjectContextAdapters,
  registerProjectControlProject,
  rollbackProjectContextAdapters,
  type ProjectAdapterPreview,
  type ProjectControlSnapshot,
  type ProjectEvidenceResponse,
  type ProjectLearningStateResponse,
} from '../lib/loop-api';
import './ProjectControl.css';

type ViewMode = 'summary' | 'detail';

const FIELD_LABELS: Record<string, string> = {
  mission: 'Mission',
  vision: 'Vision',
  current_phase: 'Current phase',
  outcome: 'Outcome',
  constraint: 'Constraint',
  non_goal: 'Non-goal',
  priority: 'Priority',
};

function display(value: unknown, fallback = 'Unavailable') {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function evidenceTitle(row: Record<string, unknown>) {
  return display(row.content || row.session_title || row.first_user_message || row.session_id, 'Untitled session');
}

function ProjectRegistrationForm({
  onRegistered,
  onCancel,
}: {
  onRegistered: (projectId: string) => Promise<void>;
  onCancel?: () => void;
}) {
  const [name, setName] = useState('');
  const [root, setRoot] = useState('');
  const [aliases, setAliases] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  return (
    <form
      className="project-registration"
      onSubmit={async (event) => {
        event.preventDefault();
        setMessage('');
        if (!name.trim() || !root.trim()) {
          setMessage('Project name and local folder are required.');
          return;
        }
        setSubmitting(true);
        const result = await registerProjectControlProject({
          name: name.trim(),
          root: root.trim(),
          aliases: aliases.split(',').map((alias) => alias.trim()).filter(Boolean),
        });
        if (result?.ok && result.project) {
          setMessage(`Registered ${result.project.name}.`);
          await onRegistered(result.project.project_id);
        } else {
          setMessage(result?.error || 'Registration failed. Make sure the local helper is running and the folder exists.');
        }
        setSubmitting(false);
      }}
    >
      <div className="project-registration-heading">
        <div>
          <h2>Register a local project</h2>
          <p>The folder path is sent only to the helper running on this machine.</p>
        </div>
        {onCancel && <button type="button" onClick={onCancel}>Cancel</button>}
      </div>
      <label>
        Project name
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Meow Ops" maxLength={120} />
      </label>
      <label>
        Local project folder
        <input value={root} onChange={(event) => setRoot(event.target.value)} placeholder="/Users/you/projects/meow-ops" />
      </label>
      <label>
        Aliases <span>(optional, comma-separated)</span>
        <input value={aliases} onChange={(event) => setAliases(event.target.value)} placeholder="meow-ops, meow operations" />
      </label>
      <button className="project-control-action" type="submit" disabled={submitting}>
        <Plus size={15} /> {submitting ? 'Registering...' : 'Register project'}
      </button>
      {message && <p className={message.startsWith('Registered') ? 'project-control-success' : 'project-control-error'}>{message}</p>}
    </form>
  );
}

export default function ProjectControl() {
  const [projects, setProjects] = useState<ProjectControlSnapshot[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [mode, setMode] = useState<ViewMode>('summary');
  const [learningState, setLearningState] = useState<ProjectLearningStateResponse | null>(null);
  const [evidence, setEvidence] = useState<ProjectEvidenceResponse | null>(null);
  const [adapterPreview, setAdapterPreview] = useState<ProjectAdapterPreview | null>(null);
  const [adapterSyncId, setAdapterSyncId] = useState('');
  const [adapterMessage, setAdapterMessage] = useState('');
  const [showRegistration, setShowRegistration] = useState(false);
  const [decisionReasons, setDecisionReasons] = useState<Record<string, string>>({});
  const [decisionMessage, setDecisionMessage] = useState('');
  const [decidingLearningId, setDecidingLearningId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const selected = useMemo(
    () => projects.find((project) => project.project.project_id === selectedId) || projects[0] || null,
    [projects, selectedId],
  );

  async function loadPortfolio(preferredId = '') {
    setLoading(true);
    setError('');
    const result = await fetchProjectControlPortfolio();
    if (!result.ok) setError('The local Meow Ops helper is not available.');
    setProjects(result.projects || []);
    if (preferredId) setSelectedId(preferredId);
    else if (!selectedId && result.projects?.[0]) setSelectedId(result.projects[0].project.project_id);
    setLoading(false);
  }

  async function handleLearningDecision(
    learningId: string,
    decision: 'approved' | 'deferred' | 'rejected',
    retryPublication = false,
  ) {
    if (!selected) return;
    const reason = retryPublication
      ? 'Retry previously owner-approved publication.'
      : (decisionReasons[learningId] || '').trim();
    if (!retryPublication && !reason) {
      setDecisionMessage('A reason is required before approving, deferring, or rejecting project learning.');
      return;
    }
    setDecidingLearningId(learningId);
    setDecisionMessage('');
    const result = await decideProjectLearning(selected.project.project_id, learningId, decision, reason);
    if (result?.ok && result.learning) {
      const shownDecision = result.learning.status === 'published' ? 'approved and published' : result.learning.status;
      setDecisionMessage(`Learning ${shownDecision}. The project snapshot has been refreshed.`);
      setDecisionReasons((previous) => ({ ...previous, [learningId]: '' }));
      await loadPortfolio(selected.project.project_id);
      setLearningState(await fetchProjectLearningState(selected.project.project_id));
    } else {
      setDecisionMessage(result?.error || 'The learning decision could not be saved.');
    }
    setDecidingLearningId('');
  }

  useEffect(() => { void loadPortfolio(); }, []);

  useEffect(() => {
    if (!selected) return;
    setLearningState(null);
    setEvidence(null);
    setAdapterPreview(null);
    setAdapterSyncId('');
    setAdapterMessage('');
    setDecisionReasons({});
    setDecisionMessage('');
    void fetchProjectLearningState(selected.project.project_id).then(setLearningState);
  }, [selected?.project.project_id]);

  useEffect(() => {
    if (mode !== 'detail' || !selected || evidence) return;
    void fetchProjectEvidence(selected.project.project_id, { limit: 100 }).then(setEvidence);
  }, [mode, selected?.project.project_id, evidence]);

  if (loading) {
    return <div className="project-control-state">Reading local project evidence...</div>;
  }

  if (!selected) {
    return (
      <div className="project-control-empty">
        <BookOpen size={28} />
        <h1>No governed projects yet</h1>
        <p>Register a project to connect its constitution, learning state, evidence, and native-agent context.</p>
        <ProjectRegistrationForm
          onRegistered={async (projectId) => {
            await loadPortfolio(projectId);
          }}
        />
        {error && <p className="project-control-error">{error}</p>}
      </div>
    );
  }

  const coverage = Math.round(selected.constitution.coverage.ratio * 100);
  const proposed = selected.learning.counts.proposed || 0;

  return (
    <div className="project-control-page">
      <header className="project-control-header">
        <div>
          <p className="project-control-kicker">Project learning control plane</p>
          <h1>{selected.project.name}</h1>
          <p>See what the project knows, what the evidence proves, and what still needs your decision.</p>
        </div>
        <div className="project-control-header-actions">
          <button className="project-control-refresh" type="button" onClick={() => setShowRegistration((value) => !value)}>
            <Plus size={15} /> Add project
          </button>
          <button className="project-control-refresh" type="button" onClick={() => void loadPortfolio()}>
            <RefreshCw size={15} /> Refresh evidence
          </button>
        </div>
      </header>

      {showRegistration && (
        <ProjectRegistrationForm
          onCancel={() => setShowRegistration(false)}
          onRegistered={async (projectId) => {
            await loadPortfolio(projectId);
            setShowRegistration(false);
          }}
        />
      )}

      <div className="project-control-toolbar">
        <label>
          Project
          <select value={selected.project.project_id} onChange={(event) => setSelectedId(event.target.value)}>
            {projects.map((project) => (
              <option key={project.project.project_id} value={project.project.project_id}>
                {project.project.name}
              </option>
            ))}
          </select>
        </label>
        <div className="project-control-tabs" aria-label="Project control view">
          <button type="button" className={mode === 'summary' ? 'active' : ''} onClick={() => setMode('summary')}>
            <Eye size={15} /> Summary
          </button>
          <button type="button" className={mode === 'detail' ? 'active' : ''} onClick={() => setMode('detail')}>
            <FileSearch size={15} /> Detail
          </button>
        </div>
      </div>

      {mode === 'summary' ? (
        <>
          <section className="project-control-metrics" aria-label="Project learning health">
            <article>
              <span>Constitution coverage</span>
              <strong>{coverage}%</strong>
              <small>{selected.constitution.coverage.confirmed} of {selected.constitution.coverage.total} intentions confirmed</small>
            </article>
            <article>
              <span>Observed agents</span>
              <strong>{selected.agents.observed.length}/5</strong>
              <small>{selected.agents.observed.join(', ') || 'No matching sessions yet'}</small>
            </article>
            <article>
              <span>Pending learning</span>
              <strong>{proposed}</strong>
              <small>Owner review required before publication</small>
            </article>
          </section>

          <div className="project-control-columns">
            <section className="project-control-panel">
              <div className="project-control-panel-title">
                <ShieldCheck size={18} />
                <div><h2>Owner-approved constitution</h2><p>The intention native agents must serve.</p></div>
              </div>
              <div className="constitution-list">
                {Object.entries(FIELD_LABELS).map(([field, label]) => {
                  const claim = selected.constitution.fields[field];
                  return (
                    <div key={field} className={claim ? 'confirmed' : 'missing'}>
                      <span>{label}</span>
                      <p>{claim?.value || 'Needs owner teaching'}</p>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="project-control-panel">
              <div className="project-control-panel-title">
                <TriangleAlert size={18} />
                <div><h2>Coverage and blind spots</h2><p>Evidence availability, not guessed capability.</p></div>
              </div>
              <h3>Observed</h3>
              <div className="agent-chip-row">
                {selected.agents.observed.map((agent) => <span className="agent-chip observed" key={agent}>{agent}</span>)}
                {selected.agents.observed.length === 0 && <span className="empty-copy">No matching evidence</span>}
              </div>
              <h3>Blind spots</h3>
              <div className="agent-chip-row">
                {selected.agents.blind_spots.map((agent) => <span className="agent-chip blind" key={agent}>{agent}</span>)}
              </div>
              <button
                className="project-control-action"
                type="button"
                onClick={async () => setAdapterPreview(await previewProjectContextAdapters(selected.project.project_id))}
              >
                Preview agent context adapters <ChevronRight size={15} />
              </button>
              {adapterPreview && (
                <div className="adapter-preview">
                  {adapterPreview.preview.targets.map((target) => (
                    <div key={target.agent}>
                      <span>{target.agent}</span>
                      <small>{target.changed ? 'Change proposed' : 'Already aligned'}</small>
                    </div>
                  ))}
                  <p>Preview only. No native-agent file was changed.</p>
                  {adapterPreview.preview.targets.some((target) => target.changed) && !adapterSyncId && (
                    <button
                      className="project-control-action adapter-apply"
                      type="button"
                      onClick={async () => {
                        if (!window.confirm('Apply these owner-approved project-context changes to all five native-agent adapters?')) return;
                        const result = await applyProjectContextAdapters(
                          selected.project.project_id,
                          adapterPreview.preview,
                        );
                        if (result?.ok && result.result?.sync_id) {
                          setAdapterSyncId(result.result.sync_id);
                          setAdapterMessage('Native-agent context synchronized and backed up.');
                        } else {
                          setAdapterMessage(result?.error || 'Context synchronization failed. Refresh the preview and try again.');
                        }
                      }}
                    >
                      Apply approved context <ShieldCheck size={15} />
                    </button>
                  )}
                  {adapterMessage && <p className="adapter-message">{adapterMessage}</p>}
                  {adapterSyncId && (
                    <button
                      className="project-control-action adapter-rollback"
                      type="button"
                      onClick={async () => {
                        if (!window.confirm('Roll back this native-agent context synchronization?')) return;
                        const result = await rollbackProjectContextAdapters(selected.project.project_id, adapterSyncId);
                        setAdapterMessage(result?.ok ? 'Native-agent context rollback completed.' : result?.error || 'Rollback failed.');
                        if (result?.ok) setAdapterSyncId('');
                      }}
                    >
                      Roll back context sync
                    </button>
                  )}
                </div>
              )}
            </section>
          </div>

          <section className="project-control-panel learning-panel">
            <div className="project-control-panel-title">
              <CheckCircle2 size={18} />
              <div><h2>Learning review queue</h2><p>Patterns become project knowledge only after evidence and owner approval.</p></div>
            </div>
            {selected.learning.candidates.length === 0 ? (
              <p className="empty-copy">No learning proposals for this project.</p>
            ) : selected.learning.candidates.map((learning) => (
              <article className="learning-row" key={learning.learning_id}>
                <div className="learning-summary">
                  <span>{learning.kind} · {learning.impact} impact</span>
                  <h3>{learning.title}</h3>
                  <p>{learning.rationale}</p>
                  {['proposed', 'deferred'].includes(learning.status) && (
                    <div className="learning-decision">
                      <label>
                        Owner reason
                        <textarea
                          aria-label={`Reason for ${learning.title}`}
                          value={decisionReasons[learning.learning_id] || ''}
                          onChange={(event) => setDecisionReasons((previous) => ({
                            ...previous,
                            [learning.learning_id]: event.target.value,
                          }))}
                          placeholder="Why is this the right decision for the project?"
                          maxLength={2_000}
                        />
                      </label>
                      <div>
                        {([
                          ['approved', 'Approve'],
                          ['deferred', 'Defer'],
                          ['rejected', 'Reject'],
                        ] as const).map(([decision, label]) => (
                          <button
                            key={decision}
                            type="button"
                            disabled={decidingLearningId === learning.learning_id}
                            onClick={() => void handleLearningDecision(learning.learning_id, decision)}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {learning.status === 'approved' && (
                    <div className="learning-decision">
                      <p>Owner approval is saved, but publication did not finish.</p>
                      <button
                        type="button"
                        disabled={decidingLearningId === learning.learning_id}
                        onClick={() => void handleLearningDecision(learning.learning_id, 'approved', true)}
                      >
                        Retry publication
                      </button>
                    </div>
                  )}
                </div>
                <strong className={`learning-status ${learning.status}`}>{learning.status}</strong>
              </article>
            ))}
            {decisionMessage && <p className="learning-decision-result" role="status">{decisionMessage}</p>}
          </section>
        </>
      ) : (
        <div className="project-control-columns detail-columns">
          <section className="project-control-panel">
            <div className="project-control-panel-title">
              <FileSearch size={18} />
              <div><h2>Local evidence</h2><p>Latest matching sessions from the complete archive.</p></div>
            </div>
            {!evidence ? <p className="empty-copy">Loading evidence...</p> : evidence.items.length === 0 ? (
              <p className="empty-copy">No matching archived sessions.</p>
            ) : evidence.items.map((row, index) => (
              <article className="evidence-row" key={display(row.session_id, String(index))}>
                <div><h3>{evidenceTitle(row)}</h3><p>{display(row.source)} · {display(row.model, 'Model unavailable')}</p></div>
                <time>{display(row.started_at, 'Date unavailable').slice(0, 10)}</time>
              </article>
            ))}
          </section>

          <section className="project-control-panel">
            <div className="project-control-panel-title">
              <BookOpen size={18} />
              <div><h2>Canonical learning state</h2><p>Approved knowledge that native-agent adapters reference.</p></div>
            </div>
            <p className="learning-path">{selected.project.learning_state_path}</p>
            <div className="learning-files">
              {Object.entries(learningState?.files || {}).map(([name, content]) => (
                <div key={name}><span>{name}</span><small>{content ? `${content.split('\n').length} lines` : 'Missing'}</small></div>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
