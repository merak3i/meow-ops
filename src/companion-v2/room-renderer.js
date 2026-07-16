import { getRoom } from '../lib/companion-rooms.js';

const TIME_PHASES = [
  { key: 'dawn', start: 5, end: 8, tint: '#f6b26b', strength: 0.18 },
  { key: 'day', start: 8, end: 17, tint: '#dff6ff', strength: 0.07 },
  { key: 'dusk', start: 17, end: 21, tint: '#f08a5d', strength: 0.16 },
  { key: 'night', start: 21, end: 29, tint: '#3563a8', strength: 0.24 },
];

const ROOM_PROPS = {
  corner_mat: ['mat', 'crate'],
  cushion_bed: ['cushion', 'tapestry'],
  wooden_cottage: ['snow-window', 'wood-stove'],
  enchanted_tree: ['mushrooms', 'fireflies'],
  castle_keep: ['banner', 'stone-bench'],
  throne_room: ['throne', 'braziers'],
};

export function getTimePhase(hour) {
  const normalized = ((Number(hour) % 24) + 24) % 24;
  return TIME_PHASES.find((phase) => {
    const end = phase.end > 24 ? phase.end - 24 : phase.end;
    return phase.end > 24
      ? normalized >= phase.start || normalized < end
      : normalized >= phase.start && normalized < end;
  }) ?? TIME_PHASES[3];
}

export function buildRoomVisual(roomKey, hour = new Date().getHours()) {
  const room = getRoom(roomKey);
  const time = getTimePhase(hour);
  return {
    key: room.key,
    tier: room.tier,
    palette: room.palette,
    time,
    props: ROOM_PROPS[room.key] ?? ROOM_PROPS.corner_mat,
    backdrop: `linear-gradient(180deg, color-mix(in oklab, ${room.palette.base} 82%, ${time.tint} 18%) 0%, ${room.palette.base} 58%, color-mix(in oklab, ${room.palette.base} 72%, black 28%) 100%)`,
  };
}
