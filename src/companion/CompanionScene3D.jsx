/**
 * CompanionScene3D — full React Three Fiber 3D scene for the companion cat.
 * Lazy-loaded by CompanionView to keep the main bundle lean.
 *
 * Architecture:
 *   Canvas (shadows, ACES filmic)
 *   ├── SceneLighting   — ambient + directional key + cool rim + warm fill
 *   ├── Room3D          — floor + walls (canvas-generated textures) + accent lights
 *   └── CatGroup        — procedural cat: anatomy, breed textures, full animation
 */

import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useRef, useMemo } from 'react';
import { getRoom } from '../lib/companion-rooms';

// ─── Texture generators ──────────────────────────────────────────────────────

function generateFurTexture(palette, pattern) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  const ctx = c.getContext('2d');

  ctx.fillStyle = palette.body;
  ctx.fillRect(0, 0, 512, 512);

  // Micro fur strands
  for (let i = 0; i < 9000; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const len = 2 + Math.random() * 5;
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * 0.9;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
    ctx.strokeStyle = `rgba(0,0,0,${0.025 + Math.random() * 0.055})`;
    ctx.lineWidth = 0.5;
    ctx.stroke();
  }

  if (pattern === 'stripes') {
    ctx.globalAlpha = 0.32;
    for (let i = 0; i < 14; i++) {
      ctx.fillStyle = palette.accent;
      ctx.fillRect(0, i * 38, 512, 20);
    }
    ctx.globalAlpha = 1;
  } else if (pattern === 'spots') {
    ctx.globalAlpha = 0.38;
    for (let i = 0; i < 32; i++) {
      const x = 28 + Math.random() * 460;
      const y = 28 + Math.random() * 460;
      const rx = 14 + Math.random() * 22;
      const ry = rx * (0.65 + Math.random() * 0.4);
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, Math.random() * Math.PI, 0, Math.PI * 2);
      ctx.fillStyle = palette.accent;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  } else if (pattern === 'patches') {
    ctx.globalAlpha = 0.42;
    for (let i = 0; i < 9; i++) {
      const x = 60 + Math.random() * 400;
      const y = 60 + Math.random() * 400;
      const r = 44 + Math.random() * 72;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = i % 2 === 0 ? palette.accent : '#e8e0d0';
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  } else if (pattern === 'colorpoint') {
    const grad = ctx.createRadialGradient(256, 256, 70, 256, 256, 260);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, palette.accent + 'bb');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 512);
  } else if (pattern === 'tuxedo') {
    ctx.fillStyle = palette.belly;
    ctx.beginPath();
    ctx.ellipse(256, 340, 95, 170, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  return c;
}

function generateBellyTexture(palette) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const ctx = c.getContext('2d');
  const grad = ctx.createRadialGradient(128, 128, 10, 128, 128, 128);
  grad.addColorStop(0, palette.belly);
  grad.addColorStop(0.7, palette.belly + 'cc');
  grad.addColorStop(1, palette.body + '00');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);
  return c;
}

