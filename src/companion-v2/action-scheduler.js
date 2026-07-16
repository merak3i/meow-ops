const SEQUENCES = Object.freeze({
  feed: [
    { pose: 'pounce', duration: 360, offset: -18, label: 'walking to bowl' },
    { pose: 'play', duration: 360, offset: -8, label: 'walking to bowl' },
    { pose: 'eat', duration: 950, offset: 0, label: 'eating' },
    { pose: 'sit', duration: 320, offset: 0, label: 'satisfied' },
  ],
  play: [{ pose: 'pounce', duration: 420, offset: -10, label: 'pouncing' }, { pose: 'play', duration: 760, offset: 8, label: 'playing' }],
  groom: [{ pose: 'groom', duration: 1500, offset: 0, label: 'grooming' }],
  sleep: [{ pose: 'curl', duration: 2200, offset: 0, label: 'sleeping' }],
  hungry: [{ pose: 'sit', tailState: 'sway', duration: 900, offset: -4, label: 'waiting by bowl' }, { pose: 'eat', tailState: 'flick', duration: 620, offset: -4, label: 'tail flick' }],
  session: [{ pose: 'desk', duration: 2400, offset: 16, label: 'pairing at desk' }],
});

export function enqueueAction(queue, action, now = Date.now()) {
  const sequence = SEQUENCES[action] ?? [];
  const pending = queue.filter((frame) => frame.end > now);
  let cursor = Math.max(now, pending.at(-1)?.end ?? now);
  return [...pending, ...sequence.map((frame) => {
    const next = { ...frame, action, start: cursor, end: cursor + frame.duration };
    cursor = next.end;
    return next;
  })];
}

export function frameAt(queue, now = Date.now()) {
  return queue.find((frame) => frame.start <= now && frame.end > now) ?? null;
}

export function scheduleBehavior({ hunger, hasLiveSession }) {
  if (hasLiveSession) return 'session';
  if (hunger < 40) return 'hungry';
  return null;
}
