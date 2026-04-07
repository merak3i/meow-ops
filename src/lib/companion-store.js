// Companion store — localStorage-backed Tamagotchi state machine.
//
// Schema is documented in plans/companion. Single key: meow-companion-state.
// Reads are eager (decay applied on every read). Writes are immediate.
// Subscribers are notified via the listeners Set so React components can
// re-render after mutations.

import { COMPANION_FOODS } from './companion-foods';
import { COMPANION_BREEDS } from './companion-breeds';
import { COMPANION_ACCESSORIES, sumPassives } from './companion-accessories';
import { unlockedRooms } from './companion-rooms';
import {
  rewardForSession,
  rewardForPomodoro,
  rollStreakBonus,
  growthFromSession,
  shineFromSession,
} from './companion-rewards';

const STORAGE_KEY = 'meow-companion-state';
const VERSION = 1;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const RUNAWAY_DAYS = 14;

// Decay rates (per hour)
const DECAY = {
  hunger: 1,
  energy: 0.5,
  happiness: 0.3,
  health: 0,        // health is conditional, handled below
};

// ──────────────── Helpers ────────────────

function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'cat-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function clamp(n, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, n));
}

function nowISO() {
  return new Date().toISOString();
}

function emptyState() {
  return {
    version: VERSION,
    cat: null,
    claimedSessionIds: [],
    claimedPomodoroIds: [],
    memorial: [],
  };
}

// ──────────────── Persistence ────────────────

let cached = null;
const listeners = new Set();

function load() {
  if (cached) return cached;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      cached = emptyState();
      return cached;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== VERSION) {
      cached = emptyState();
      return cached;
    }
    // Backfill arrays in case the user manually edited storage
    parsed.claimedSessionIds = parsed.claimedSessionIds || [];
    parsed.claimedPomodoroIds = parsed.claimedPomodoroIds || [];
    parsed.memorial = parsed.memorial || [];
    // Strip any legacy accessories whose keys no longer exist
    if (parsed.cat) {
      if (Array.isArray(parsed.cat.inventory?.accessories)) {
        parsed.cat.inventory.accessories = parsed.cat.inventory.accessories.filter(
          (k) => COMPANION_ACCESSORIES[k]
        );
      }
      if (Array.isArray(parsed.cat.appearance?.equippedAccessories)) {
        parsed.cat.appearance.equippedAccessories = parsed.cat.appearance.equippedAccessories.filter(
          (k) => COMPANION_ACCESSORIES[k]
        );
      }
    }
    cached = parsed;
    return cached;
  } catch {
    cached = emptyState();
    return cached;
  }
}

function persist({ silent = false } = {}) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cached));
  } catch {
    // localStorage full or unavailable — silent fail, state stays in memory
  }
  if (silent) return;
  listeners.forEach((fn) => {
    try { fn(cached); } catch {}
  });
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ──────────────── Decay ────────────────

function applyDecay(cat) {
  if (!cat || cat.status === 'lost') return cat;
  const now = Date.now();
  const last = new Date(cat.lastSeenAt || now).getTime();
  const hours = Math.max(0, (now - last) / HOUR_MS);
  if (hours < 0.01) return cat;

  const equipped = cat.appearance?.equippedAccessories || [];
  const passives = sumPassives(equipped);

  const next = { ...cat, stats: { ...cat.stats } };
  next.stats.hunger = clamp(cat.stats.hunger + (passives.hunger - DECAY.hunger) * hours);
  next.stats.energy = clamp(cat.stats.energy + (passives.energy - DECAY.energy) * hours);
  next.stats.happiness = clamp(cat.stats.happiness + (passives.happiness - DECAY.happiness) * hours);

  // Health: drops 0.2/hr while hunger or happiness < 30, recovers 0.1/hr if both > 60
  // Accessory passive is added to either branch.
  if (next.stats.hunger < 30 || next.stats.happiness < 30) {
    next.stats.health = clamp(cat.stats.health + (passives.health - 0.2) * hours);
  } else if (next.stats.hunger > 60 && next.stats.happiness > 60) {
    next.stats.health = clamp(cat.stats.health + (passives.health + 0.1) * hours);
  } else {
    next.stats.health = clamp(cat.stats.health + passives.health * hours);
  }

  // Shine passive (no decay but accessories grant gain)
  next.stats.shine = clamp(cat.stats.shine + passives.shine * hours);

  next.lastSeenAt = new Date(now).toISOString();
  return next;
}

