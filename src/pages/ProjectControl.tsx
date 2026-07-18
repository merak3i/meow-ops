import { useEffect, useMemo, useState } from 'react';
import {
  BookOpen, CheckCircle2, ChevronRight, Eye, FileSearch, RefreshCw, ShieldCheck,
  TriangleAlert,
} from 'lucide-react';

import {
  applyProjectContextAdapters,
  fetchProjectControlPortfolio,
  fetchProjectEvidence,
  fetchProjectLearningState,
  previewProjectContextAdapters,
  rollbackProjectContextAdapters,
  type ProjectAdapterPreview,
  type ProjectControlSnapshot,
  type ProjectEvidenceResponse,
  type ProjectLearningStateResponse,
} from '../lib/loop-api';
import './ProjectControl.css';

type ViewMode = 'eagle' | 'surgical';

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

export default function ProjectControl() {
  const [projects, setProjects] = useState<ProjectControlSnapshot[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [mode, setMode] = useState<ViewMode>('eagle');
  const [learningState, setLearningState] = useState<ProjectLearningStateResponse | null>(null);
  const [evidence, setEvidence] = useState<ProjectEvidenceResponse | null>(null);
  const [adapterPreview, setAdapterPreview] = useState<ProjectAdapterPreview | null>(null);
  const [adapterSyncId, setAdapterSyncId] = useState('');
  const [adapterMessage, setAdapterMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const selected = useMemo(
    () => projects.find((project) => project.project.project_id === selectedId) || projects[0] || null,
    [projects, selectedId],
  );

  async function loadPortfolio() {
    setLoading(true);
    setError('');
    const result = await fetchProjectControlPortfolio();
    if (!result.ok) setError('The local Meow Ops helper is not available.');
    setProjects(result.projects || []);
    if (!selectedId && result.projects?.[0]) setSelectedId(result.projects[0].project.project_id);
    setLoading(false);
  }

  useEffect(() => { void loadPortfolio(); }, []);

  useEffect(() => {
    if (!selected) return;
    setLearningState(null);
    setEvidence(null);
    setAdapterPreview(null);
    setAdapterSyncId('');
    setAdapterMessage('');
    void fetchProjectLearningState(selected.project.project_id).then(setLearningState);
  }, [selected?.project.project_id]);

  useEffect(() => {
    if (mode !== 'surgical' || !selected || evidence) return;
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
        <button className="project-control-refresh" type="button" onClick={() => void loadPortfolio()}>
          <RefreshCw size={15} /> Refresh evidence
        </button>
      </header>

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
          <button type="button" className={mode === 'eagle' ? 'active' : ''} onClick={() => setMode('eagle')}>
            <Eye size={15} /> Eagle Eye
          </button>
          <button type="button" className={mode === 'surgical' ? 'active' : ''} onClick={() => setMode('surgical')}>
            <FileSearch size={15} /> Surgical View
          </button>
        </div>
      </div>

      {mode === 'eagle' ? (
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
                <div><span>{learning.kind} · {learning.impact} impact</span><h3>{learning.title}</h3><p>{learning.rationale}</p></div>
                <strong className={`learning-status ${learning.status}`}>{learning.status}</strong>
              </article>
            ))}
          </section>
        </>
      ) : (
        <div className="project-control-columns surgical-columns">
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
