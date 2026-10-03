import { useMemo, useState } from 'react';
import { Check } from 'lucide-react';

import { Button, Card, EmptyState } from '../components/ui';
import WeeklyInsights from '../components/WeeklyInsights';
import { inferPractice, loadLearned, saveLearned } from '../lib/practice-map';
import type { Session } from '../types/session';
import type { WeeklyEvidencePatterns } from '../lib/weekly-insights.mjs';
import './LearningQuest.css';

interface Props {
  sessions?: Session[];
  referenceAt: number;
  refreshKey: number;
  sourceCoverage?: Record<string, { state?: string }> | null | undefined;
  sampleData?: boolean;
  weeklyEvidencePatterns?: WeeklyEvidencePatterns | null;
}

export default function LearningQuest({ sessions = [], referenceAt, refreshKey, sourceCoverage, weeklyEvidencePatterns, sampleData = false }: Props) {
  const concepts = useMemo(() => inferPractice(sessions), [sessions]);
  const [learned, setLearned] = useState(loadLearned);

  function toggle(id: string) {
    setLearned((current) => {
      const next = { ...current, [id]: !current[id] };
      saveLearned(next);
      return next;
    });
  }

  return (
    <div className="learn">
      <WeeklyInsights sourceFilter={null} referenceAt={referenceAt} refreshKey={refreshKey} sourceCoverage={sourceCoverage} weeklyEvidencePatterns={weeklyEvidencePatterns || null} sampleData={sampleData} />
      {sessions.length === 0 ? <EmptyState
        title="No sessions in this range"
        body="The weekly evidence panel checks the full local archive. These practice signals use the selected date range."
        command="node sync/export-local.mjs"
      /> : concepts.length === 0 ? <EmptyState
        title="No possible practice signals in this range"
        body="The selected session metadata did not match a supported signal. This does not mean no learning happened."
      /> : <>
      <p className="learn-lead">
        Possible practice signals inferred from session metadata. They show what appeared in the logs, not what you understood or successfully shipped.
      </p>
      <ol className="learn-list" aria-label="Possible practice signals">
        {concepts.map((concept) => {
          const done = Boolean(learned[concept.id]);
          return (
            <li key={concept.id}>
              <Card>
                <div className="learn-card">
                  <div>
                    <h2 className="learn-name">{concept.name}</h2>
                    <p className="learn-kicker">Possible signal</p>
                    <p className="learn-technical">{concept.technical}</p>
                    <p className="learn-kicker">What the session metadata suggests</p>
                    <p className="learn-layman">{concept.layman}</p>
                    <p className="learn-source">{concept.source}</p>
                    <details>
                      <summary>Supporting sessions ({concept.evidence.length}{concept.evidence.length < concept.sessionCount ? ` of ${concept.sessionCount}` : ''})</summary>
                      <ul>{concept.evidence.map((item) => <li key={`${item.source}:${item.sessionId}`}>{item.project} · {item.source} · <code>{item.sessionId}</code></li>)}</ul>
                    </details>
                  </div>
                  <Button
                    variant={done ? 'primary' : 'default'}
                    aria-pressed={done}
                    onClick={() => toggle(concept.id)}
                  >
                    <Check size={14} aria-hidden="true" />
                    {done ? 'Acknowledged' : 'I recognize this'}
                  </Button>
                </div>
              </Card>
            </li>
          );
        })}
      </ol>
      </>}
    </div>
  );
}
