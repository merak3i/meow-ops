export interface FrameMetrics {
  fps: number;
  p95Ms: number;
}

export function summarizeFrameDeltas(deltasSeconds: readonly number[]): FrameMetrics;
