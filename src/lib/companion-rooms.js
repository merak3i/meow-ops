// Room tiers for the Companion living space.
// Unlocks based on days since adoption. Render is layered SVG/CSS scenes
// (defined inside CompanionRoom.jsx). Each tier may also be overridden by
// a 4K image at /companion/rooms/{key}.jpg if the user drops one in.

export const COMPANION_ROOMS = {
  corner_mat: {
    key: 'corner_mat',
    tier: 1,
    label: 'Corner mat',
    description: 'A burlap mat in a quiet wooden corner.',
    unlockDays: 0,
    palette: {
      base: 'oklch(0.18 0.01 60)',
      accent: 'oklch(0.32 0.06 60)',
      highlight: 'oklch(0.55 0.12 60)',
    },
  },
  cushion_bed: {
    key: 'cushion_bed',
    tier: 2,
    label: 'Cushion bed',
    description: 'A purple velvet cushion under a hanging tapestry.',
    unlockDays: 5,
    palette: {
      base: 'oklch(0.18 0.02 295)',
      accent: 'oklch(0.32 0.10 295)',
      highlight: 'oklch(0.55 0.18 295)',
    },
  },
  wooden_cottage: {
    key: 'wooden_cottage',
    tier: 3,
    label: 'Wooden cottage',
    description: 'Warm wood walls with a snowy window.',
    unlockDays: 30,
    palette: {
      base: 'oklch(0.20 0.03 50)',
      accent: 'oklch(0.36 0.08 50)',
      highlight: 'oklch(0.62 0.14 80)',
    },
  },
  enchanted_tree: {
    key: 'enchanted_tree',
    tier: 4,
    label: 'Enchanted tree',
    description: 'Glowing fungi, moss, and drifting fireflies.',
    unlockDays: 90,
    palette: {
      base: 'oklch(0.18 0.04 160)',
      accent: 'oklch(0.32 0.10 160)',
      highlight: 'oklch(0.65 0.18 142)',
    },
  },
  castle_keep: {
    key: 'castle_keep',
    tier: 5,
    label: 'Castle keep',
    description: 'Grey stone hall hung with house banners.',
    unlockDays: 180,
    palette: {
      base: 'oklch(0.18 0.01 240)',
      accent: 'oklch(0.32 0.04 240)',
      highlight: 'oklch(0.62 0.16 30)',
    },
  },
  throne_room: {
    key: 'throne_room',
    tier: 6,
    label: 'Throne room',
    description: 'Black marble. Iron throne. The realm waits.',
    unlockDays: 365,
    palette: {
      base: 'oklch(0.12 0 0)',
      accent: 'oklch(0.22 0.02 30)',
      highlight: 'oklch(0.65 0.20 30)',
    },
  },
};

export const ROOM_LIST = Object.values(COMPANION_ROOMS).sort((a, b) => a.tier - b.tier);

export function getRoom(key) {
  return COMPANION_ROOMS[key] || COMPANION_ROOMS.corner_mat;
}

export function unlockedRooms(daysAdopted) {
  return ROOM_LIST.filter((r) => daysAdopted >= r.unlockDays).map((r) => r.key);
}
