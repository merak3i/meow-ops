// Accessories with character. Each has:
//   label    — flavourful GoT/fantasy name
//   lore     — one-sentence flavour string shown in the wardrobe
//   tier     — rarity tier
//   cost     — shine cost to purchase
//   slot     — neck / head / back / shoulder (used for rendering layer)
//   color    — primary tint
//   passive  — { stat: amountPerHour } boosts applied while equipped
//   render   — { cx, cy, w, h, rotation } — SVG viewBox (0 0 280 280) position
//              used for PNG overlay compositing. cx/cy = center of accessory on cat.

export const COMPANION_ACCESSORIES = {
  scarlet_sigil: {
    key: 'scarlet_sigil',
    label: 'Scarlet Sigil Collar',
    lore: 'A ruby-studded collar for hearts that burn bright.',
    tier: 'common', cost: 5, slot: 'neck', color: '#c44040',
    passive: { happiness: 0.05 },
    render: { cx: 140, cy: 200, w: 72, h: 24, rotation: 0 },
  },
  sapphire_band: {
    key: 'sapphire_band',
    label: 'Sapphire Oath Band',
    lore: 'A cool band sworn to the sea-cats of the North.',
    tier: 'common', cost: 5, slot: 'neck', color: '#3f7fc8',
    passive: { energy: 0.05 },
    render: { cx: 140, cy: 200, w: 72, h: 24, rotation: 0 },
  },
  emerald_vow: {
    key: 'emerald_vow',
    label: 'Emerald Vow Collar',
    lore: 'Mossy green, woven from forest oaths.',
    tier: 'common', cost: 5, slot: 'neck', color: '#5ca35a',
    passive: { health: 0.05 },
    render: { cx: 140, cy: 200, w: 72, h: 24, rotation: 0 },
  },
  ebony_cravat: {
    key: 'ebony_cravat',
    label: 'Ebony Cravat',
    lore: 'For the cat attending the most important dinner of the season.',
    tier: 'common', cost: 10, slot: 'neck', color: '#1a1a1a',
    passive: { happiness: 0.1 },
    render: { cx: 140, cy: 207, w: 88, h: 50, rotation: 0 },
  },
  silverbell: {
    key: 'silverbell',
    label: 'Silverbell of Summoning',
    lore: 'Chimes softly whenever good fortune is near.',
    tier: 'uncommon', cost: 20, slot: 'neck', color: '#e0d8b0',
    passive: { happiness: 0.15, shine: 0.1 },
    render: { cx: 140, cy: 210, w: 52, h: 40, rotation: 0 },
  },
  arcanist_cap: {
    key: 'arcanist_cap',
    label: "Arcanist's Pointed Cap",
    lore: 'Worn by scholars of the night schools of Asshai.',
    tier: 'uncommon', cost: 30, slot: 'head', color: '#3a2a5c',
    passive: { energy: 0.1, shine: 0.15 },
    render: { cx: 140, cy: 66, w: 112, h: 84, rotation: 0 },
  },
  crown_of_embers: {
    key: 'crown_of_embers',
    label: 'Crown of Nine Embers',
    lore: 'Nine rubies for nine kingdoms. Still warm.',
    tier: 'rare', cost: 50, slot: 'head', color: '#ffd24a',
    passive: { happiness: 0.25, shine: 0.3 },
    render: { cx: 140, cy: 74, w: 92, h: 46, rotation: 0 },
  },
  crimson_mantle: {
    key: 'crimson_mantle',
    label: 'Crimson Mantle',
    lore: 'Dyed in the dust of roads no cat should walk alone.',
    tier: 'rare', cost: 60, slot: 'back', color: '#7a2020',
    passive: { health: 0.25, happiness: 0.1 },
    render: { cx: 140, cy: 185, w: 162, h: 122, rotation: 0 },
  },
  ironwolf_helm: {
    key: 'ironwolf_helm',
    label: 'Ironwolf War Helm',
    lore: 'Forged by the smiths of Winterfell for a cat who refused to kneel.',
    tier: 'epic', cost: 100, slot: 'head', color: '#a0a8b2',
    passive: { health: 0.4, energy: 0.2 },
    render: { cx: 140, cy: 92, w: 132, h: 104, rotation: 0 },
  },
  ravens_pauldron: {
    key: 'ravens_pauldron',
    label: "Raven's Pauldron",
    lore: 'A clever raven perches here and whispers rumours from the wall.',
    tier: 'epic', cost: 120, slot: 'shoulder', color: '#1a1a1a',
    passive: { shine: 0.5, happiness: 0.15 },
    render: { cx: 74, cy: 158, w: 72, h: 82, rotation: -5 },
  },
  halo_of_the_first_sun: {
    key: 'halo_of_the_first_sun',
    label: 'Halo of the First Sun',
    lore: 'Carved from the morning that the Old Gods first opened their eyes.',
    tier: 'legendary', cost: 200, slot: 'head', color: '#fff5a8',
    passive: { happiness: 0.5, health: 0.3, shine: 0.7 },
    render: { cx: 140, cy: 60, w: 104, h: 32, rotation: 0 },
  },
  gilded_wings: {
    key: 'gilded_wings',
    label: 'Gilded Wings of Valyria',
    lore: 'Hammered from gold older than the Freehold itself.',
    tier: 'mythical', cost: 350, slot: 'back', color: '#ffd700',
    passive: { energy: 0.6, shine: 1.0 },
    render: { cx: 140, cy: 178, w: 224, h: 162, rotation: 0 },
  },
  dragon_wings: {
    key: 'dragon_wings',
    label: 'Wings of Balerion',
    lore: 'Leathered black. They stir when something enormous flies overhead.',
    tier: 'mythical', cost: 500, slot: 'back', color: '#5a1010',
    passive: { health: 0.8, happiness: 0.5, shine: 1.2 },
    render: { cx: 140, cy: 168, w: 244, h: 182, rotation: 0 },
  },
};

export const ACCESSORY_LIST = Object.values(COMPANION_ACCESSORIES);

export function getAccessory(key) {
  return COMPANION_ACCESSORIES[key];
}

// Sum up all passive modifiers from equipped accessories (per hour).
// Returns { hunger, energy, happiness, health, shine } all numbers.
export function sumPassives(equipped = []) {
  const total = { hunger: 0, energy: 0, happiness: 0, health: 0, shine: 0 };
  for (const key of equipped) {
    const a = COMPANION_ACCESSORIES[key];
    if (!a || !a.passive) continue;
    for (const [stat, amt] of Object.entries(a.passive)) {
      if (total[stat] !== undefined) total[stat] += amt;
    }
  }
  return total;
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
export const TIER_GLOW = {
  common: 'none',
  uncommon: '0 0 12px rgba(127, 207, 229, 0.35)',
  rare: '0 0 14px rgba(92, 195, 90, 0.4)',
  epic: '0 0 18px rgba(255, 193, 70, 0.45)',
  legendary: '0 0 24px rgba(180, 130, 255, 0.5)',
  mythical: '0 0 28px rgba(255, 112, 64, 0.55)',
};
