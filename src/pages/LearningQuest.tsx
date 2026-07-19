import { useEffect, useMemo, useState } from 'react';
import {
  BookOpenCheck, BrainCircuit, Check, CircleDashed, Code2, Compass, Flame,
  Plus, RefreshCw, ShieldCheck, Sparkles, Trash2, Trophy,
} from 'lucide-react';

import {
  fetchLearningQuestSnapshot, recordLearningQuestEvent, removeLearningQuestTopic,
  saveLearningQuestTopic, type LearningQuestLane, type LearningQuestSnapshot,
  type LearningQuestTopic, verifyLearningQuestProof,
} from '../lib/loop-api';
import './LearningQuest.css';

const LANES: Array<{ id: LearningQuestLane; label: string; note: string }> = [
  { id: 'code', label: 'Code Spine', note: 'The mandatory engineering path' },
  { id: 'product', label: 'Product', note: 'Turn systems into user value' },
  { id: 'marketing', label: 'Marketing', note: 'Explain the proof clearly' },
  { id: 'gtm', label: 'GTM', note: 'Choose where the proof travels' },
  { id: 'sales', label: 'Sales', note: 'Connect proof to a buying decision' },
];
const STAGES = ['discovered', 'practiced', 'proven', 'shipped'] as const;
const ACTION_LABELS: Record<string, string> = {
  lesson_opened: 'Open lesson', concept_preview_completed: 'Finish concept preview',
  exercise_attempted: 'Attempt exercise', code_changed: 'Modify critical code',
  tests_passed: 'Verify tests', broken_case_repaired: 'Repair broken case',
  feynman_passed: 'Pass the Oracle explanation', commit_verified: 'Verify linked Git commit',
};

const emptyForm = { topic_id: '', title: '', summary: '', lane: 'code' as LearningQuestLane, difficulty: 1, tags: '' };