function checkRunaway(cat) {
  if (!cat || cat.status === 'lost') return cat;
  const last = new Date(cat.lastFedAt || cat.adoptedAt || Date.now()).getTime();
  const days = (Date.now() - last) / DAY_MS;
  if (days >= RUNAWAY_DAYS) {
    return { ...cat, status: 'lost' };
  }
  return cat;
}

function deriveLifeStage(xp) {
  if (xp >= 1500) return 'elder';
  if (xp >= 700) return 'adult';
  if (xp >= 300) return 'youngAdult';
  if (xp >= 100) return 'adolescent';
  return 'kitten';
}

function deriveSizeMultiplier(xp) {
  if (xp >= 1500) return 1.05;
  if (xp >= 700) return 1.0;
  if (xp >= 300) return 0.85;
  if (xp >= 100) return 0.7;
  return 0.55;
}

function deriveFurQuality(stats) {
  if (stats.shine >= 60) return 'glowing';
  if (stats.health > 80 && stats.happiness > 80) return 'shiny';
  if (stats.hunger < 25 || stats.health < 25) return 'dull';
  return 'normal';
}

function deriveWeight(stats) {
  if (stats.hunger < 20) return 'thin';
  if (stats.hunger > 90 && stats.energy < 30) return 'plump';
  return 'normal';
}

function deriveMood(stats) {
  if (stats.shine >= 60 && stats.happiness > 80) return 'glowing';
  const min = Math.min(stats.hunger, stats.energy, stats.happiness, stats.health);
  if (min < 10) return 'critical';
  if (min < 30) return 'distressed';
  if (min < 50) return 'concerned';
  return 'healthy';
}

function refreshDerived(cat) {
  if (!cat) return cat;
  const lifeStage = deriveLifeStage(cat.growthXP);
  const sizeMultiplier = deriveSizeMultiplier(cat.growthXP);
  const appearance = {
    ...cat.appearance,
    sizeMultiplier,
    weight: deriveWeight(cat.stats),
    furQuality: deriveFurQuality(cat.stats),
  };
  const days = Math.floor((Date.now() - new Date(cat.adoptedAt).getTime()) / DAY_MS);
  const inventory = {
    ...cat.inventory,
    unlockedRooms: unlockedRooms(days),
  };
  return { ...cat, lifeStage, appearance, inventory };
}

// ──────────────── Public reads ────────────────

export function getState() {
  const state = load();
  if (state.cat && state.cat.status !== 'lost') {
    state.cat = applyDecay(state.cat);
    state.cat = checkRunaway(state.cat);
    state.cat = refreshDerived(state.cat);
    cached = state;
    persist({ silent: true });
  }
  return cached;
}

export function getCat() {
  return getState().cat;
}

export function hasCat() {
  const c = getCat();
  return !!(c && c.status === 'alive');
}

export function getMemorial() {
  return getState().memorial;
}

export function getMood(cat) {
  if (!cat) return 'healthy';
  return deriveMood(cat.stats);
}

// ──────────────── Mutations ────────────────

export function adoptKitten(breedKey, name) {
  const breed = COMPANION_BREEDS[breedKey];
  if (!breed) throw new Error('Unknown breed: ' + breedKey);
  const now = nowISO();
  const cat = {
    id: uuid(),
    breed: breedKey,
    name: (name || 'Kitten').trim().slice(0, 24) || 'Kitten',
    adoptedAt: now,
    lastSeenAt: now,
    lastFedAt: now,
    lastPlayedAt: now,
    lastGroomedAt: now,
    stats: { hunger: 100, energy: 100, happiness: 100, health: 100, shine: 0 },
    growthXP: 0,
    lifeStage: 'kitten',
    status: 'alive',
    appearance: {
      weight: 'normal',
      furQuality: 'normal',
      sizeMultiplier: 0.55,
      equippedAccessories: [],
      shinyVariant: null,
    },
    room: { tier: 1, key: 'corner_mat' },
    inventory: {
      foods: { kibble: 5, tuna_can: 2 },
      accessories: [],
      unlockedRooms: ['corner_mat'],
    },
    streakDays: 0,
  };
  const state = load();
  state.cat = refreshDerived(cat);
  cached = state;
  persist();
  return cached.cat;
}

