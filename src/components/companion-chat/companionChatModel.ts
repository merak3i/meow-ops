import type { SyncStatus } from '../../lib/queries';

export type ChatSource = 'local' | 'deepseek';
export type KnowledgeGate = 'known_known' | 'known_unknown' | 'unknown_known' | 'unknown_unknown';

export type ChatEvidence = { kind: string; ref: string; detail: string };
export type LearningTarget = { project_id?: string; project_name?: string; field: string };

export type ChatMessage = {
  id: string;
  role: 'assistant' | 'user';
  text: string;
  createdAt: string;
  source?: ChatSource;
  gate?: KnowledgeGate;
  confidence?: number;
  evidence?: ChatEvidence[];
  unknowns?: string[];
  nextQuestion?: string;
  learning?: LearningTarget;
  claimId?: string;
  claimStatus?: 'inferred' | 'owner_confirmed' | 'stale' | 'contradicted';
  feedbackEligible?: boolean;
  feedbackRecorded?: boolean;
  feedbackStatus?: 'saved' | 'error';
  soulRevision?: number;
  projectSoul?: { project_id: string; project_name: string };
};

export const STARTER_PROMPTS = [
  'What changed today?',
  'Which project received the most time this week?',
  'Is sync healthy?',
  'What should I fix next?',
  'Prepare a repair prompt',
] as const;

const STORAGE_KEY = 'meow-ops-companion-thread-v1';

export function newMessage(
  role: ChatMessage['role'],
  text: string,
  source?: ChatSource,
  metadata: Partial<Omit<ChatMessage, 'id' | 'role' | 'text' | 'createdAt' | 'source'>> = {},
): ChatMessage {
  return {
    id: `${role}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    role,
    text,
    createdAt: new Date().toISOString(),
    ...(source ? { source } : {}),
    ...metadata,
  };
}

export function welcomeMessage(pageLabel = 'Meow Ops'): ChatMessage {
  return newMessage(
    'assistant',
    `I’m your local operations copilot. I can explain ${pageLabel}, session sync, daily changes, and the next reviewable action. I’ll use deterministic local evidence first and label DeepSeek when it helps with an unknown.`,
    'local',
  );
}

export function loadThread(pageLabel?: string): ChatMessage[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.filter((message) => (
        message && typeof message.id === 'string'
        && (message.role === 'assistant' || message.role === 'user')
        && typeof message.text === 'string'
      )).slice(-30);
    }
  } catch { /* localStorage unavailable or stale */ }
  return [welcomeMessage(pageLabel)];
}

export function saveThread(messages: ChatMessage[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-30))); } catch { /* quota */ }
}

export function clearThread(pageLabel?: string) {
  const next = [welcomeMessage(pageLabel)];
  saveThread(next);
  return next;
}

export function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function syncNudge(status: SyncStatus): string | null {
  if (status?.state === 'failed') {
    return `Sync stopped at ${status.failure?.stage || status.phase || 'an unknown phase'}. ${status.failure?.summary || 'Open Sync Activity for the recorded failure.'}`;
  }
  if (status?.state === 'partial') return status.warning?.summary || 'Sessions synced, but an optional follow-up needs attention.';
  const mtime = Number(status?.artifact?.mtime || status?.mtime);
  if (mtime && Date.now() - mtime > 26 * 60 * 60 * 1000) return 'Session data is more than a day old. Run the daily sync before relying on today’s picture.';
  return null;
}