function generateFloorTexture(roomKey) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  const ctx = c.getContext('2d');

  if (roomKey === 'throne_room') {
    ctx.fillStyle = '#111111';
    ctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 24; i++) {
      let x = Math.random() * 512;
      let y = 0;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let j = 0; j < 22; j++) {
        x += (Math.random() - 0.5) * 38;
        y += 24;
        ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `rgba(90,90,90,${0.08 + Math.random() * 0.12})`;
      ctx.lineWidth = 0.5 + Math.random() * 0.8;
      ctx.stroke();
    }
  } else if (roomKey === 'castle_keep') {
    ctx.fillStyle = '#4a4d56';
    ctx.fillRect(0, 0, 512, 512);
    for (let row = 0; row < 9; row++) {
      for (let col = 0; col < 5; col++) {
        const offset = (row % 2 === 0 ? 0 : 56);
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = 2.5;
        ctx.strokeRect(col * 112 + offset - 56, row * 58, 108, 54);
        ctx.fillStyle = `rgba(${60 + Math.floor(Math.random() * 18)},${64 + Math.floor(Math.random() * 18)},${72 + Math.floor(Math.random() * 18)},0.3)`;
        ctx.fillRect(col * 112 + offset - 56 + 2, row * 58 + 2, 104, 50);
      }
    }
  } else if (roomKey === 'enchanted_tree') {
    ctx.fillStyle = '#161f0e';
    ctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 240; i++) {
      ctx.beginPath();
      ctx.arc(Math.random() * 512, Math.random() * 512, 1.5 + Math.random() * 5, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${28 + Math.random() * 30},${58 + Math.random() * 35},${12 + Math.random() * 18},0.55)`;
      ctx.fill();
    }
  } else {
    // Warm wood (corner_mat, cushion_bed, wooden_cottage)
    const baseR = roomKey === 'cushion_bed' ? 45 : 58;
    const baseG = roomKey === 'cushion_bed' ? 30 : 38;
    const baseB = roomKey === 'cushion_bed' ? 55 : 18;
    ctx.fillStyle = `rgb(${baseR},${baseG},${baseB})`;
    ctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 9; i++) {
      const plankR = baseR + Math.floor(Math.random() > 0.5 ? 22 : 10);
      const plankG = baseG + Math.floor(Math.random() > 0.5 ? 15 : 6);
      const plankB = baseB + Math.floor(Math.random() > 0.5 ? 5 : 0);
      ctx.fillStyle = `rgba(${plankR},${plankG},${plankB},0.38)`;
      ctx.fillRect(0, i * 58, 512, 54);
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.lineWidth = 2;
      ctx.strokeRect(0, i * 58, 512, 56);
    }
    for (let i = 0; i < 45; i++) {
      ctx.beginPath();
      ctx.moveTo(0, Math.random() * 512);
      ctx.lineTo(512, Math.random() * 512);
      ctx.strokeStyle = 'rgba(0,0,0,0.04)';
      ctx.lineWidth = 0.5;
      ctx.stroke();
    }
  }
  return c;
}

function generateWallTexture(roomKey) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  const ctx = c.getContext('2d');
  const colors = {
    corner_mat: '#221a10', cushion_bed: '#1c1030', wooden_cottage: '#281c0e',
    enchanted_tree: '#0c180a', castle_keep: '#282e38', throne_room: '#0a0a0a',
  };
  ctx.fillStyle = colors[roomKey] || '#181818';
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 4000; i++) {
    ctx.beginPath();
    ctx.arc(Math.random() * 512, Math.random() * 512, Math.random() * 1.2, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.018})`;
    ctx.fill();
  }
  return c;
}

// ─── Whisker lines ────────────────────────────────────────────────────────────

