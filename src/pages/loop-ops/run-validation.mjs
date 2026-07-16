const RUN_STATES = ['planned', 'running', 'passed', 'failed', 'stopped'];

export function isValidLoopRun(value) {
  if (typeof value !== 'object' || value === null) return false;
  const run = value;
  return typeof run.id === 'string'
    && typeof run.goal === 'string'
    && RUN_STATES.includes(run.state)
    && typeof run.startedAt === 'string'
    && Array.isArray(run.entityIds)
    && Array.isArray(run.sessionIds)
    && Array.isArray(run.artifacts)
    && Array.isArray(run.verified)
    && Array.isArray(run.notVerified);
}
