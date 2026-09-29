export function getSceneZoom(viewportWidth: number): number;
export function getSceneMinZoom(viewportWidth: number): number;
export function applySceneCameraZoom(camera: { zoom: number; updateProjectionMatrix(): void }, zoom: number): void;