function WhiskerLines({ side }) {
  const geo = useMemo(() => {
    const positions = [];
    const baseX = side * 0.06;
    const tipX = side * 0.46;
    [-0.07, 0, 0.07].forEach((yOff, i) => {
      const yTip = 1.34 + yOff + (i - 1) * 0.016;
      positions.push(baseX, 1.34 + yOff, 0.7, tipX, yTip, 0.48);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return g;
  }, [side]);

  return (
    <lineSegments geometry={geo}>
      <lineBasicMaterial color="#ddd8c0" />
    </lineSegments>
  );
}

// ─── Cat mesh ─────────────────────────────────────────────────────────────────

function CatGroup({ cat, mood, breed }) {
  const groupRef   = useRef();
  const bodyRef    = useRef();
  const headRef    = useRef();
  const leftEarG   = useRef();
  const rightEarG  = useRef();
  const leftPawRef = useRef();
  const leftEyeG   = useRef();
  const rightEyeG  = useRef();
  const tailBaseG  = useRef();
  const tailMidG   = useRef();
  const tailTipG   = useRef();

  const palette = breed?.palette ?? {
    body: '#d7892f', accent: '#7a4513', belly: '#f1d29c', eyes: '#5ca35a', nose: '#a85a3a',
  };
  const pattern = breed?.silhouette?.pattern ?? 'stripes';

  // Materials
  const furMat = useMemo(() => new THREE.MeshStandardMaterial({
    map: (() => {
      const tex = new THREE.CanvasTexture(generateFurTexture(palette, pattern));
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(2, 2);
      return tex;
    })(),
    roughness: 0.88,
    metalness: 0.0,
  }), [palette.body, palette.accent, pattern]); // eslint-disable-line react-hooks/exhaustive-deps

  const bellyMat = useMemo(() => new THREE.MeshStandardMaterial({
    map: new THREE.CanvasTexture(generateBellyTexture(palette)),
    roughness: 0.85,
  }), [palette.belly, palette.body]); // eslint-disable-line react-hooks/exhaustive-deps

  const eyeMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: new THREE.Color(palette.eyes),
    roughness: 0.12, metalness: 0.08,
    emissive: new THREE.Color(palette.eyes), emissiveIntensity: mood === 'glowing' ? 0.55 : 0.18,
  }), [palette.eyes, mood]);

  const pupilMat   = useMemo(() => new THREE.MeshStandardMaterial({ color: '#060606', roughness: 0.3, metalness: 0.1 }), []);
  const scleraMat  = useMemo(() => new THREE.MeshStandardMaterial({ color: '#f2ede4', roughness: 0.12 }), []);
  const catchMat   = useMemo(() => new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0, emissive: '#ffffff', emissiveIntensity: 1.0 }), []);
  const noseMat    = useMemo(() => new THREE.MeshStandardMaterial({ color: new THREE.Color(palette.nose), roughness: 0.4 }), [palette.nose]);
  const innerEarMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#e08888', roughness: 0.92, emissive: '#a04040', emissiveIntensity: 0.14 }), []);
  const eyelidMat  = useMemo(() => new THREE.MeshStandardMaterial({ color: new THREE.Color(palette.body), roughness: 0.9 }), [palette.body]);

  // Per-mood pupil dilation
  const pupilR = mood === 'distressed' || mood === 'critical' ? 0.076 : mood === 'glowing' ? 0.044 : 0.058;

  // Animation clocks
  const clk = useRef({ breathe: 0, tail: 0, earL: 0, earR: 0, paw: 0, shiver: 0 });
  const blink = useRef({ timer: 0, next: 3 + Math.random() * 4, phase: 0 }); // phase: 0=open, 1=closing, 2=closed, 3=opening

  useFrame((_, dt) => {
    const c = clk.current;
    c.breathe += dt; c.tail += dt; c.earL += dt; c.earR += dt; c.paw += dt; c.shiver += dt;

    // Breathing
    if (bodyRef.current) {
      const bs = 1 + Math.sin(c.breathe * 1.45) * 0.03;
      bodyRef.current.scale.set(1 - (bs - 1) * 0.25, bs, 1 - (bs - 1) * 0.15);
    }
    if (headRef.current) {
      headRef.current.position.y = 1.44 + Math.sin(c.breathe * 1.45) * 0.014;
    }

    // Tail — 3-joint chain
    if (tailBaseG.current) tailBaseG.current.rotation.z = Math.sin(c.tail * 1.1) * 0.52 + Math.sin(c.tail * 0.65) * 0.18;
    if (tailMidG.current)  tailMidG.current.rotation.z  = Math.sin(c.tail * 1.45 + 0.9) * 0.42;
    if (tailTipG.current)  tailTipG.current.rotation.z  = Math.sin(c.tail * 1.85 + 1.7) * 0.36;

    // Ear twitches (independent timers: 6.5s / 8.2s)
    if (leftEarG.current) {
      const p = Math.sin(c.earL * (2 * Math.PI / 6.5));
      leftEarG.current.rotation.z = p > 0.97 ? 0.14 + Math.sin(c.earL * 14) * 0.11 : THREE.MathUtils.lerp(leftEarG.current.rotation.z, 0, dt * 5);
    }
    if (rightEarG.current) {
      const p = Math.sin(c.earR * (2 * Math.PI / 8.2) + 1.3);
      rightEarG.current.rotation.z = p > 0.97 ? -(0.14 + Math.sin(c.earR * 14) * 0.11) : THREE.MathUtils.lerp(rightEarG.current.rotation.z, 0, dt * 5);
    }

    // Paw knead every 9 s
    if (leftPawRef.current) {
      const phase = (c.paw % 9) / 9;
      leftPawRef.current.position.y = phase > 0.86
        ? -1.08 + Math.sin(((phase - 0.86) / 0.14) * Math.PI) * 0.14
        : -1.08;
    }

    // Blink
    const bl = blink.current;
    bl.timer += dt;
    if (bl.timer >= bl.next && bl.phase === 0) { bl.phase = 1; bl.timer = 0; bl.next = 0.08; }
    if (bl.timer >= bl.next && bl.phase === 1) { bl.phase = 2; bl.timer = 0; bl.next = 0.06; }
    if (bl.timer >= bl.next && bl.phase === 2) { bl.phase = 3; bl.timer = 0; bl.next = 0.1; }
    if (bl.timer >= bl.next && bl.phase === 3) { bl.phase = 0; bl.timer = 0; bl.next = 3 + Math.random() * 5; }
    const eyelidTarget = bl.phase === 1 ? 1 : bl.phase === 2 ? 1 : 0;
    if (leftEyeG.current && rightEyeG.current) {
      const newY = THREE.MathUtils.lerp(leftEyeG.current.scale.y, eyelidTarget, dt * 22);
      leftEyeG.current.scale.y  = newY;
      rightEyeG.current.scale.y = newY;
    }

    // Distress shiver
    if (groupRef.current) {
      if (mood === 'distressed' || mood === 'critical') {
        groupRef.current.position.x = Math.sin(c.shiver * 32) * 0.055;
      } else {
        groupRef.current.position.x = THREE.MathUtils.lerp(groupRef.current.position.x, 0, dt * 7);
      }
      // Glowing float
      groupRef.current.position.y = mood === 'glowing' ? Math.sin(c.breathe * 1.1) * 0.07 : 0;
    }
  });

  return (
    <group ref={groupRef}>
      {/* ── Body ── */}
      <mesh ref={bodyRef} position={[0, 0.58, 0]} castShadow material={furMat}>
        <capsuleGeometry args={[0.52, 0.9, 8, 16]} />
      </mesh>
      {/* Belly */}
      <mesh position={[0, 0.52, 0.32]} material={bellyMat}>
        <sphereGeometry args={[0.44, 14, 14, 0, Math.PI * 2, 0, Math.PI * 0.68]} />
      </mesh>

      {/* ── Haunches ── */}
      <mesh position={[-0.32, 0.16, -0.22]} castShadow material={furMat}>
        <sphereGeometry args={[0.27, 10, 10]} />
      </mesh>
      <mesh position={[0.32, 0.16, -0.22]} castShadow material={furMat}>
        <sphereGeometry args={[0.27, 10, 10]} />
      </mesh>

      {/* ── Neck ── */}
      <mesh position={[0, 1.15, 0.12]} castShadow material={furMat}>
        <cylinderGeometry args={[0.22, 0.3, 0.36, 12]} />
      </mesh>

      {/* ── Head ── */}
      <mesh ref={headRef} position={[0, 1.44, 0.2]} castShadow material={furMat}>
        <sphereGeometry args={[0.5, 18, 18]} />
      </mesh>

      {/* Muzzle protrusion */}
      <mesh position={[0, 1.33, 0.59]} material={bellyMat}>
        <sphereGeometry args={[0.22, 12, 12]} />
      </mesh>
      {/* Chin pad */}
      <mesh position={[0, 1.22, 0.56]} material={bellyMat}>
        <sphereGeometry args={[0.14, 8, 8]} />
      </mesh>
      {/* Nose */}
      <mesh position={[0, 1.39, 0.74]} material={noseMat}>
        <sphereGeometry args={[0.062, 8, 8]} />
      </mesh>

      {/* ── Left Ear ── */}
      <group ref={leftEarG} position={[-0.27, 1.84, 0.1]}>
        <mesh castShadow material={furMat} rotation={[0.28, 0, -0.22]}>
          <coneGeometry args={[0.15, 0.33, 8]} />
        </mesh>
        <mesh material={innerEarMat} position={[0, 0.01, 0.02]} rotation={[0.28, 0, -0.22]}>
          <coneGeometry args={[0.09, 0.23, 8]} />
        </mesh>
      </group>

      {/* ── Right Ear ── */}
      <group ref={rightEarG} position={[0.27, 1.84, 0.1]}>
        <mesh castShadow material={furMat} rotation={[0.28, 0, 0.22]}>
          <coneGeometry args={[0.15, 0.33, 8]} />
        </mesh>
        <mesh material={innerEarMat} position={[0, 0.01, 0.02]} rotation={[0.28, 0, 0.22]}>
          <coneGeometry args={[0.09, 0.23, 8]} />
        </mesh>
      </group>

      {/* ── Left Eye ── */}
      <group position={[-0.2, 1.56, 0.52]}>
        <mesh material={scleraMat}><sphereGeometry args={[0.13, 12, 12]} /></mesh>
        <mesh position={[0, 0, 0.04]} material={eyeMat}><sphereGeometry args={[0.1, 12, 12]} /></mesh>
        <mesh position={[0, 0, 0.1]} material={pupilMat}><sphereGeometry args={[pupilR, 10, 10]} /></mesh>
        <mesh position={[0.03, 0.04, 0.12]} material={catchMat}><sphereGeometry args={[0.021, 6, 6]} /></mesh>
        {/* Eyelid (blink) — scales Y to cover eye */}
        <group ref={leftEyeG} scale={[1, 0, 1]}>
          <mesh position={[0, 0.05, 0.07]} material={eyelidMat}>
            <sphereGeometry args={[0.14, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.72]} />
          </mesh>
        </group>
      </group>

      {/* ── Right Eye ── */}
      <group position={[0.2, 1.56, 0.52]}>
        <mesh material={scleraMat}><sphereGeometry args={[0.13, 12, 12]} /></mesh>
        <mesh position={[0, 0, 0.04]} material={eyeMat}><sphereGeometry args={[0.1, 12, 12]} /></mesh>
        <mesh position={[0, 0, 0.1]} material={pupilMat}><sphereGeometry args={[pupilR, 10, 10]} /></mesh>
        <mesh position={[-0.03, 0.04, 0.12]} material={catchMat}><sphereGeometry args={[0.021, 6, 6]} /></mesh>
        <group ref={rightEyeG} scale={[1, 0, 1]}>
          <mesh position={[0, 0.05, 0.07]} material={eyelidMat}>
            <sphereGeometry args={[0.14, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.72]} />
          </mesh>
        </group>
      </group>

      {/* ── Whiskers ── */}
      <WhiskerLines side={-1} />
      <WhiskerLines side={1} />

      {/* ── Front paws ── */}
      <mesh ref={leftPawRef} position={[-0.28, -1.08, 0.3]} castShadow material={bellyMat}>
        <sphereGeometry args={[0.18, 10, 10]} />
      </mesh>
      <mesh position={[0.28, -1.08, 0.3]} castShadow material={bellyMat}>
        <sphereGeometry args={[0.18, 10, 10]} />
      </mesh>
      {/* Toe beans — left */}
      {[-0.08, 0, 0.08].map((xOff, i) => (
        <mesh key={i} position={[-0.28 + xOff, -1.2, 0.42]} material={noseMat}>
          <sphereGeometry args={[0.04, 6, 6]} />
        </mesh>
      ))}
      {/* Toe beans — right */}
      {[-0.08, 0, 0.08].map((xOff, i) => (
        <mesh key={i} position={[0.28 + xOff, -1.2, 0.42]} material={noseMat}>
          <sphereGeometry args={[0.04, 6, 6]} />
        </mesh>
      ))}

      {/* ── Back paws ── */}
      <mesh position={[-0.36, -1.02, -0.16]} castShadow material={bellyMat}>
        <sphereGeometry args={[0.16, 10, 10]} />
      </mesh>
      <mesh position={[0.36, -1.02, -0.16]} castShadow material={bellyMat}>
        <sphereGeometry args={[0.16, 10, 10]} />
      </mesh>

      {/* ── Tail — 3-joint chain ── */}
      {/* Base group rotates for the root sway; pitched backward with rotation.x */}
      <group ref={tailBaseG} position={[0.08, 0.08, -0.68]} rotation={[1.1, 0, 0]}>
        <mesh castShadow material={furMat}>
          <capsuleGeometry args={[0.1, 0.52, 4, 8]} />
        </mesh>
        <group ref={tailMidG} position={[0, 0.58, 0]}>
          <mesh castShadow material={furMat}>
            <capsuleGeometry args={[0.076, 0.46, 4, 8]} />
          </mesh>
          <group ref={tailTipG} position={[0, 0.54, 0]}>
            <mesh castShadow material={furMat}>
              <capsuleGeometry args={[0.056, 0.36, 4, 8]} />
            </mesh>
            {/* Fluffy tip */}
            <mesh position={[0, 0.26, 0]} material={furMat}>
              <sphereGeometry args={[0.1, 8, 8]} />
            </mesh>
          </group>
        </group>
      </group>
    </group>
  );
}

