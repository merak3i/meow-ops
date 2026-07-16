export const LOOP_TO_ENTITY_ID = Object.freeze({
  'meow-ops-assistant': 'meow-ops-assistant',
  'meow-ops-dev': 'meow-ops-dev',
  'meow-ops-guardrails': 'meow-ops-guardrails',
  'meow-ops-llm-smoke-20260706': 'meow-ops-llm-smoke-20260706',
  'meow-ops-phase3-manual': 'meow-ops-phase3-manual',
  'meow-ops-prompts': 'meow-ops-prompts',
});

export function entityIdForLoopId(loopId) {
  return typeof loopId === 'string' ? LOOP_TO_ENTITY_ID[loopId] ?? null : null;
}

export function loopIdForEntityId(entityId) {
  return Object.entries(LOOP_TO_ENTITY_ID).find(([, mapped]) => mapped === entityId)?.[0] ?? null;
}