export function feed(foodKey) {
  const food = COMPANION_FOODS[foodKey];
  const state = load();
  if (!state.cat || !food) return false;
  const inv = state.cat.inventory.foods || {};
  if (!inv[foodKey] || inv[foodKey] <= 0) return false;

  const next = { ...state.cat, stats: { ...state.cat.stats } };
  const e = food.effect || {};
  if (e.hunger) next.stats.hunger = clamp(next.stats.hunger + e.hunger);
  if (e.energy) next.stats.energy = clamp(next.stats.energy + e.energy);
  if (e.happiness) next.stats.happiness = clamp(next.stats.happiness + e.happiness);
  if (e.health) next.stats.health = clamp(next.stats.health + e.health);
  if (e.shine) next.stats.shine = clamp(next.stats.shine + e.shine);
  if (e.growthXP) next.growthXP = (next.growthXP || 0) + e.growthXP;

  next.inventory = {
    ...next.inventory,
    foods: { ...inv, [foodKey]: inv[foodKey] - 1 },
  };
  next.lastFedAt = nowISO();
  next.lastSeenAt = next.lastFedAt;
  state.cat = refreshDerived(next);
  cached = state;
  persist();
  return true;
}

export function play() {
  const state = load();
  if (!state.cat) return false;
  const next = { ...state.cat, stats: { ...state.cat.stats } };
  next.stats.happiness = clamp(next.stats.happiness + 15);
  next.stats.energy = clamp(next.stats.energy - 5);
  next.growthXP = (next.growthXP || 0) + 2;
  next.lastPlayedAt = nowISO();
  next.lastSeenAt = next.lastPlayedAt;
  state.cat = refreshDerived(next);
  cached = state;
  persist();
  return true;
}

export function groom() {
  const state = load();
  if (!state.cat) return false;
  const next = { ...state.cat, stats: { ...state.cat.stats } };
  next.stats.happiness = clamp(next.stats.happiness + 8);
  next.stats.shine = clamp(next.stats.shine + 1);
  next.lastGroomedAt = nowISO();
  next.lastSeenAt = next.lastGroomedAt;
  state.cat = refreshDerived(next);
  cached = state;
  persist();
  return true;
}

export function sleep() {
  const state = load();
  if (!state.cat) return false;
  const next = { ...state.cat, stats: { ...state.cat.stats } };
  next.stats.energy = clamp(next.stats.energy + 30);
  next.stats.hunger = clamp(next.stats.hunger - 5);
  next.lastSeenAt = nowISO();
  state.cat = refreshDerived(next);
  cached = state;
  persist();
  return true;
}

export function purchaseAccessory(key) {
  const acc = COMPANION_ACCESSORIES[key];
  const state = load();
  if (!state.cat || !acc) return false;
  if (state.cat.inventory.accessories.includes(key)) return false;
  if (state.cat.stats.shine < acc.cost) return false;
  const next = { ...state.cat, stats: { ...state.cat.stats } };
  next.stats.shine = clamp(next.stats.shine - acc.cost);
  next.inventory = {
    ...next.inventory,
    accessories: [...next.inventory.accessories, key],
  };
  next.lastSeenAt = nowISO();
  state.cat = refreshDerived(next);
  cached = state;
  persist();
  return true;
}

export function toggleAccessory(key) {
  const state = load();
  if (!state.cat) return false;
  if (!state.cat.inventory.accessories.includes(key)) return false;
  const equipped = state.cat.appearance.equippedAccessories || [];
  const next = { ...state.cat };
  const isOn = equipped.includes(key);
  next.appearance = {
    ...next.appearance,
    equippedAccessories: isOn ? equipped.filter((k) => k !== key) : [...equipped, key],
  };
  next.lastSeenAt = nowISO();
  state.cat = refreshDerived(next);
  cached = state;
  persist();
  return true;
}

export function setRoom(roomKey) {
  const state = load();
  if (!state.cat) return false;
  if (!state.cat.inventory.unlockedRooms.includes(roomKey)) return false;
  const next = { ...state.cat, room: { key: roomKey, tier: 0 } };
  next.lastSeenAt = nowISO();
  state.cat = refreshDerived(next);
  cached = state;
  persist();
  return true;
}

