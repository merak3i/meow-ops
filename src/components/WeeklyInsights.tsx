import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Check, CircleAlert, Info } from 'lucide-react';
import { fetchSessionWindow } from '../lib/queries.js';
import { buildWeeklyInsights, weeklyEvidenceWindow, type WeeklyInsightCard, type WeeklyInsightResult, type WeeklyEvidencePatterns, type WeeklyInsightEvidence } from '../lib/weekly-insights.mjs';
import type { Session } from '../types/session';
import './WeeklyInsights.css';

type Feedback = 'useful' | 'inaccurate' | 'already-handled';
type Outcome = 'not-tried' | 'tried-helped' | 'tried-no-change';
type FeedbackMap = Record<string, { value?: Feedback; outcome?: Outcome; updatedAt: string }>;

interface Props {
  sourceFilter: string | null;
  referenceAt: number;
  refreshKey: number;
  sourceCoverage?: Record<string, { state?: string }> | null | undefined;
  sampleData?: boolean;
  weeklyEvidencePatterns?: WeeklyEvidencePatterns | null;
}

const FEEDBACK_KEY = 'meow-ops-weekly-insight-feedback-v1';
const FEEDBACK_VALUES = new Set<Feedback>(['useful', 'inaccurate', 'already-handled']);
const OUTCOME_VALUES = new Set<Outcome>(['not-tried', 'tried-helped', 'tried-no-change']);

function insightFeedbackKey(id: string, currentStart: string, sourceFilter: string | null): string {
  return `${currentStart.slice(0, 10)}:${sourceFilter || 'all'}:${id}`;
}

function readFeedback(): FeedbackMap {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(FEEDBACK_KEY) || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([, item]) => {
      if (!item || typeof item !== 'object' || typeof (item as { updatedAt?: unknown }).updatedAt !== 'string'
        || !Number.isFinite(Date.parse((item as { updatedAt: string }).updatedAt))) return false;
      const record = item as { value?: Feedback; outcome?: Outcome };
      return (record.value !== undefined && FEEDBACK_VALUES.has(record.value))
        || (record.outcome !== undefined && OUTCOME_VALUES.has(record.outcome));
    })) as FeedbackMap;
  } catch { return {}; }
}

function saveFeedback(next: FeedbackMap): boolean {
  try {
    const bounded = Object.fromEntries(Object.entries(next)
      .sort((a, b) => a[1].updatedAt.localeCompare(b[1].updatedAt))
      .slice(-200));
    localStorage.setItem(FEEDBACK_KEY, JSON.stringify(bounded));
    return true;
  } catch { return false; }
}

