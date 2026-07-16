import type { CompanionBreed } from '@/lib/companion-breeds';
import type { Sprite } from './sprites';

export function buildBreedPalette(breed: CompanionBreed | undefined): readonly string[];
export function applyBreedPattern(sprite: Sprite, breed: CompanionBreed | undefined): Sprite;
