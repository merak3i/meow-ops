import { useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createChampionInstance, type ChampionInstance } from './champion-instance.mjs';

export const SESSION_ROSTER_MODEL_URLS: Readonly<Record<string, string>> = {
  builder: '/design/sanctum/blender/rivetwren-rig-v10.glb',
  detective: '/design/sanctum/blender/gloamwhisker-rig-v6.glb',
  commander: '/design/sanctum/blender/skirlbell-rig-v1.glb',
  architect: '/design/sanctum/blender/gridwhisk-rig-v11.glb',
  guardian: '/design/sanctum/blender/shieldheart-rig-v3.glb',
  storyteller: '/design/sanctum/blender/foliosong-rig-v3.glb',
  ghost: '/design/sanctum/blender/lanternmote-rig-v2.glb',
};

const sourceLoads = new Map<string, Promise<GLTF>>();

type PreparedModel = {
  instance: ChampionInstance;
  fittedRoot: THREE.Group;
  animations: THREE.AnimationClip[];
};

function loadSource(url: string): Promise<GLTF> {
  const existing = sourceLoads.get(url);
  if (existing) return existing;
  const request = new GLTFLoader().loadAsync(url);
  sourceLoads.set(url, request);
  void request.catch(() => {
    if (sourceLoads.get(url) === request) sourceLoads.delete(url);
  });
  return request;
}

export function SessionRosterModel({
  catType,
  isMovingRef,
  onReadyChange,
}: {
  catType: string;
  isMovingRef: MutableRefObject<boolean>;
  onReadyChange: (ready: boolean) => void;
}) {
  const url = SESSION_ROSTER_MODEL_URLS[catType];
  const [prepared, setPrepared] = useState<PreparedModel | null>(null);
  const [failed, setFailed] = useState(false);
  const visualRef = useRef<THREE.Group>(null);
  const lastClipRef = useRef<string | null>(null);
  const renderConfirmedRef = useRef(false);

  useEffect(() => {
    let active = true;
    let ownedInstance: ChampionInstance | null = null;
    setPrepared(null);
    setFailed(false);
    renderConfirmedRef.current = false;
    onReadyChange(false);
    if (!url) {
      setFailed(true);
      return () => { active = false; };
    }
    void loadSource(url).then(
      gltf => {
        if (!active) return;
        let instance: ChampionInstance | null = null;
        try {
          instance = createChampionInstance(gltf.scene, gltf.animations);
          const bounds = new THREE.Box3().setFromObject(instance.root);
          const height = bounds.max.y - bounds.min.y;
          if (!Number.isFinite(height) || height <= 0.001) {
            throw new Error(`Invalid ${catType} model height: ${height}`);
          }
          const scale = 2.45 / height;
          const fittedRoot = new THREE.Group();
          fittedRoot.scale.setScalar(scale);
          fittedRoot.position.y = -bounds.min.y * scale;
          fittedRoot.add(instance.root);
          let hasSkinnedMesh = false;
          instance.root.traverse(object => {
            if (!(object instanceof THREE.SkinnedMesh)) return;
            hasSkinnedMesh = true;
            object.onBeforeRender = () => {
              // A successful fetch does not prove the rig reached the canvas.
              if (!active || renderConfirmedRef.current) return;
              renderConfirmedRef.current = true;
              onReadyChange(true);
            };
          });
          if (!hasSkinnedMesh) throw new Error(`${catType} GLB has no skinned mesh`);
          ownedInstance = instance;
          lastClipRef.current = null;
          setPrepared({ instance, fittedRoot, animations: gltf.animations });
        } catch {
          instance?.dispose();
          setFailed(true);
          onReadyChange(false);
        }
      },
      () => {
        if (!active) return;
        setFailed(true);
        onReadyChange(false);
      },
    );
    return () => {
      active = false;
      if (ownedInstance) {
        const instance = ownedInstance;
        // React StrictMode replays mount effects in development.
        setTimeout(() => instance.dispose(), 0);
      }
    };
  }, [catType, onReadyChange, url]);

  useFrame((_state, delta) => {
    if (!prepared) return;
    const { instance, animations } = prepared;
    instance.update(delta);
    const desired = isMovingRef.current
      ? animations.find(clip => /walk/i.test(clip.name))
      : animations.find(clip => /idle/i.test(clip.name));
    const clip = desired?.name ?? null;
    if (clip && clip !== lastClipRef.current) {
      instance.play(clip);
      lastClipRef.current = clip;
    }
    if (visualRef.current) visualRef.current.position.y = Math.sin(performance.now() / 650) * 0.025;
  });

  if (failed || !prepared) return null;
  return <group ref={visualRef}>
    <pointLight position={[0, 2.7, 2]} color="#fff1d5" intensity={2.2} distance={7} />
    <primitive object={prepared.fittedRoot} />
  </group>;
}
