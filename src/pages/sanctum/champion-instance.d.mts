import type { AnimationClip, Object3D } from 'three';

export interface ChampionInstance {
  root: Object3D;
  play(name: string, options?: { once?: boolean; fade?: number }): void;
  restart(): void;
  update(delta: number): void;
  dispose(): void;
}

export function createChampionInstance(source: Object3D, clips: AnimationClip[]): ChampionInstance;
