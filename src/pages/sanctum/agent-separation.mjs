const CAMERA_AXIS = Math.SQRT1_2;
const CAMERA_FLOOR_PROJECTION = 12 / Math.hypot(14, 12, 14);
const SCREEN_RIGHT_CLEARANCE = 5.25;
const SCREEN_VERTICAL_CLEARANCE = 2.9;
const BASE_FRAME_NUDGE = 0.03;
const MAX_FRAME_NUDGE = 0.16;

function stablePairSide(leftId, rightId) {
  const pairKey = leftId < rightId ? `${leftId}\0${rightId}` : `${rightId}\0${leftId}`;
  let hash = 2166136261;
  for (let index = 0; index < pairKey.length; index++) {
    hash = Math.imul(hash ^ pairKey.charCodeAt(index), 16777619);
  }
  const canonicalSide = (hash >>> 0) % 2 === 0 ? 1 : -1;
  return leftId < rightId ? canonicalSide : -canonicalSide;
}

export function agentSeparationNudge(x, z, otherX, otherZ, id, otherId, delta) {
  if (![x, z, otherX, otherZ, delta].every(Number.isFinite) || delta <= 0 || id === otherId) {
    return [0, 0];
  }

  const dx = x - otherX;
  const dz = z - otherZ;
  const screenRight = (dx - dz) * CAMERA_AXIS;
  const screenVertical = (dx + dz) * CAMERA_AXIS * CAMERA_FLOOR_PROJECTION;
  const rightGap = SCREEN_RIGHT_CLEARANCE - Math.abs(screenRight);
  const verticalGap = SCREEN_VERTICAL_CLEARANCE - Math.abs(screenVertical);
  if (rightGap <= 0 || verticalGap <= 0) return [0, 0];

  const verticalWorldGap = verticalGap / CAMERA_FLOOR_PROJECTION;
  const pushDistance = Math.min(
    (Math.min(rightGap, verticalWorldGap) + 0.08) * 6 * delta + BASE_FRAME_NUDGE,
    MAX_FRAME_NUDGE,
  );
  const tieSide = stablePairSide(id, otherId);

  if (rightGap <= verticalWorldGap) {
    const side = screenRight === 0 ? tieSide : Math.sign(screenRight);
    const alongRight = side * pushDistance * CAMERA_AXIS;
    return [alongRight, -alongRight];
  }

  const side = screenVertical === 0 ? tieSide : Math.sign(screenVertical);
  const alongDepth = side * pushDistance * CAMERA_AXIS;
  return [alongDepth, alongDepth];
}