// ─── Room accent lights ───────────────────────────────────────────────────────

function RoomAccentLights({ roomKey }) {
  const flameA = useRef();
  const flameB = useRef();
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const flicker = 1.1 + Math.sin(t * 9.2) * 0.28 + Math.sin(t * 14.8) * 0.14 + Math.sin(t * 22) * 0.07;
    if (flameA.current) flameA.current.intensity = flicker * 1.4;
    if (flameB.current) flameB.current.intensity = flicker * 1.2;
  });

  if (roomKey === 'wooden_cottage') {
    return <pointLight ref={flameA} position={[-3.2, 0.9, -2.8]} color="#ff7020" intensity={1.6} distance={9} />;
  }
  if (roomKey === 'castle_keep') {
    return (
      <>
        <pointLight ref={flameA} position={[-3.4, 1.2, -3]} color="#ff6a18" intensity={1.5} distance={8} />
        <pointLight ref={flameB} position={[3.4, 1.2, -3]} color="#ff6a18" intensity={1.3} distance={8} />
      </>
    );
  }
  if (roomKey === 'throne_room') {
    return (
      <>
        <pointLight ref={flameA} position={[-2.6, 1.0, -1.2]} color="#ff4010" intensity={2.0} distance={8} />
        <pointLight ref={flameB} position={[2.6, 1.0, -1.2]} color="#ff4010" intensity={2.0} distance={8} />
      </>
    );
  }
  if (roomKey === 'enchanted_tree') {
    return (
      <>
        <pointLight position={[-2.2, 0.6, -1.8]} color="#30ff70" intensity={0.9} distance={6} />
        <pointLight position={[2.6, 0.9, -2.2]} color="#50b8ff" intensity={0.7} distance={5} />
        <pointLight position={[0, 2.2, -2.5]} color="#80ffaa" intensity={0.5} distance={7} />
      </>
    );
  }
  if (roomKey === 'cushion_bed') {
    return <pointLight position={[0, 2.8, 0.5]} color="#9060ff" intensity={0.9} distance={9} />;
  }
  return null;
}

