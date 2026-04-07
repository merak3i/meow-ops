export const PHASES = { WORK: 'work', SHORT_BREAK: 'short_break', LONG_BREAK: 'long_break' };

export const CAT_BREEDS = {
  persian:      { label: 'Persian',        rarity: 'common',    unlock: 0,   emoji: '🐱', colors: { body: '#f5f5f5', accent: '#e0d5c8', eyes: '#6fa8dc' } },
  siamese:      { label: 'Siamese',        rarity: 'common',    unlock: 0,   emoji: '😺', colors: { body: '#f4e8d0', accent: '#8b6f47', eyes: '#4a86c8' } },
  tabby:        { label: 'Tabby',          rarity: 'common',    unlock: 0,   emoji: '😸', colors: { body: '#e8943a', accent: '#c77420', eyes: '#5ca55c' } },
  tuxedo:       { label: 'Tuxedo',         rarity: 'uncommon',  unlock: 10,  emoji: '🐈‍⬛', colors: { body: '#2a2a2a', accent: '#f0f0f0', eyes: '#e8c840' } },
  calico:       { label: 'Calico',         rarity: 'uncommon',  unlock: 25,  emoji: '🐈', colors: { body: '#f5f0e0', accent: '#d4732a', eyes: '#68a868' } },
  maineCoon:    { label: 'Maine Coon',     rarity: 'rare',      unlock: 50,  emoji: '🦁', colors: { body: '#a0764a', accent: '#7a5c38', eyes: '#b8860b' } },
  scottishFold: { label: 'Scottish Fold',  rarity: 'rare',      unlock: 100, emoji: '😽', colors: { body: '#c4b09a', accent: '#9e8b78', eyes: '#7b9ec4' } },
  sphynx:       { label: 'Sphynx',         rarity: 'legendary', unlock: 200, emoji: '🙀', colors: { body: '#d4b8a0', accent: '#c5a080', eyes: '#c44040' } },
};

export const SHINY_VARIANTS = {
  golden:    { label: 'Golden',    glow: '#ffd700', filter: 'sepia(0.4) saturate(2.5) brightness(1.2)', streakReq: 3 },
  prismatic: { label: 'Prismatic', glow: '#ff69b4', filter: 'hue-rotate(45deg) saturate(1.5) brightness(1.1)', streakReq: 7 },
  celestial: { label: 'Celestial', glow: '#00f5ff', filter: 'hue-rotate(180deg) saturate(2) brightness(1.3)', streakReq: 14 },
  void:      { label: 'Void',     glow: '#8b00ff', filter: 'invert(0.8) hue-rotate(270deg) saturate(3)', streakReq: 30 },
};

const RARITY_WEIGHTS = { common: 50, uncommon: 30, rare: 15, legendary: 5 };

const SETTINGS_KEY = 'meow-pomo-settings';
const HISTORY_KEY = 'meow-pomo-history';
const SHINY_KEY = 'meow-pomo-shinies';

const DEFAULT_SETTINGS = {
  workMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  sessionsBeforeLong: 4,
  autoStart: false,
  focusMode: true,
  strictMode: false,
  audioEnabled: true,
  audioVolume: 0.5,
  gracePeriodSeconds: 30,
};

export function getSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY));
    return { ...DEFAULT_SETTINGS, ...saved };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(partial) {
  const current = getSettings();
  const updated = { ...current, ...partial };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));
  return updated;
}

export function getHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
  } catch {
    return [];
  }
}

export function addSession(session) {
  const history = getHistory();
  history.push({ ...session, id: crypto.randomUUID(), savedAt: new Date().toISOString() });
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-500)));
  return history;
}

export function getShinyCollection() {
  try {
    return JSON.parse(localStorage.getItem(SHINY_KEY)) || [];
  } catch {
    return [];
  }
}

export function addShiny(shiny) {
  const collection = getShinyCollection();
  collection.push({ ...shiny, id: crypto.randomUUID(), earnedAt: new Date().toISOString() });
  localStorage.setItem(SHINY_KEY, JSON.stringify(collection));
  return collection;
}

export function getTodayStats() {
  const history = getHistory();
  const today = new Date().toISOString().slice(0, 10);
  const todaySessions = history.filter((s) => s.startedAt?.slice(0, 10) === today);
  const completed = todaySessions.filter((s) => s.status === 'completed');

  const streak = computeStreak(history);
  const totalFocusMinutes = completed.reduce((a, s) => a + (s.duration || 0), 0) / 60;

  return {
    pomodorosToday: completed.length,
    totalToday: todaySessions.length,
    streak,
    totalFocusMinutes: Math.round(totalFocusMinutes),
    totalCompleted: history.filter((s) => s.status === 'completed').length,
  };
}

function computeStreak(history) {
  const completed = history.filter((s) => s.status === 'completed');
  if (completed.length === 0) return 0;

  const days = new Set(completed.map((s) => s.startedAt?.slice(0, 10)).filter(Boolean));
  const sorted = [...days].sort().reverse();

  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  if (!sorted.includes(today) && !sorted.includes(yesterday)) return 0;

  let streak = 0;
  let checkDate = new Date(sorted.includes(today) ? today : yesterday);

  while (days.has(checkDate.toISOString().slice(0, 10))) {
    streak++;
    checkDate = new Date(checkDate.getTime() - 86400000);
  }
  return streak;
}

export function getUnlockedBreeds(totalCompleted) {
  return Object.entries(CAT_BREEDS)
    .filter(([, b]) => b.unlock <= totalCompleted)
    .map(([key, b]) => ({ key, ...b }));
}

export function pickRandomBreed(totalCompleted) {
  const unlocked = getUnlockedBreeds(totalCompleted);
  if (unlocked.length === 0) return { key: 'persian', ...CAT_BREEDS.persian };

  const weighted = unlocked.map((b) => ({ ...b, weight: RARITY_WEIGHTS[b.rarity] || 10 }));
  const totalWeight = weighted.reduce((a, b) => a + b.weight, 0);
  let roll = Math.random() * totalWeight;

  for (const b of weighted) {
    roll -= b.weight;
    if (roll <= 0) return b;
  }
  return weighted[0];
}

export function checkShinyDrop(streak) {
  const eligible = Object.entries(SHINY_VARIANTS)
    .filter(([, v]) => streak >= v.streakReq)
    .map(([key, v]) => ({ key, ...v }));

  if (eligible.length === 0) return null;

  const best = eligible[eligible.length - 1];
  const dropChance = Math.min(0.15 + (streak * 0.01), 0.4);

  if (Math.random() < dropChance) {
    const breed = pickRandomBreed(9999);
    return { variant: best.key, breed: breed.key, ...best, breedLabel: breed.label };
  }
  return null;
}

let audioContext = null;

export function createChimeSound(volume = 0.5) {
  return {
    play() {
      try {
        if (!audioContext) audioContext = new AudioContext();
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        osc.connect(gain);
        gain.connect(audioContext.destination);
        osc.frequency.setValueAtTime(523.25, audioContext.currentTime);
        osc.frequency.setValueAtTime(659.25, audioContext.currentTime + 0.15);
        osc.frequency.setValueAtTime(783.99, audioContext.currentTime + 0.3);
        gain.gain.setValueAtTime(volume * 0.3, audioContext.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.8);
        osc.start(audioContext.currentTime);
        osc.stop(audioContext.currentTime + 0.8);
      } catch { /* audio not supported */ }
    },
  };
}
