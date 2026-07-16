export const LOOP_TO_ENTITY_ID: Readonly<Record<string, string>>;
export function entityIdForLoopId(loopId: string): string | null;
export function loopIdForEntityId(entityId: string): string | null;
