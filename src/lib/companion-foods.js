// Food catalogue for the Companion. Each food has tier, label, icon, effect.
// Effects mutate the cat's stats when fed (clamped 0..100 by the store).
// XP/shine effects are additive (XP is unbounded, shine clamped 0..100).

export const COMPANION_FOODS = {
  // Tier 1 — daily essentials
  kibble: { key: 'kibble', tier: 1, label: 'Kibble', icon: '🥣', color: '#a07050', effect: { hunger: 10 } },
  tuna_can: { key: 'tuna_can', tier: 1, label: 'Tuna can', icon: '🐟', color: '#7a8a96', effect: { hunger: 20 } },

  // Tier 2 — quality
  wet_food_bowl: { key: 'wet_food_bowl', tier: 2, label: 'Wet food bowl', icon: '🍲', color: '#c46818', effect: { hunger: 30, happiness: 5 } },
  chicken_broth: { key: 'chicken_broth', tier: 2, label: 'Chicken broth', icon: '🍵', color: '#dca35a', effect: { hunger: 25, energy: 10 } },

  // Tier 3 — premium
  gourmet_salmon: { key: 'gourmet_salmon', tier: 3, label: 'Gourmet salmon', icon: '🍣', color: '#e87858', effect: { hunger: 40, growthXP: 5 } },
  roast_chicken: { key: 'roast_chicken', tier: 3, label: 'Roast chicken', icon: '🍗', color: '#b87740', effect: { hunger: 50, growthXP: 10, happiness: 10 } },

  // Tier 4 — rare
  golden_fish: { key: 'golden_fish', tier: 4, label: 'Golden fish', icon: '🐠', color: '#ffd700', effect: { hunger: 100, shine: 5 } },
  catnip_leaf: { key: 'catnip_leaf', tier: 4, label: 'Catnip leaf', icon: '🌿', color: '#7ac74f', effect: { happiness: 30, energy: 20 } },

  // Tier 5 — legendary
  stardust_salmon: { key: 'stardust_salmon', tier: 5, label: 'Stardust salmon', icon: '✨', color: '#a085f5', effect: { hunger: 100, growthXP: 30, shine: 3 } },
  phoenix_feather: { key: 'phoenix_feather', tier: 5, label: 'Phoenix feather', icon: '🪶', color: '#ff7040', effect: { hunger: 100, energy: 100, happiness: 100, health: 100 } },
};

export const FOOD_LIST = Object.values(COMPANION_FOODS);

export function getFood(key) {
  return COMPANION_FOODS[key];
}

export const TIER_LABELS = {
  1: 'Daily',
  2: 'Quality',
  3: 'Premium',
  4: 'Rare',
  5: 'Legendary',
};

export const TIER_COLORS = {
  1: 'var(--text-secondary)',
  2: 'var(--cyan)',
  3: 'var(--green)',
  4: 'var(--amber)',
  5: 'var(--purple)',
};
