export interface WeeklyInsightEvidence {
  sessionId: string;
  source: string;
  project: string;
  activityAt: string;
  rootSessionId?: string;
  recordId?: string;
  excerpt?: string;
}

export interface WeeklyInsightCard {
  id: string;
  title: string;
  what: string;
  why: string;
  action: string;
  sessionCount: number;
  previousCount: number | null;
  previousTotal: number | null;
  projects: string[];
  evidence: WeeklyInsightEvidence[];
  evidenceKind?: 'tool-receipt';
  comparison?: string;
  counterexamples?: WeeklyInsightEvidence[];
  limitations?: string[];
}

export interface WeeklyEvidencePatterns {
  schemaVersion: 1;
  archiveVersion: string | null;
  window: WeeklyInsightResult['window'];
  coverage: {
    status: 'available' | 'unavailable';
    limit: number;
    returnedRecords: number;
    totalRecords: number | null;
    acceptedRecords: number;
    excludedRecords: number;
    duplicateRecords: number;
    truncated: boolean;
    limitations: string[];
  };
  scopes: Record<string, { cards: WeeklyInsightCard[] }>;
}

export interface WeeklyInsightResult {
  status: 'incomplete' | 'observed' | 'no-repeated-patterns';
  window: {
    from: string;
    to: string;
    currentStart: string;
    previousStart: string;
    previousEnd: string;
    timeZone: string;
  };
  timeZone: string;
  sourceFilter?: string | null;
  coverageWarnings: string[];
  observedSessions: number;
  cards: WeeklyInsightCard[];
  message: string;
}

export function weeklyEvidenceWindow(now?: Date): WeeklyInsightResult['window'];
export function buildWeeklyInsights(sessions: unknown[], options?: {
  now?: Date;
  sourceFilter?: string | null;
  completeness?: 'archive' | 'preview' | 'unavailable';
  sourceCoverage?: Record<string, { state?: string } | null> | null;
  weeklyEvidencePatterns?: WeeklyEvidencePatterns | null;
  archiveVersion?: string | null;
}): WeeklyInsightResult;
