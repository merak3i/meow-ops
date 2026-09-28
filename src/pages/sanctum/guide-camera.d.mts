export interface GuideCameraBounds {
  width: number;
  height: number;
  depth: number;
}

export interface GuideCameraOptions {
  fovDegrees: number;
  aspect: number;
  padding?: number;
}

export function guideCameraDistance(bounds: GuideCameraBounds, options: GuideCameraOptions): number;

export interface GuideProjectedPoint {
  x: number;
  y: number;
  z: number;
}

export function guideProjectedBoundsFit(points: readonly GuideProjectedPoint[], padding?: number): boolean;
