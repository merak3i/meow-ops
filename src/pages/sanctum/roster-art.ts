import * as THREE from 'three';
import { drawArchiveSealVector } from './archive-seal-mark';

export interface RosterArtSpec {
  readonly assetUrl: string;
  readonly sealX: number;
  readonly sealY: number;
  readonly sealSize: number;
}

export const SESSION_ROSTER_ART_SPECS: Readonly<Record<string, RosterArtSpec>> = {
  builder: {
    assetUrl: new URL('./assets/roster/rivetwren-realistic-cutout-v2.webp', import.meta.url).href,
    sealX: 602, sealY: 496, sealSize: 160,
  },
  architect: {
    assetUrl: new URL('./assets/roster/gridwhisk-realistic-cutout-v2.webp', import.meta.url).href,
    sealX: 625, sealY: 420, sealSize: 160,
  },
  detective: {
    assetUrl: new URL('./assets/roster/gloamwhisker-realistic-cutout-v2.webp', import.meta.url).href,
    sealX: 456, sealY: 444, sealSize: 160,
  },
  commander: {
    assetUrl: new URL('./assets/roster/skirlbell-realistic-cutout-v2.webp', import.meta.url).href,
    sealX: 457, sealY: 463, sealSize: 160,
  },
  guardian: {
    assetUrl: new URL('./assets/roster/shieldheart-realistic-cutout-v2.webp', import.meta.url).href,
    sealX: 602, sealY: 423, sealSize: 160,
  },
  storyteller: {
    assetUrl: new URL('./assets/roster/foliosong-realistic-cutout-v2.webp', import.meta.url).href,
    sealX: 470, sealY: 449, sealSize: 160,
  },
  ghost: {
    assetUrl: new URL('./assets/roster/lanternmote-realistic-cutout-v2.webp', import.meta.url).href,
    sealX: 642, sealY: 466, sealSize: 160,
  },
};

const MAX_TEXTURE_EDGE = 768;
const TEXTURE_CACHE = new Map<string, Promise<THREE.CanvasTexture>>();

/** Load a role cutout, downsample it for the scene, and overlay the authored Seal. */
export function loadRosterArtTexture(spec: RosterArtSpec): Promise<THREE.CanvasTexture> {
  const cacheKey = `${spec.assetUrl}:${spec.sealX}:${spec.sealY}:${spec.sealSize}`;
  const cachedTexture = TEXTURE_CACHE.get(cacheKey);
  if (cachedTexture) return cachedTexture;

  const texturePromise = new Promise<THREE.CanvasTexture>((resolve, reject) => {
    new THREE.TextureLoader().load(
      spec.assetUrl,
      source => {
        try {
          const image = source.image as CanvasImageSource & { width?: number; height?: number };
          const width = image.width ?? 0;
          const height = image.height ?? 0;
          if (width <= 0 || height <= 0) throw new Error('Roster art image has no dimensions');

          const scale = Math.min(1, MAX_TEXTURE_EDGE / Math.max(width, height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(width * scale));
          canvas.height = Math.max(1, Math.round(height * scale));
          const context = canvas.getContext('2d');
          if (!context) throw new Error('Roster art canvas is unavailable');

          const scaleX = canvas.width / width;
          const scaleY = canvas.height / height;
          context.imageSmoothingEnabled = true;
          context.drawImage(image, 0, 0, width, height, 0, 0, canvas.width, canvas.height);
          drawArchiveSealVector(
            context,
            spec.sealX * scaleX,
            spec.sealY * scaleY,
            spec.sealSize * Math.min(scaleX, scaleY),
            '#172327',
          );

          const texture = new THREE.CanvasTexture(canvas);
          texture.colorSpace = THREE.SRGBColorSpace;
          resolve(texture);
        } catch (error) {
          reject(error);
        } finally {
          source.dispose();
        }
      },
      undefined,
      () => reject(new Error('Roster art image failed to load')),
    );
  });

  const sharedTexturePromise = texturePromise.catch(error => {
    if (TEXTURE_CACHE.get(cacheKey) === sharedTexturePromise) TEXTURE_CACHE.delete(cacheKey);
    throw error;
  });
  TEXTURE_CACHE.set(cacheKey, sharedTexturePromise);
  return sharedTexturePromise;
}
