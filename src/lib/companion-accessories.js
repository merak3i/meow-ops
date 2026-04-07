// Accessories the companion can equip. Cost is paid in shine currency.
// Render type maps to a small SVG group inside CompanionCat.jsx.

export const COMPANION_ACCESSORIES = {
  collar_red: { key: 'collar_red', label: 'Red collar', tier: 'common', cost: 5, color: '#c44040', slot: 'neck' },
  collar_blue: { key: 'collar_blue', label: 'Blue collar', tier: 'common', cost: 5, color: '#3f7fc8', slot: 'neck' },
  collar_green: { key: 'collar_green', label: 'Green collar', tier: 'common', cost: 5, color: '#5ca35a', slot: 'neck' },
  bow_tie: { key: 'bow_tie', label: 'Bow tie', tier: 'common', cost: 10, color: '#1a1a1a', slot: 'neck' },
  bell_collar: { key: 'bell_collar', label: 'Bell collar', tier: 'uncommon', cost: 20, color: '#d9c8aa', slot: 'neck' },
  wizard_hat: { key: 'wizard_hat', label: 'Wizard hat', tier: 'uncommon', cost: 30, color: '#3a2a5c', slot: 'head' },
  crown: { key: 'crown', label: 'Crown', tier: 'rare', cost: 50, color: '#ffd700', slot: 'head' },
  cape: { key: 'cape', label: 'Cape', tier: 'rare', cost: 60, color: '#7a2020', slot: 'back' },
  knights_helm: { key: 'knights_helm', label: "Knight's helm", tier: 'epic', cost: 100, color: '#9aa9b4', slot: 'head' },
  ravens_perch: { key: 'ravens_perch', label: "Raven's perch", tier: 'epic', cost: 120, color: '#1a1a1a', slot: 'shoulder' },
  halo: { key: 'halo', label: 'Halo', tier: 'legendary', cost: 200, color: '#fff5a8', slot: 'head' },
  golden_wings: { key: 'golden_wings', label: 'Golden wings', tier: 'mythical', cost: 350, color: '#ffd700', slot: 'back' },
  dragon_wings: { key: 'dragon_wings', label: 'Dragon wings', tier: 'mythical', cost: 500, color: '#5a2010', slot: 'back' },
};

export const ACCESSORY_LIST = Object.values(COMPANION_ACCESSORIES);

export function getAccessory(key) {
  return COMPANION_ACCESSORIES[key];
}

export const TIER_RANK = { common: 1, uncommon: 2, rare: 3, epic: 4, legendary: 5, mythical: 6 };
export const TIER_COLOR = {
  common: 'var(--text-secondary)',
  uncommon: 'var(--cyan)',
  rare: 'var(--green)',
  epic: 'var(--amber)',
  legendary: 'var(--purple)',
  mythical: '#ff7040',
};
