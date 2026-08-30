import { useMemo, useState } from 'react';
import { Check } from 'lucide-react';

import { Button, Card, EmptyState } from '../components/ui';
import { inferPractice, loadLearned, saveLearned } from '../lib/practice-map';
import type { Session } from '../types/session';
import './LearningQuest.css';

interface Props {
  sessions?: Session[];
}

export default function LearningQuest({ sessions = [] }: Props) {
  const concepts = useMemo(() => inferPractice(sessions), [sessions]);
  const [learned, setLearned] = useState(loadLearned);

  function toggle(id: string) {
    setLearned((current) => {
      const next = { ...current, [id]: !current[id] };
      saveLearned(next);
      return next;
    });
  }

  if (sessions.length === 0) {
    return (
      <EmptyState
        title="No sessions to mine yet"
        body="Learn reads the work you already did. Parse local sessions, then this list fills in."
        command="node sync/export-local.mjs"
      />
    );
  }

  if (concepts.length === 0) {
    return (
      <EmptyState
        title="Nothing obvious in this range"
        body="Widen the date filter or do more work. Concepts appear from tool mix, titles, and abandoned starts."
      />
    );
  }

  return (
    <div className="learn">
      <p className="learn-lead">
        Concepts you already practiced. Mark one when it clicks.
      </p>
      <ol className="learn-list" aria-label="Inferred concepts">
        {concepts.map((concept) => {
          const done = Boolean(learned[concept.id]);
          return (
            <li key={concept.id}>
              <Card>
                <div className="learn-card">
                  <div>
                    <h2 className="learn-name">{concept.name}</h2>
                    <p className="learn-kicker">Technical</p>
                    <p className="learn-technical">{concept.technical}</p>
                    <p className="learn-kicker">What you did</p>
                    <p className="learn-layman">{concept.layman}</p>
                    <p className="learn-source">{concept.source}</p>
                  </div>
                  <Button
                    variant={done ? 'primary' : 'default'}
                    onClick={() => toggle(concept.id)}
                  >
                    <Check size={14} aria-hidden="true" />
                    I get this
                  </Button>
                </div>
              </Card>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
