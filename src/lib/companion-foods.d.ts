export interface FoodEffect {
  hunger?: number;
  energy?: number;
  happiness?: number;
  health?: number;
  growthXP?: number;
  shine?: number;
}

export interface CompanionFood {
  key: string;
  tier: 1 | 2 | 3 | 4 | 5;
  label: string;
  icon: string;
  color: string;
  effect: FoodEffect;
}

export const COMPANION_FOODS: Record<string, CompanionFood>;
export const FOOD_LIST: CompanionFood[];
export function getFood(key: string): CompanionFood | undefined;
export const TIER_LABELS: Record<number, string>;
export const TIER_COLORS: Record<number, string>;