// ─── Room geometry ────────────────────────────────────────────────────────────

function Room3D({ roomKey }) {
  const floorTex = useMemo(() => {
    const tex = new THREE.CanvasTexture(generateFloorTexture(roomKey));
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(3, 3);
    return tex;
  }, [roomKey]);

  const wallTex = useMemo(() => {
    const tex = new THREE.CanvasTexture(generateWallTexture(roomKey));
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2, 1.5);
    return tex;
  }, [roomKey]);

  const floorMat = useMemo(() => new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.84, metalness: 0.02 }), [floorTex]);
  const wallMat  = useMemo(() => new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.95 }), [wallTex]);

  return (
    <group>
      {/* Floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.18, 0]} receiveShadow material={floorMat}>
        <planeGeometry args={[14, 14]} />
      </mesh>
      {/* Back wall */}
      <mesh position={[0, 1.6, -4.2]} material={wallMat}>
        <planeGeometry args={[14, 7]} />
      </mesh>
      {/* Left wall */}
      <mesh position={[-7, 1.6, 0]} rotation={[0, Math.PI / 2, 0]} material={wallMat}>
        <planeGeometry args={[14, 7]} />
      </mesh>
      {/* Right wall */}
      <mesh position={[7, 1.6, 0]} rotation={[0, -Math.PI / 2, 0]} material={wallMat}>
        <planeGeometry args={[14, 7]} />
      </mesh>
      <RoomAccentLights roomKey={roomKey} />
    </group>
  );
}

