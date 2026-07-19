import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight, BarChart3, BookOpenCheck, BrainCircuit, Check, Clock3,
  Code2, Compass, Flame, Gauge, Layers3, Map, Play, Plus, RefreshCw, ShieldCheck,
  Sparkles, Target, Trash2, Trophy,
} from 'lucide-react';

import {
  fetchLearningQuestSnapshot, recordLearningQuestEvent, removeLearningQuestTopic,
  saveLearningQuestTopic, type LearningQuestLane, type LearningQuestSnapshot,
  type LearningQuestTopic, updateLearningQuestWorkshop, verifyLearningQuestProof,
} from '../lib/loop-api';
import './LearningQuest.css';

const LANES: Array<{ id: LearningQuestLane; label: string; note: string }> = [
  { id: 'code', label: 'Code', note: 'Build the mechanism' },
  { id: 'product', label: 'Product', note: 'Shape user value' },
  { id: 'marketing', label: 'Marketing', note: 'Explain the proof' },
  { id: 'gtm', label: 'GTM', note: 'Find the path outward' },
  { id: 'sales', label: 'Sales', note: 'Connect proof to need' },
];
const STAGES = ['discovered', 'practiced', 'proven', 'shipped'] as const;
const VIEWS = [
  { id: 'today', label: 'Today', icon: Target },
  { id: 'recall', label: 'Quick recall', icon: BrainCircuit },
  { id: 'paths', label: 'Paths', icon: Map },
  { id: 'insights', label: 'Insights', icon: BarChart3 },
] as const;
type QuestView = typeof VIEWS[number]['id'];

const ACTION_LABELS: Record<string, string> = {
  lesson_opened: 'Open the lesson', concept_preview_completed: 'Finish the concept preview',
  exercise_attempted: 'Attempt the exercise', code_changed: 'Confirm the critical code changed',
  tests_passed: 'Confirm the tests pass', broken_case_repaired: 'Repair the broken case',
  feynman_passed: 'Complete the first-principles check', commit_verified: 'Verify the local Git commit',
};
const INTERVENTIONS: Record<string, string> = {
  refresh_due_recall: 'Refresh one fading concept before starting new work.',
  repair_and_explain: 'Repair a broken case, then explain why the fix works.',
  ship_verified_proof: 'Turn proven understanding into one verifiable shipment.',
  open_smallest_lesson: 'Open the smallest unfinished lesson and make one honest step.',
  choose_new_topic: 'Choose the path that has the most useful pull today.',
};
const REWARD_LABELS = {
  understanding: ['First principles', 'Clear explanations'],
  independence: ['Independent craft', 'Less AI dependence'],
  shipping: ['Verified shipping', 'Proof in the world'],
  consistency: ['Steady rhythm', 'Days returned'],
} as const;

const emptyForm = { topic_id: '', title: '', summary: '', lane: 'code' as LearningQuestLane, difficulty: 1, tags: '' };