// Convert sessions to food. Idempotent — already-claimed sessions are skipped.
export function claimSessionRewards(sessions) {
  if (!Array.isArray(sessions) || sessions.length === 0) return { awarded: {}, growth: 0, shine: 0 };
  const state = load();
  if (!state.cat) return { awarded: {}, growth: 0, shine: 0 };

  const claimedSet = new Set(state.claimedSessionIds);
  const awarded = {};
  let growthGained = 0;
  let shineGained = 0;

  for (const s of sessions) {
    const id = s.session_id;
    if (!id || claimedSet.has(id)) continue;
    const drops = rewardForSession(s);
    drops.forEach((key) => {
      awarded[key] = (awarded[key] || 0) + 1;
    });
    growthGained += growthFromSession(s);
    shineGained += shineFromSession(s);
    claimedSet.add(id);
  }

  if (Object.keys(awarded).length === 0 && growthGained === 0 && shineGained === 0) {
    // Still persist the claimed set so we don't re-evaluate empty sessions
    if (claimedSet.size !== state.claimedSessionIds.length) {
      state.claimedSessionIds = Array.from(claimedSet);
      cached = state;
      persist();
    }
    return { awarded: {}, growth: 0, shine: 0 };
  }

  const next = { ...state.cat, stats: { ...state.cat.stats } };
  const foods = { ...next.inventory.foods };
  for (const [key, n] of Object.entries(awarded)) {
    foods[key] = (foods[key] || 0) + n;
  }
  next.inventory = { ...next.inventory, foods };
  next.growthXP = (next.growthXP || 0) + growthGained;
  next.stats.shine = clamp(next.stats.shine + shineGained);
  state.cat = refreshDerived(next);
  state.claimedSessionIds = Array.from(claimedSet);
  cached = state;
  persist();
  return { awarded, growth: growthGained, shine: shineGained };
}

// Convert pomodoro history entries to treats. Idempotent.
export function claimPomodoroRewards(history) {
  if (!Array.isArray(history) || history.length === 0) return { awarded: {} };
  const state = load();
  if (!state.cat) return { awarded: {} };
  const claimed = new Set(state.claimedPomodoroIds);
  const awarded = {};
  for (const h of history) {
    const id = h.id;
    if (!id || claimed.has(id)) continue;
    const drops = rewardForPomodoro(h);
    drops.forEach((key) => {
      awarded[key] = (awarded[key] || 0) + 1;
    });
    claimed.add(id);
  }
  if (Object.keys(awarded).length === 0) {
    state.claimedPomodoroIds = Array.from(claimed);
    cached = state;
    persist();
    return { awarded };
  }
  const next = { ...state.cat };
  const foods = { ...next.inventory.foods };
  for (const [key, n] of Object.entries(awarded)) {
    foods[key] = (foods[key] || 0) + n;
  }
  next.inventory = { ...next.inventory, foods };
  next.growthXP = (next.growthXP || 0) + Object.values(awarded).reduce((a, b) => a + b, 0) * 5;
  state.cat = refreshDerived(next);
  state.claimedPomodoroIds = Array.from(claimed);
  cached = state;
  persist();
  return { awarded };
}

// Roll streak bonus once per day. Caller passes today's streak count.
export function rollDailyStreakBonus(streakDays) {
  const state = load();
  if (!state.cat) return null;
  const today = new Date().toISOString().slice(0, 10);
  if (state.cat.lastStreakRollDate === today) return null;
  const drop = rollStreakBonus(streakDays);
  const next = { ...state.cat, lastStreakRollDate: today, streakDays };
  if (drop) {
    const foods = { ...next.inventory.foods };
    foods[drop] = (foods[drop] || 0) + 1;
    next.inventory = { ...next.inventory, foods };
  }
  state.cat = refreshDerived(next);
  cached = state;
  persist();
  return drop;
}

// Move the cat to memorial and clear active companion.
export function bury() {
  const state = load();
  if (!state.cat) return;
  const c = state.cat;
  const adopted = new Date(c.adoptedAt).getTime();
  const last = new Date(c.lastFedAt || c.adoptedAt).getTime();
  state.memorial.push({
    id: c.id,
    name: c.name,
    breed: c.breed,
    adoptedAt: c.adoptedAt,
    lostAt: new Date(last + RUNAWAY_DAYS * DAY_MS).toISOString(),
    daysLived: Math.max(1, Math.floor((last - adopted) / DAY_MS)),
    finalLifeStage: c.lifeStage,
  });
  state.cat = null;
  state.claimedSessionIds = [];
  state.claimedPomodoroIds = [];
  cached = state;
  persist();
}

// Test helper — only used in dev tools to fast-forward time.
export function devSetLastFed(daysAgo) {
  const state = load();
  if (!state.cat) return;
  const t = Date.now() - daysAgo * DAY_MS;
  state.cat.lastFedAt = new Date(t).toISOString();
  state.cat.lastSeenAt = new Date(t).toISOString();
  cached = state;
  persist();
}

export const RUNAWAY_THRESHOLD_DAYS = RUNAWAY_DAYS;
