export interface MouthCue { start: number; end: number; value: string }
export const GUIDE_MOUTH_SHAPES: Readonly<Record<string, string>>;
export function validateMouthCues(data: unknown): MouthCue[] | null;
export function mouthShapeAt(cues: MouthCue[] | null, seconds: number): string;
export function mouthWeightsAt(cues: MouthCue[] | null, seconds: number): Record<string, number>;
