type CompanionStat = 'hunger' | 'energy' | 'happiness' | 'health' | 'shine';

export type AccessoryTier = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythical';

export interface AccessoryPassive extends Partial<Record<CompanionStat, number>> {}

export interface CompanionAccessory {
  key: string;
  label: string;
  lore: string;
  tier: AccessoryTier;
  cost: number;
  slot: 'neck' | 'head' | 'back' | 'shoulder';
  color: string;
  passive: AccessoryPassive;
  render: {
    cx: number;
    cy: number;
    w: number;
    h: number;
    rotation: number;
  };
}

export const COMPANION_ACCESSORIES: Record<string, CompanionAccessory>;
export const ACCESSORY_LIST: CompanionAccessory[];
export function getAccessory(key: string): CompanionAccessory | undefined;
export function sumPassives(equipped?: string[]): Record<CompanionStat, number>;
export const TIER_RANK: Record<AccessoryTier, number>;
export const TIER_COLOR: Record<AccessoryTier, string>;
export const TIER_GLOW: Record<AccessoryTier, string>;