// ─── Scene lighting ───────────────────────────────────────────────────────────

function SceneLighting({ roomKey }) {
  const ambientIntensity = {
    corner_mat: 1.8, cushion_bed: 1.4, wooden_cottage: 1.6,
    enchanted_tree: 1.2, castle_keep: 1.3, throne_room: 0.9,
  };

  return (
    <>
      <ambientLight intensity={ambientIntensity[roomKey] ?? 1.6} color="#ccd0d8" />
      {/* Key light — warm, top-left, casts shadows */}
      <directionalLight
        position={[3.5, 6.5, 4.5]}
        intensity={2.6}
        color="#fff5e0"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-near={0.5}
        shadow-camera-far={22}
        shadow-camera-left={-6}
        shadow-camera-right={6}
        shadow-camera-top={6}
        shadow-camera-bottom={-6}
        shadow-bias={-0.001}
      />
      {/* Cool rim — back right */}
      <pointLight position={[-3, 4, -2.5]} color="#a8c8ff" intensity={1.1} />
      {/* Warm fill — low front */}
      <pointLight position={[1.5, -0.6, 3.5]} color="#ffb860" intensity={0.7} />
    </>
  );
}

// ─── Loading fallback ─────────────────────────────────────────────────────────

function SceneLoader() {
  return (
    <div style={{
      width: '100%', height: '100%', display: 'flex',
      alignItems: 'center', justifyContent: 'center',
      background: '#111', color: 'var(--text-muted)', fontSize: 13,
    }}>
      Loading scene…
    </div>
  );
}

// ─── Public export ────────────────────────────────────────────────────────────

export default function CompanionScene3D({ cat, mood, breed }) {
  const roomKey = cat?.room?.key || 'corner_mat';
  const room    = getRoom(roomKey);

  if (!room) return <SceneLoader />;

  return (
    <div style={{
      width: '100%',
      height: '100%',
      minHeight: 400,
      borderRadius: 16,
      overflow: 'hidden',
      background: room.palette.base,
    }}>
      <Canvas
        shadows
        camera={{ position: [0, 0.4, 6.0], fov: 52 }}
        onCreated={({ camera }) => camera.lookAt(0, 0.5, 0)}
        gl={{
          antialias: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.1,
          outputColorSpace: THREE.SRGBColorSpace,
        }}
        style={{ width: '100%', height: '100%' }}
      >
        <SceneLighting roomKey={roomKey} />
        <Room3D roomKey={roomKey} />
        <CatGroup cat={cat} mood={mood} breed={breed} />
      </Canvas>
    </div>
  );
}
