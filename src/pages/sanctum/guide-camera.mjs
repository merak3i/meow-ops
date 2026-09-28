export function guideCameraDistance(bounds, { fovDegrees, aspect, padding = 1.12 }) {
  const validBounds = bounds
    && Number.isFinite(bounds.width) && bounds.width > 0
    && Number.isFinite(bounds.height) && bounds.height > 0
    && Number.isFinite(bounds.depth) && bounds.depth >= 0;
  if (!validBounds) throw new RangeError('Guide bounds must have positive width and height and non-negative depth.');
  if (!Number.isFinite(fovDegrees) || fovDegrees <= 0 || fovDegrees >= 179) {
    throw new RangeError('Guide camera field of view must be between 0 and 179 degrees.');
  }
  if (!Number.isFinite(aspect) || aspect <= 0) {
    throw new RangeError('Guide camera aspect ratio must be positive.');
  }
  if (!Number.isFinite(padding) || padding < 1) {
    throw new RangeError('Guide camera padding must be at least 1.');
  }

  const verticalTangent = Math.tan((fovDegrees * Math.PI) / 360);
  const horizontalTangent = verticalTangent * aspect;
  const verticalDistance = (bounds.height / 2) / verticalTangent;
  const horizontalDistance = (bounds.width / 2) / horizontalTangent;
  return bounds.depth / 2 + Math.max(verticalDistance, horizontalDistance) * padding;
}

export function guideProjectedBoundsFit(points, padding = 1) {
  if (!Array.isArray(points) || points.length === 0) return false;
  if (!Number.isFinite(padding) || padding < 1) {
    throw new RangeError('Guide camera padding must be at least 1.');
  }
  const limit = 1 / padding;
  const epsilon = 1e-6;
  return points.every(point => point
    && Number.isFinite(point.x) && Math.abs(point.x) <= limit + epsilon
    && Number.isFinite(point.y) && Math.abs(point.y) <= limit + epsilon
    && Number.isFinite(point.z) && Math.abs(point.z) <= 1 + epsilon);
}