function periodLabel(from: string, to: string): string {
  const start = new Date(from).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const end = new Date(to).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${start}–${end}`;
}

function EvidenceList({ evidence }: { evidence: WeeklyInsightEvidence[] }) {
  return <ul>{evidence.map((item) => <li key={item.recordId || `${item.source}:${item.sessionId}`}>
    <span>{item.project} · {item.source} · {new Date(item.activityAt).toLocaleString()}</span>
    <code>{item.sessionId}</code>
    {item.rootSessionId && item.rootSessionId !== item.sessionId && <span>Counted under parent: <code>{item.rootSessionId}</code></span>}
    {item.recordId && <code>Evidence: {item.recordId}</code>}
    {item.excerpt && <pre>{item.excerpt}</pre>}
  </li>)}</ul>;
}

function InsightCard({ card, feedback, onFeedback }: {
  card: WeeklyInsightCard;
  feedback: { value?: Feedback; outcome?: Outcome } | undefined;
  onFeedback: (id: string, value: Feedback | Outcome, field: 'value' | 'outcome') => void;
}) {
  return <article className="weekly-insight-card">
    <div className="weekly-insight-card__heading">
      <h3>{card.title}</h3>
      <span>{card.sessionCount} independent sessions</span>
    </div>
    <p className="weekly-insight-card__what">{card.what}</p>
    <p className="weekly-insight-card__why">{card.why}</p>
    <div className="weekly-insight-card__comparison">
      {card.previousCount !== null && <>Similar time last week: <strong>{card.previousCount}</strong> matching session{card.previousCount === 1 ? '' : 's'} out of {card.previousTotal} {card.evidenceKind === 'tool-receipt' ? 'sessions with recognized receipts' : 'independent sessions'}. </>}
      {card.comparison}
    </div>
    <p className="weekly-insight-card__action"><ArrowUpRight size={14} aria-hidden="true" /> Next step: {card.action}</p>
    <details className="weekly-insight-evidence">
      <summary>Show supporting {card.evidenceKind === 'tool-receipt' ? 'receipts' : 'sessions'} ({card.evidence.length}{card.evidence.length < card.sessionCount ? ` of ${card.sessionCount}` : ''})</summary>
      <EvidenceList evidence={card.evidence} />
      {Boolean(card.counterexamples?.length) && <><p>Other recorded results (these do not establish recovery):</p><EvidenceList evidence={card.counterexamples || []} /></>}
      {Boolean(card.limitations?.length) && <ul>{card.limitations?.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul>}
    </details>
    <div className="weekly-insight-feedback" role="group" aria-label={`Feedback for ${card.title}`}>
      <button type="button" aria-pressed={feedback?.value === 'useful'} onClick={() => onFeedback(card.id, 'useful', 'value')}><Check size={13} aria-hidden="true" />Useful</button>
      <button type="button" aria-pressed={feedback?.value === 'inaccurate'} onClick={() => onFeedback(card.id, 'inaccurate', 'value')}><CircleAlert size={13} aria-hidden="true" />Inaccurate</button>
      <button type="button" aria-pressed={feedback?.value === 'already-handled'} onClick={() => onFeedback(card.id, 'already-handled', 'value')}>Already handled</button>
    </div>
    <label className="weekly-insight-outcome">Follow-up outcome
      <select aria-label={`Follow-up outcome for ${card.title}`} value={feedback?.outcome || 'not-tried'} onChange={(event) => onFeedback(card.id, event.target.value as Outcome, 'outcome')}>
        <option value="not-tried">Not tried</option>
        <option value="tried-helped">Tried — helped</option>
        <option value="tried-no-change">Tried — no change</option>
      </select>
    </label>
  </article>;
}

export default function WeeklyInsights({ sourceFilter, referenceAt, refreshKey, sourceCoverage, sampleData = false, weeklyEvidencePatterns = null }: Props) {
  const [result, setResult] = useState<WeeklyInsightResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<FeedbackMap>(readFeedback);
  const [feedbackMessage, setFeedbackMessage] = useState('');
  const requestedWindow = useMemo(() => weeklyEvidenceWindow(new Date(referenceAt)), [referenceAt]);
  const capturedAt = Date.parse(weeklyEvidencePatterns?.window.to || '');
  const matchesWeek = Number.isFinite(capturedAt) && capturedAt <= referenceAt
    && weeklyEvidencePatterns?.window.currentStart === requestedWindow.currentStart
    && weeklyEvidencePatterns?.window.timeZone === requestedWindow.timeZone;
  const effectiveReferenceAt = matchesWeek ? capturedAt : referenceAt;
  const window = useMemo(() => weeklyEvidenceWindow(new Date(effectiveReferenceAt)), [effectiveReferenceAt]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetchSessionWindow(window.from, window.to, sourceFilter ? { source: sourceFilter } : {})
      .then((archive) => {
        if (cancelled) return;
        setResult(buildWeeklyInsights(archive.items as Session[], {
          now: new Date(effectiveReferenceAt),
          sourceFilter,
          completeness: archive.completeness,
          sourceCoverage: sourceCoverage || null,
          weeklyEvidencePatterns,
          archiveVersion: archive.archiveVersion || null,
        }));
      })
      .catch(() => {
        if (cancelled) return;
        setResult(buildWeeklyInsights([], {
          now: new Date(effectiveReferenceAt), sourceFilter, completeness: 'unavailable', sourceCoverage: sourceCoverage || null,
        }));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [sourceFilter, effectiveReferenceAt, refreshKey, sourceCoverage, weeklyEvidencePatterns, window.from, window.to]);

  function rate(id: string, value: Feedback | Outcome, field: 'value' | 'outcome') {
    const key = insightFeedbackKey(id, window.currentStart, sourceFilter);
    const next = { ...feedback, [key]: { ...feedback[key], [field]: value, updatedAt: new Date().toISOString() } };
    setFeedback(next);
    setFeedbackMessage(saveFeedback(next) ? 'Feedback saved on this device.' : 'Feedback could not be saved in local storage.');
  }

  const currentLabel = periodLabel(window.currentStart, window.to);
  const priorLabel = periodLabel(window.previousStart, window.previousEnd);
  return <section className="weekly-insights" aria-labelledby="weekly-insights-title">
    <div className="weekly-insights__heading">
      <div>
        <h2 id="weekly-insights-title">This week: patterns and next steps</h2>
        <p>Week so far · {currentLabel} · {window.timeZone}{sampleData ? ' · demo sample' : ''}</p>
        {matchesWeek && <p>Captured at {new Date(capturedAt).toLocaleString()}{referenceAt - capturedAt > 10 * 60_000 ? ' · This snapshot is more than ten minutes old.' : ''}</p>}
        {weeklyEvidencePatterns && !matchesWeek && <p>Receipt snapshot is outside this week or uses a different time scope; receipt patterns are excluded.</p>}
      </div>
      <span className="weekly-insights__compare">Compared with {priorLabel}</span>
    </div>
    <p className="weekly-insights__scope"><Info size={14} aria-hidden="true" /> Uses independent session metadata and available tool receipts. It can show recorded activity; it cannot prove that work succeeded or that a skill was learned.</p>
    {loading && <p className="weekly-insights__status" role="status">Checking the version-pinned local archive…</p>}
    {!loading && result?.status === 'incomplete' && <p className="weekly-insights__status" role="status">{result.message}</p>}
    {!loading && result?.status === 'no-repeated-patterns' && <p className="weekly-insights__status" role="status">{result.message}</p>}
    {!loading && result?.status === 'observed' && <>
      <p className="weekly-insights__coverage" role="status">{result.observedSessions} independent sessions have recorded session activity in this window. Receipt patterns use individual message times. Repeated patterns require two or more distinct parent sessions.</p>
      <div className="weekly-insights__cards">{result.cards.map((card) => <InsightCard key={card.id} card={card} feedback={feedback[insightFeedbackKey(card.id, window.currentStart, sourceFilter)]} onFeedback={rate} />)}</div>
      <p className="weekly-insights__status">{result.message}</p>
    </>}
    {!loading && Boolean(result?.coverageWarnings.length) && <details className="weekly-insights__warnings">
      <summary>Source coverage needs attention ({result?.coverageWarnings.length})</summary>
      <ul>{result?.coverageWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
    </details>}
    {feedbackMessage && <p className="weekly-insights__feedback-message" role="status">{feedbackMessage}</p>}
  </section>;
}
