export interface CompanionRoom {
  key: string;
  tier: number;
  label: string;
  description: string;
  unlockDays: number;
  palette: {
    base: string;
    accent: string;
    highlight: string;
  };
}

export const COMPANION_ROOMS: Record<string, CompanionRoom>;
export const ROOM_LIST: CompanionRoom[];
export function getRoom(key: string): CompanionRoom;
export function unlockedRooms(daysAdopted: number): string[];
