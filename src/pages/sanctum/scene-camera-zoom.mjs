const ZOOM_START_WIDTH = 600;
const ZOOM_END_WIDTH = 960;

function getProgress(viewportWidth) {
  const width = Number.isFinite(viewportWidth) ? viewportWidth : ZOOM_END_WIDTH;
  return Math.max(0, Math.min(1, (width - ZOOM_START_WIDTH) / (ZOOM_END_WIDTH - ZOOM_START_WIDTH)));
}

export function getSceneZoom(viewportWidth) {
  return 14 + getProgress(viewportWidth) * 24;
}

export function getSceneMinZoom(viewportWidth) {
  return 14 + getProgress(viewportWidth) * 16;
}

export function applySceneCameraZoom(camera, zoom) {
  if (!Number.isFinite(zoom) || zoom <= 0) return;
  camera.zoom = zoom;
  camera.updateProjectionMatrix();
}
