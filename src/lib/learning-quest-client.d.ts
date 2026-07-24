import type { LearningQuestSnapshot } from './loop-api';

export interface LearningQuestMutationFailure {
  ok?: false;
  status?: number;
  error?: string;
}

export function learningQuestMutationMessage(
  result: LearningQuestSnapshot | LearningQuestMutationFailure | null,
): string;
export function learningQuestHelperMessage(snapshot: LearningQuestSnapshot | null): string;
