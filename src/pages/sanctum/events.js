export const EVENT_DURATIONS = Object.freeze({ E1: 1150, E2: 920, E3: 2600, E4: 900, E5: 620 });
export const LIVE_SESSION_WINDOW_MS = 120_000;

export function snapshotSessions(sessions, selectedId, totalCost, contextId = null, now = Date.now()) {
  return {
    sessions: new Map(sessions.map((session) => {
      const endedAt = Date.parse(session.ended_at ?? '');
      const age = now - endedAt;
      return [session.session_id, {
        ghost: Boolean(session.is_ghost),
        live: Number.isFinite(age) && age >= 0 && age < LIVE_SESSION_WINDOW_MS,
      }];
    })),
    selectedId: selectedId ?? null,
    totalCost: Number.isFinite(totalCost) ? totalCost : 0,
    contextId,
  };
}

export function diffEventSnapshots(previous, next) {
  if (!previous || previous.contextId !== next.contextId) return [];
  const beats = [];
  for (const [id, state] of next.sessions) {
    const oldState = previous.sessions.get(id);
    if (!oldState) {
      beats.push({ type: 'E1', sessionId: id });
      if (state.ghost) beats.push({ type: 'E3', sessionId: id });
      continue;
    }
    if (!oldState.ghost && state.ghost) beats.push({ type: 'E3', sessionId: id });
    if (oldState.live && !state.live) beats.push({ type: 'E2', sessionId: id });
  }
  for (const [id, state] of previous.sessions) {
    if (state.live && !next.sessions.has(id)) beats.push({ type: 'E2', sessionId: id });
  }
  const oldStep = Math.floor(previous.totalCost);
  const newStep = Math.floor(next.totalCost);
  if (newStep > oldStep) beats.push({ type: 'E4', costStep: newStep });
  if (next.selectedId && next.selectedId !== previous.selectedId) {
    beats.push({ type: 'E5', sessionId: next.selectedId });
  }
  const order = { E1: 1, E2: 2, E3: 3, E4: 4, E5: 5 };
  return beats.sort((a, b) => order[a.type] - order[b.type]);
}