export default function LearningQuest() {
  const [data, setData] = useState<LearningQuestSnapshot | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [selectedLane, setSelectedLane] = useState<LearningQuestLane>('code');
  const [view, setView] = useState<QuestView>('today');
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
    setSelectedId((current) => current || snapshot.workshop?.focus_topic_id || snapshot.topics?.[0]?.topic_id || '');
    setBusy(false);
  }

  useEffect(() => { void load(); }, []);

  const selected = useMemo(
    () => data?.topics.find((topic) => topic.topic_id === selectedId) || data?.topics[0] || null,
    [data, selectedId],
  );
  const dueTopics = useMemo(() => data?.topics.filter((topic) =>
    topic.progress.action_count > 0 && topic.recall.refresh_due) || [], [data]);
  const pathTopics = useMemo(() => data?.topics.filter((topic) => topic.lane === selectedLane) || [], [data, selectedLane]);

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
    }), 'Proof recorded. Your journey has been recalculated.');
  }

  function chooseTopic(topic: LearningQuestTopic, nextView: QuestView = 'today') {
    setSelectedId(topic.topic_id);
    setSelectedLane(topic.lane);
    setAnswer('');
    setRubricOpen(false);
    setView(nextView);
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
    }), 'Topic added to your private syllabus.');
    setSelectedId(topicId); setSelectedLane(form.lane); setEditing(false);
  }

  if (!data) {
    return <div className="quest-state"><BrainCircuit /><h1>The Builder's Journey is local-only</h1><p>Start the Meow Ops helper to open your private workshop.</p><button onClick={() => void load()}><RefreshCw size={15} /> Retry</button></div>;
  }

  const capability = Math.round((data.summary?.durable_capability || 0) * 100);
  const activeActions = selected?.progress.next_actions.filter((action) => action !== 'feynman_passed') || [];
  const nextAction = activeActions[0];
  const needsFeynman = selected?.progress.next_actions.includes('feynman_passed') || false;
  const workshopActive = data.workshop.state === 'active';

  return (
    <div className="quest-page">
      <header className="quest-hero">
        <div>
          <p className="quest-kicker">The Builder's Journey</p>
          <h1>From vibe to first principles.</h1>
          <p>Follow curiosity. Build the mechanism. Explain why it works. Leave with proof.</p>
        </div>
        <div className="quest-level"><span>Builder level {data.rewards.level}</span><strong>{data.rewards.xp} XP</strong><small>{capability}% durable capability</small></div>
      </header>

      <nav className="quest-tabs" aria-label="Builder's Journey sections">
        {VIEWS.map(({ id, label, icon: Icon }) => <button key={id} className={view === id ? 'active' : ''} onClick={() => setView(id)}><Icon size={16} />{label}{id === 'recall' && dueTopics.length > 0 && <span>{dueTopics.length}</span>}</button>)}
        <button className="quest-manage" onClick={() => editTopic()}><Plus size={15} /> Manage syllabus</button>
      </nav>

      <section className="quest-trust"><ShieldCheck size={16} /><span>Local semantic firewall</span><p>Only approved concepts and aggregate progress reach this screen.</p></section>

      {view === 'today' && <main className="quest-today">
        <section className={`quest-workshop ${workshopActive ? 'is-active' : ''}`}>
          <div className="quest-workshop-copy">
            <p className="quest-kicker">{workshopActive ? 'Open workshop' : 'Spontaneous workshop'}</p>
            <h2>{workshopActive ? data.workshop.reminder : 'Start wherever the useful pull is strongest.'}</h2>
            <p>{workshopActive ? `${data.workshop.age_days === 0 ? 'Started today' : `Open for ${data.workshop.age_days} days`}. Nothing is lost when life interrupts.` : 'No schedule pressure. Pick any path and complete one meaningful learning action.'}</p>
          </div>
          <div className="quest-health">
            <div><span>Workshop health</span><strong>{data.workshop.health}%</strong></div>
            <div className="quest-health-track" role="progressbar" aria-label="Workshop health" aria-valuemin={0} aria-valuemax={100} aria-valuenow={data.workshop.health}><span style={{ width: `${data.workshop.health}%` }} /></div>
            <small>{workshopActive ? `${data.workshop.completed_count} advanced · ${data.workshop.pending_count} waiting` : 'Health tracks recency and honest progress, never worth.'}</small>
          </div>
          <div className="quest-workshop-actions">
            {!workshopActive && selected && <button className="quest-primary" disabled={busy} onClick={() => void mutate(updateLearningQuestWorkshop('start', [selected.topic_id]), 'Workshop started. One honest action is enough for today.')}><Play size={16} /> Start with {selected.title}</button>}
            {workshopActive && selected && <button className="quest-primary" onClick={() => document.getElementById('current-proof')?.scrollIntoView({ behavior: 'smooth' })}><ArrowRight size={16} /> Resume next proof</button>}
            {workshopActive && data.workshop.can_complete && <button disabled={busy} onClick={() => void mutate(updateLearningQuestWorkshop('complete'), 'Workshop closed. Your learning remains ready for recall.')}><Check size={16} /> Finish workshop</button>}
          </div>
        </section>

        <div className="quest-today-grid">
          <section className="quest-focus" id="current-proof">
            {selected ? <>
              <header className="quest-focus-head"><div><span>{LANES.find((lane) => lane.id === selected.lane)?.label} path · level {selected.difficulty}</span><h2>{selected.title}</h2></div><button aria-label="Edit topic" onClick={() => editTopic(selected)}><Compass size={16} /></button></header>
              <p>{selected.summary}</p>
              <div className="quest-stage-track">{STAGES.map((stage) => <div className={STAGES.indexOf(stage) <= STAGES.indexOf(selected.stage as typeof STAGES[number]) ? 'reached' : ''} key={stage}><span /><small>{stage}</small></div>)}</div>

              <section className="quest-next-proof">
                <div><p className="quest-kicker">One next proof</p><h3>{needsFeynman && !nextAction ? 'Explain it without hiding behind jargon.' : nextAction ? ACTION_LABELS[nextAction] || nextAction : 'This concept is ready to be kept alive.'}</h3></div>
                {nextAction && <button className="quest-primary" disabled={busy || !workshopActive} onClick={() => void (nextAction === 'commit_verified' ? mutate(verifyLearningQuestProof(selected.topic_id), 'Local Git proof verified.') : record(nextAction))}><Code2 size={16} /> {ACTION_LABELS[nextAction] || nextAction}</button>}
                {!nextAction && !needsFeynman && <button onClick={() => { setView('recall'); setAnswer(''); }}><BrainCircuit size={16} /> Run a recall check</button>}
                {!workshopActive && <small>Start the workshop to record progress.</small>}
              </section>

              <details className="quest-assistance"><summary>AI assistance: {assistance.replace('_', ' ')}</summary><label>Choose the smallest help that keeps you thinking<select value={assistance} onChange={(event) => setAssistance(event.target.value)}><option value="none">None</option><option value="scaffold">Scaffold</option><option value="hint">Hint</option><option value="explanation">Explanation</option><option value="partial_solution">Partial solution</option><option value="full_solution">Full solution</option></select></label></details>

              {needsFeynman && <FeynmanCheck topic={selected} answer={answer} setAnswer={setAnswer} rubricOpen={rubricOpen} setRubricOpen={setRubricOpen} busy={busy} onPass={() => void record('feynman_passed', 'passed', { accuracy: 1, clarity: 1, causality: 1, transfer: 1 })} onFail={() => void record('recall_failed', 'failed')} />}
            </> : <div className="quest-empty"><Compass /><h2>Shape the first path</h2><p>Add one generic competency. Private project linkage remains in the local helper.</p></div>}
            {message && <p className="quest-message" role="status">{message}</p>}
          </section>

          <aside className="quest-sidecar">
            <section><Clock3 size={17} /><div><span>Quick return</span><strong>{dueTopics.length ? `${dueTopics.length} recall ${dueTopics.length === 1 ? 'check' : 'checks'} waiting` : 'Memory is current'}</strong><button onClick={() => setView('recall')}>{dueTopics.length ? 'Start a 2-minute recall' : 'Practice anyway'} <ArrowRight size={14} /></button></div></section>
            <section><Gauge size={17} /><div><span>Evidence says</span><strong>{INTERVENTIONS[data.analytics.guidance.next_intervention]}</strong><small>Independence is {data.analytics.guidance.independence_direction}.</small></div></section>
            <section><Layers3 size={17} /><div><span>Freedom to choose</span><strong>Every path is open</strong><button onClick={() => setView('paths')}>Browse all five paths <ArrowRight size={14} /></button></div></section>
          </aside>
        </div>
      </main>}

      {view === 'paths' && <main className="quest-paths">
        <header><div><p className="quest-kicker">Independent paths</p><h2>Choose the kind of builder you need today.</h2><p>No lane is locked behind another. Code is central, not compulsory.</p></div></header>
        <div className="quest-lane-switcher" role="tablist" aria-label="Learning paths">{LANES.map((lane) => <button role="tab" aria-selected={selectedLane === lane.id} className={selectedLane === lane.id ? 'active' : ''} key={lane.id} onClick={() => setSelectedLane(lane.id)}><span>{lane.label}</span><small>{lane.note}</small></button>)}</div>
        <section className="quest-path-list">{pathTopics.map((topic, index) => <button key={topic.topic_id} className={selected?.topic_id === topic.topic_id ? 'active' : ''} onClick={() => chooseTopic(topic)}><span className={`quest-node-mark stage-${topic.stage || 'unstarted'}`}>{topic.stage === 'shipped' ? <Trophy size={16} /> : topic.stage ? <Check size={16} /> : <span>{index + 1}</span>}</span><span><strong>{topic.title}</strong><small>{topic.stage || 'Ready to discover'} · level {topic.difficulty}</small></span>{topic.recall.refresh_due && <Flame className="quest-refresh" size={15} />}<ArrowRight size={16} /></button>)}</section>
      </main>}

      {view === 'recall' && <main className="quest-recall-mode">
        <header><div><p className="quest-kicker">Two-minute return</p><h2>Pull the idea from memory.</h2><p>Mobile-friendly, private, and low pressure. A miss schedules a nearer return without erasing mastery.</p></div><span>{dueTopics.length} due</span></header>
        <div className="quest-recall-layout">
          <aside>{(dueTopics.length ? dueTopics : data.topics).map((topic) => <button className={selected?.topic_id === topic.topic_id ? 'active' : ''} key={topic.topic_id} onClick={() => chooseTopic(topic, 'recall')}><BrainCircuit size={15} /><span><strong>{topic.title}</strong><small>{topic.recall.refresh_due ? 'Due now' : `${topic.recall.interval_days}-day interval`}</small></span></button>)}</aside>
          {selected && <FeynmanCheck topic={selected} answer={answer} setAnswer={setAnswer} rubricOpen={rubricOpen} setRubricOpen={setRubricOpen} busy={busy} recall onPass={() => void record('recall_passed', 'passed', { accuracy: 1, clarity: 1, causality: 1, transfer: 1 })} onFail={() => void record('recall_failed', 'failed')} />}
        </div>
        {message && <p className="quest-message" role="status">{message}</p>}
      </main>}

      {view === 'insights' && <main className="quest-insights">
        <header><div><p className="quest-kicker">Evidence, translated</p><h2>What to do next, not just what happened.</h2></div><small>Aggregate signals only. No answers, code, paths, dates, or proof records.</small></header>
        <section className="quest-intervention"><Sparkles size={20} /><div><span>Best next intervention</span><h3>{INTERVENTIONS[data.analytics.guidance.next_intervention]}</h3><p>The largest current stage cluster is {data.analytics.guidance.bottleneck_stage}. Independence is {data.analytics.guidance.independence_direction}.</p></div></section>
        <section className="quest-rewards">{Object.entries(data.rewards.dimensions).map(([key, value]) => { const copy = REWARD_LABELS[key as keyof typeof REWARD_LABELS]; return <div key={key}><span>{copy[0]}</span><strong>{value}</strong><small>{copy[1]}</small></div>; })}</section>
        <section className="quest-metrics">
          <div><span>Recall health</span><strong>{Math.round(data.analytics.recall.pass_rate * 100)}%</strong><small>{data.analytics.recall.refresh_due} due · {data.analytics.recall.reached_360_days} at 360 days</small></div>
          <div><span>AI independence</span><strong>{Math.round(data.analytics.independence.unassisted_rate * 100)}%</strong><small>{data.analytics.independence.completed_actions} completed actions</small></div>
          <div><span>Explanation quality</span><strong>{Math.round(data.analytics.explanation.rubric_average * 100)}%</strong><small>{data.analytics.explanation.passes} explanations proven</small></div>
          <div><span>Calibration</span><strong>{Math.round((1 - data.analytics.calibration_error) * 100)}%</strong><small>Predicted confidence versus result</small></div>
        </section>
      </main>}

      {editing && <div className="quest-modal" role="dialog" aria-modal="true" aria-label="Learning topic editor"><form onSubmit={(event) => { event.preventDefault(); void saveTopic(); }}><header><div><span>Private syllabus</span><h2>{form.topic_id ? 'Edit topic' : 'Create topic'}</h2></div><button type="button" onClick={() => setEditing(false)}>Close</button></header><label>Generic concept title<input required maxLength={120} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label><label>Concept-only summary<textarea required maxLength={500} value={form.summary} onChange={(event) => setForm({ ...form, summary: event.target.value })} /></label><div className="quest-form-row"><label>Independent path<select value={form.lane} onChange={(event) => setForm({ ...form, lane: event.target.value as LearningQuestLane })}>{LANES.map((lane) => <option value={lane.id} key={lane.id}>{lane.label}</option>)}</select></label><label>Difficulty<select value={form.difficulty} onChange={(event) => setForm({ ...form, difficulty: Number(event.target.value) })}>{[1, 2, 3, 4, 5].map((level) => <option value={level} key={level}>Level {level}</option>)}</select></label></div><label>Generic tags<input value={form.tags} onChange={(event) => setForm({ ...form, tags: event.target.value })} placeholder="reliability, schemas" /></label><p className="quest-form-warning">Keep this conceptual. Do not enter project names, paths, customers, private architecture, excerpts, or artifact metadata.</p><button className="quest-save" disabled={busy} type="submit">Save topic</button>{form.topic_id && <button className="quest-delete" type="button" onClick={() => { if (window.confirm('Remove this topic? Its append-only learning history will remain.')) void mutate(removeLearningQuestTopic(form.topic_id), 'Topic removed; learning history preserved.'); setEditing(false); }}><Trash2 size={14} /> Remove topic</button>}</form></div>}
    </div>
  );
}

