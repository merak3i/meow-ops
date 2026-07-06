export interface CompanionBreed {
  label: string;
  traits: string;
  palette: {
    body: string;
    accent: string;
    belly: string;
    eyes: string;
    nose: string;
  };
  silhouette: {
    ear: string;
    fur: string;
    body: string;
    tail: string;
    pattern: string;
  };
}

export const COMPANION_BREEDS: Record<string, CompanionBreed>;
export const BREED_LIST: Array<CompanionBreed & { key: string }>;
export function getBreed(key: string): CompanionBreed;
