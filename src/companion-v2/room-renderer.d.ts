export interface RoomVisual {
  key: string;
  tier: number;
  palette: { base: string; accent: string; highlight: string };
  time: { key: string; start: number; end: number; tint: string; strength: number };
  props: string[];
  backdrop: string;
}

export function getTimePhase(hour: number): RoomVisual['time'];
export function buildRoomVisual(roomKey: string, hour?: number): RoomVisual;