export default function LearningQuest() {
  const [data, setData] = useState<LearningQuestSnapshot | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState(false);
  const [answer, setAnswer] = useState('');
  const [rubricOpen, setRubricOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [assistance, setAssistance] = useState('scaffold');

  async function load() {
    setBusy(true);
    const snapshot = await fetchLearningQuestSnapshot();
    setData(snapshot.ok ? snapshot : null);
    if (!selectedId && snapshot.topics?.[0]) setSelectedId(snapshot.topics[0].topic_id);
    setBusy(false);
  }

  useEffect(() => { void load(); }, []);

  const selected = useMemo(
    () => data?.topics.find((topic) => topic.topic_id === selectedId) || data?.topics[0] || null,
    [data, selectedId],
  );

  async function mutate(operation: Promise<LearningQuestSnapshot | null>, success: string) {
    setBusy(true); setMessage('');
    const next = await operation;
    if (next?.ok) { setData(next); setMessage(success); }
    else setMessage('The local learning helper could not complete that action.');
    setBusy(false);
  }

  async function record(action: string, result = 'completed', rubric?: Record<string, number>) {
    if (!selected) return;
    await mutate(recordLearningQuestEvent({
      topic_id: selected.topic_id, action, result, assistance, rubric,
      confidence_before: selected.recall.confidence, confidence_after: result === 'failed' ? 0 : 1,
    }), 'Evidence recorded. Mastery was recalculated.');
  }

  function editTopic(topic?: LearningQuestTopic) {
    setForm(topic ? {
      topic_id: topic.topic_id, title: topic.title, summary: topic.summary, lane: topic.lane,
      difficulty: topic.difficulty, tags: topic.tags.join(', '),
    } : emptyForm);
    setEditing(true);
  }

  async function saveTopic() {
    const topicId = form.topic_id || form.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    await mutate(saveLearningQuestTopic({
      ...form, topic_id: topicId, tags: form.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
      approved_for_projection: true,
    }), 'Topic saved to the private curriculum.');
    setSelectedId(topicId); setEditing(false);
  }

  if (!data) {
    return <div className="quest-state"><BrainCircuit /><h1>Learning Quest is local-only</h1><p>Start the Meow Ops helper to open your private curriculum.</p><button onClick={() => void load()}><RefreshCw size={15} /> Retry</button></div>;
  }

  const capability = Math.round((data.summary?.durable_capability || 0) * 100);
  const activeActions = selected?.progress.next_actions.filter((action) => action !== 'feynman_passed') || [];
  const needsFeynman = selected?.progress.next_actions.includes('feynman_passed') || false;

  return (
    <div className="quest-page">
      <header className="quest-hero">
        <div><p className="quest-kicker">Personal learning constellation</p><h1>Build proof. Keep the understanding.</h1><p>Code is the spine. Side quests appear when the work creates something worth shaping, explaining, distributing, or selling.</p></div>
        <button className="quest-add" onClick={() => editTopic()}><Plus size={16} /> New topic</button>
      </header>

      <section className="quest-privacy"><ShieldCheck size={17} /><p><strong>Semantic firewall active.</strong> This screen receives approved generic competencies only. Source files, project records, paths, evidence, and artifact metadata remain outside the browser response.</p></section>

      <section className="quest-scoreline">
        <div><span>Durable capability</span><strong>{capability}%</strong><small>Level {data.rewards.level} · {data.rewards.xp} XP · {data.rewards.streak_days} day streak</small></div>
        {STAGES.map((stage) => <div key={stage}><span>{stage}</span><strong>{data.summary.by_stage[stage] || 0}</strong><small>evidence-derived topics</small></div>)}
      </section>

      <div className="quest-layout">
        <section className="quest-map">
          {LANES.map((lane) => {
            const topics = data.topics.filter((topic) => topic.lane === lane.id);
            return <div className={`quest-lane quest-lane--${lane.id}`} key={lane.id}>
              <div className="quest-lane-label"><span>{lane.label}</span><small>{lane.note}</small></div>
              <div className="quest-nodes">
                {topics.map((topic) => <button key={topic.topic_id} className={`quest-node ${selected?.topic_id === topic.topic_id ? 'active' : ''}`} onClick={() => { setSelectedId(topic.topic_id); setAnswer(''); setRubricOpen(false); }}>
                  <span className={`quest-node-mark stage-${topic.stage || 'unstarted'}`}>{topic.stage === 'shipped' ? <Trophy size={16} /> : topic.stage ? <Check size={16} /> : <CircleDashed size={16} />}</span>
                  <span><strong>{topic.title}</strong><small>{topic.stage || 'not started'} · level {topic.difficulty}</small></span>
                  {topic.recall.refresh_due && <Flame className="quest-refresh" size={15} />}
                </button>)}
                {topics.length === 0 && <p className="quest-lane-empty">No {lane.id} quest yet.</p>}
              </div>
            </div>;
          })}
        </section>

        <aside className="quest-focus">
          {selected ? <>
            <div className="quest-focus-head"><div><span>{selected.lane} · level {selected.difficulty}</span><h2>{selected.title}</h2></div><button aria-label="Edit topic" onClick={() => editTopic(selected)}><Compass size={16} /></button></div>
            <p>{selected.summary}</p>
            <label className="quest-assistance">AI assistance for this action<select value={assistance} onChange={(event) => setAssistance(event.target.value)}><option value="scaffold">Scaffold</option><option value="hint">Hint</option><option value="explanation">Explanation</option><option value="partial_solution">Partial solution</option><option value="full_solution">Full solution</option><option value="none">None</option></select></label>
            <div className="quest-stage-track">{STAGES.map((stage) => <div className={STAGES.indexOf(stage) <= STAGES.indexOf(selected.stage as typeof STAGES[number]) ? 'reached' : ''} key={stage}><span /><small>{stage}</small></div>)}</div>

            <section className="quest-actions"><h3>Next proof</h3>{activeActions.length ? activeActions.map((action) => <button disabled={busy} key={action} onClick={() => void (action === 'commit_verified' ? mutate(verifyLearningQuestProof(selected.topic_id), 'Local Git proof verified. Mastery was recalculated.') : record(action))}><Code2 size={15} /> {ACTION_LABELS[action] || action}</button>) : needsFeynman ? <p>Explain the concept to the Oracle below to complete Proven.</p> : <p>Stage evidence is complete. Keep recall alive or begin a side quest.</p>}</section>

            <section className="quest-oracle"><div><Sparkles size={17} /><span>Oracle check · {selected.next_question.kind}</span></div><h3>{selected.next_question.question_text}</h3><textarea value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="Explain in your own words. This text stays in the browser and is never stored." />
              {!rubricOpen ? <button disabled={answer.trim().length < 40} onClick={() => setRubricOpen(true)}><BookOpenCheck size={15} /> Compare with rubric</button> : <div className="quest-rubric"><p>Can your answer explain the cause, the boundary, a failure case, and a transfer example without relying on jargon?</p><div><button onClick={() => void record(needsFeynman ? 'feynman_passed' : 'recall_passed', 'passed', { accuracy: 1, clarity: 1, causality: 1, transfer: 1 })}>Yes, with evidence</button><button onClick={() => void record('recall_failed', 'failed')}>Needs refresh</button></div></div>}
            </section>

            <div className="quest-recall"><BrainCircuit size={17} /><div><span>Recall confidence {Math.round(selected.recall.confidence * 100)}%</span><small>Next interval: {selected.recall.interval_days} days · history never gets erased</small></div></div>
            <button className="quest-delete" onClick={() => { if (window.confirm('Remove this topic from the curriculum? Its append-only evidence history will remain.')) void mutate(removeLearningQuestTopic(selected.topic_id), 'Topic removed; evidence history preserved.'); }}><Trash2 size={14} /> Remove topic</button>
          </> : <div className="quest-empty"><Compass /><h2>Shape the first quest</h2><p>Create one generic competency. Private project linkage stays in the local backend.</p></div>}
          {message && <p className="quest-message">{message}</p>}
        </aside>
      </div>

      <section className="quest-analytics" aria-label="Learning analytics">
        <header><div><p className="quest-kicker">Deep analyzer</p><h2>What the evidence says</h2></div><small>Aggregate signals only. No answers, code, paths, or proof records.</small></header>
        <div className="quest-analytics-grid">
          <div><span>Recall pass rate</span><strong>{Math.round(data.analytics.recall.pass_rate * 100)}%</strong><small>{data.analytics.recall.refresh_due} refreshes due · {data.analytics.recall.reached_360_days} at 360 days</small></div>
          <div><span>AI independence</span><strong>{Math.round(data.analytics.independence.unassisted_rate * 100)}%</strong><small>{data.analytics.independence.completed_actions} completed actions</small></div>
          <div><span>Feynman quality</span><strong>{Math.round(data.analytics.explanation.rubric_average * 100)}%</strong><small>{data.analytics.explanation.passes} explanations proven</small></div>
          <div><span>Confidence calibration</span><strong>{Math.round((1 - data.analytics.calibration_error) * 100)}%</strong><small>Higher means predictions match outcomes</small></div>
        </div>
      </section>

      {editing && <div className="quest-modal" role="dialog" aria-modal="true" aria-label="Learning topic editor"><form onSubmit={(event) => { event.preventDefault(); void saveTopic(); }}><header><div><span>Private curriculum editor</span><h2>{form.topic_id ? 'Edit topic' : 'Create topic'}</h2></div><button type="button" onClick={() => setEditing(false)}>Close</button></header><label>Generic concept title<input required maxLength={120} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label><label>Concept-only summary<textarea required maxLength={500} value={form.summary} onChange={(event) => setForm({ ...form, summary: event.target.value })} /></label><div className="quest-form-row"><label>Lane<select value={form.lane} onChange={(event) => setForm({ ...form, lane: event.target.value as LearningQuestLane })}>{LANES.map((lane) => <option value={lane.id} key={lane.id}>{lane.label}</option>)}</select></label><label>Difficulty<select value={form.difficulty} onChange={(event) => setForm({ ...form, difficulty: Number(event.target.value) })}>{[1, 2, 3, 4, 5].map((level) => <option value={level} key={level}>Level {level}</option>)}</select></label></div><label>Generic tags<input value={form.tags} onChange={(event) => setForm({ ...form, tags: event.target.value })} placeholder="reliability, schemas" /></label><p className="quest-form-warning">Do not enter project names, paths, customer details, private architecture, source excerpts, or artifact metadata.</p><button className="quest-save" disabled={busy} type="submit">Save topic</button></form></div>}
    </div>
  );
}