function FeynmanCheck({ topic, answer, setAnswer, rubricOpen, setRubricOpen, busy, recall = false, onPass, onFail }: {
  topic: LearningQuestTopic;
  answer: string;
  setAnswer: (value: string) => void;
  rubricOpen: boolean;
  setRubricOpen: (value: boolean) => void;
  busy: boolean;
  recall?: boolean;
  onPass: () => void;
  onFail: () => void;
}) {
  return <section className={`quest-oracle ${recall ? 'quest-oracle--recall' : ''}`}>
    <div className="quest-oracle-label"><BookOpenCheck size={17} /><span>{recall ? 'Recall prompt' : 'First-principles check'} · {topic.next_question.kind}</span></div>
    <h3>{topic.next_question.question_text}</h3>
    <textarea aria-label="Explain in your own words" value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="Explain it simply. Your answer stays in this browser tab and is never stored." />
    {!rubricOpen ? <button className="quest-primary" disabled={busy || answer.trim().length < 40} onClick={() => setRubricOpen(true)}>Check my explanation</button> : <div className="quest-rubric"><p>Does it cover the mechanism, boundary, failure case, and transfer example without leaning on jargon?</p><div><button className="quest-primary" disabled={busy} onClick={onPass}>Yes, all four</button><button disabled={busy} onClick={onFail}>Not yet, bring it back sooner</button></div></div>}
  </section>;
}
