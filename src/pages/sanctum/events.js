export const EVENT_DURATIONS = Object.freeze({ E1: 1150, E2: 920, E3: 2600, E4: 900, E5: 620 });

export function snapshotSessions(sessions, selectedId, totalCost, contextId = null) {
  return {
    sessions: new Map(sessions.map((session) => [session.session_id, Boolean(session.is_ghost)])),
    selectedId: selectedId ?? null,
    totalCost: Number.isFinite(totalCost) ? totalCost : 0,
    contextId,
  };
}

export function diffEventSnapshots(previous, next) {
  if (!previous || previous.contextId !== next.contextId) return [];
  const beats = [];
  for (const [id, ghost] of next.sessions) {
    if (!previous.sessions.has(id)) {
      beats.push({ type: 'E1', sessionId: id });
      if (ghost) beats.push({ type: 'E3', sessionId: id });
    }
    else if (!previous.sessions.get(id) && ghost) beats.push({ type: 'E3', sessionId: id });
  }
  for (const [id, ghost] of previous.sessions) {
    if (!ghost && !next.sessions.has(id)) beats.push({ type: 'E2', sessionId: id });
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
