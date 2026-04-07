// Convert Claude Code sessions and Pomodoro completions into food rewards.
// Each session/pomodoro is claimed exactly once via claimedSessionIds /
// claimedPomodoroIds Sets in companion-store.

export function rewardForSession(session) {
  if (!session) return [];
  if (session.is_ghost) return [];

  const dur = session.duration_seconds || 0;
  const tools = session.tools ? Object.keys(session.tools).length : 0;
  const isOpus = (session.model || '').toLowerCase().includes('opus');
  const drops = [];

  if (dur < 5 * 60) {
    return [];
  }

  if (dur < 30 * 60) {
    drops.push('kibble');
    if (tools >= 2) drops.push('tuna_can');
    return drops;
  }

  if (dur < 60 * 60) {
    if (tools >= 2) drops.push('wet_food_bowl');
    else drops.push('tuna_can');
    return drops;
  }

  if (dur < 120 * 60) {
    if (tools >= 4) {
      drops.push('chicken_broth');
      drops.push('gourmet_salmon');
    } else {
      drops.push('wet_food_bowl');
    }
    return drops;
  }

  // dur >= 120min
  if (tools >= 5 && isOpus) {
    drops.push('roast_chicken');
  } else {
    drops.push('gourmet_salmon');
  }
  return drops;
}

export function rewardForPomodoro(pomodoroEntry) {
  if (!pomodoroEntry) return [];
  if (pomodoroEntry.status !== 'completed') return [];
  if (pomodoroEntry.phase && pomodoroEntry.phase !== 'work') return [];
  return ['catnip_leaf'];
}

// Streak-based bonus rolls. Returns 0 or 1 drop name.
export function rollStreakBonus(streakDays) {
  if (streakDays >= 14 && Math.random() < 0.05) return 'stardust_salmon';
  if (streakDays >= 7 && Math.random() < 0.15) return 'golden_fish';
  return null;
}

export function growthFromSession(session) {
  if (!session || session.is_ghost) return 0;
  const dur = session.duration_seconds || 0;
  if (dur < 5 * 60) return 0;
  if (dur < 30 * 60) return 5;
  if (dur < 60 * 60) return 12;
  if (dur < 120 * 60) return 25;
  return 40;
}

export function shineFromSession(session) {
  if (!session || session.is_ghost) return 0;
  const tools = session.tools ? Object.keys(session.tools).length : 0;
  if (tools >= 5) return 1;
  return 0;
}
