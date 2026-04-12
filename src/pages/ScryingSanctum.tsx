// ScryingSanctum.tsx — WebGL isometric RPG agent pipeline visualizer
// OrthographicCamera at 45° · Stone dungeon floor · Champion primitives · Ley lines · Runestones

import { useRef, useState, useMemo, Suspense } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Html, Line, OrbitControls } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import * as THREE from 'three';
import type { Session } from '@/types/session';
import { getSessionRunGroups } from '@/lib/agent-tree';
import type { AgentTreeNode, SessionRunGroup } from '@/lib/agent-tree';

// ─── Class config ─────────────────────────────────────────────────────────────

interface ClassConfig {
  color:    string;
  emissive: string;
  label:    string;
  aura:     string;
}

const CLASS_MAP: Record<string, ClassConfig> = {
  builder:     { color: '#f59e0b', emissive: '#7c3f00', label: 'WARRIOR',      aura: '#f59e0b' } as ClassConfig,
  detective:   { color: '#34d399', emissive: '#004d2e', label: 'ROGUE',        aura: '#34d399' } as ClassConfig,
  commander:   { color: '#60a5fa', emissive: '#003566', label: 'MAGE',         aura: '#60a5fa' } as ClassConfig,
  architect:   { color: '#a78bfa', emissive: '#3b0078', label: 'WARLOCK',      aura: '#a78bfa' } as ClassConfig,
  guardian:    { color: '#fbbf24', emissive: '#5c4000', label: 'PALADIN',      aura: '#fbbf24' } as ClassConfig,
  storyteller: { color: '#e2e8f0', emissive: '#2a3040', label: 'PRIEST',       aura: '#e2e8f0' } as ClassConfig,
  ghost:       { color: '#4ade80', emissive: '#00401a', label: 'DEATH KNIGHT', aura: '#4ade80' } as ClassConfig,
};
const FALLBACK_CLASS: ClassConfig = { color: '#888', emissive: '#222', label: 'AGENT', aura: '#888' };

const PIPELINE_ROLES = ['VANGUARD', 'SCOUT', 'ARCHMAGE', 'HERALD'];
const EXTRA_ROLES    = ['RUNNER',   'LINK',  'BRANCH',   'AUXILIARY'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getPipelineRole(i: number, total: number): string {
  if (total <= 1) return PIPELINE_ROLES[2]!;
  if (total <= 4) return PIPELINE_ROLES[Math.min(i, 3)]!;
  return EXTRA_ROLES[i % EXTRA_ROLES.length]!;
}

function getChampionName(session: Session, i: number): string {
  if (session.agent_slug) {
    return session.agent_slug.split('-').map((w) => w[0]?.toUpperCase() + w.slice(1)).join(' ');
  }
  const cat = session.cat_type ?? 'ghost';
  const cls = CLASS_MAP[cat] ?? FALLBACK_CLASS;
  return `${cls.label} ${String.fromCharCode(0x03b1 + (i % 24))}`;
}

function hpPercent(costUsd: number, maxCost: number): number {
  const ratio = maxCost > 0 ? costUsd / maxCost : 0;
  return Math.max(12, Math.round(100 - ratio * 60));
}

function manaPercent(tokens: number, maxTokens: number): number {
  return maxTokens > 0 ? Math.min(100, Math.round((tokens / maxTokens) * 100)) : 0;
}

function formatGold(usd: number): string {
  if (usd < 0.001) return `${(usd * 10000).toFixed(1)}c`;
  return `${usd.toFixed(4)}g`;
}

function formatDur(s: number): string {
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

// ─── Layout ───────────────────────────────────────────────────────────────────

interface PositionedNode {
  session:  Session;
  depth:    number;
  idx:      number;
  total:    number;
  pos:      [number, number, number];
  cls:      ClassConfig;
  name:     string;
  role:     string;
}

function layoutNodes(roots: AgentTreeNode[]): PositionedNode[] {
  // Group nodes by depth level first
  const byDepth: Array<Array<{ node: AgentTreeNode; depth: number }>> = [];

  function collect(node: AgentTreeNode, depth: number) {
    if (!byDepth[depth]) byDepth[depth] = [];
    byDepth[depth].push({ node, depth });
    node.children.forEach((c) => collect(c, depth + 1));
  }
  roots.forEach((r) => collect(r, 0));

  const allPositioned: PositionedNode[] = [];
  let globalIdx = 0;
  const total = byDepth.reduce((acc, arr) => acc + arr.length, 0);

  byDepth.forEach((row, depth) => {
    const count = row.length;
    row.forEach(({ node }, i) => {
      const x = (i - (count - 1) / 2) * 4.5;
      const z = depth * 4.5;
      const cat = node.session.cat_type ?? 'ghost';
      allPositioned.push({
        session:  node.session,
        depth,
        idx:      globalIdx,
        total,
        pos:      [x, 0, z],
        cls:      CLASS_MAP[cat] ?? FALLBACK_CLASS,
        name:     getChampionName(node.session, globalIdx),
        role:     getPipelineRole(globalIdx, total),
      });
      globalIdx++;
    });
  });

  return allPositioned;
}

// ─── Stone Floor ─────────────────────────────────────────────────────────────

function StoneFloor({ extent }: { extent: number }) {
  const tiles = useMemo(() => {
    const out: Array<[number, number]> = [];
    for (let x = -extent; x <= extent; x++) {
      for (let z = -extent; z <= extent; z++) {
        out.push([x, z]);
      }
    }
    return out;
  }, [extent]);

  return (
    <>
      {tiles.map(([x, z]) => {
        // Subtle variation in darkness per tile
        const shade = 0.035 + ((Math.abs(x * 3 + z * 7)) % 7) * 0.004;
        return (
          <mesh key={`${x}_${z}`} position={[x * 1.04, -0.06, z * 1.04]} receiveShadow>
            <boxGeometry args={[0.96, 0.08, 0.96]} />
            <meshStandardMaterial
              color={new THREE.Color(shade, shade, shade * 1.05)}
              roughness={0.9}
              metalness={0.05}
            />
          </mesh>
        );
      })}
    </>
  );
}

// ─── Champion geometry variant ────────────────────────────────────────────────

function ChampionGeometry({ catType, depth }: { catType: string; depth: number }) {
  if (depth === 0) return <octahedronGeometry args={[0.62, 0]} />;
  switch (catType) {
    case 'builder':     return <boxGeometry args={[0.72, 0.72, 0.72]} />;
    case 'detective':   return <coneGeometry args={[0.44, 1.05, 4]} />;
    case 'commander':   return <cylinderGeometry args={[0.34, 0.48, 1.08, 6]} />;
    case 'architect':   return <torusGeometry args={[0.36, 0.14, 8, 24]} />;
    case 'guardian':    return <dodecahedronGeometry args={[0.54, 0]} />;
    case 'storyteller': return <sphereGeometry args={[0.44, 14, 14]} />;
    case 'ghost':       return <icosahedronGeometry args={[0.52, 0]} />;
    default:            return <octahedronGeometry args={[0.5, 0]} />;
  }
}

// ─── Runestone (sphere traveling along a ley line) ────────────────────────────

function Runestone({
  from, to, color, offset = 0,
}: {
  from:   [number, number, number];
  to:     [number, number, number];
  color:  string;
  offset?: number;
}) {
  const ref  = useRef<THREE.Mesh>(null);
  const t    = useRef(offset % 1);
  const midY = Math.max(from[1], to[1]) + 2.2;

  useFrame((_, delta) => {
    t.current = (t.current + delta * 0.38) % 1;
    if (!ref.current) return;
    const tt  = t.current;
    const inv = 1 - tt;
    ref.current.position.set(
      inv * inv * from[0] + 2 * inv * tt * ((from[0] + to[0]) / 2) + tt * tt * to[0],
      inv * inv * from[1] + 2 * inv * tt * midY                    + tt * tt * to[1],
      inv * inv * from[2] + 2 * inv * tt * ((from[2] + to[2]) / 2) + tt * tt * to[2],
    );
  });

  return (
    <mesh ref={ref}>
      <sphereGeometry args={[0.09, 8, 8]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={4} />
    </mesh>
  );
}

// ─── Ley line connection ──────────────────────────────────────────────────────

function LeyConnection({
  from, to, color, choked,
}: {
  from:   [number, number, number];
  to:     [number, number, number];
  color:  string;
  choked: boolean;
}) {
  const midY = Math.max(from[1], to[1]) + 2.2;
  const mid: [number, number, number] = [
    (from[0] + to[0]) / 2,
    midY,
    (from[2] + to[2]) / 2,
  ];

  const points = useMemo(() => {
    const curve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(...from),
      new THREE.Vector3(...mid),
      new THREE.Vector3(...to),
    );
    return curve.getPoints(32);
  }, [from[0], from[1], from[2], to[0], to[1], to[2]]); // eslint-disable-line react-hooks/exhaustive-deps

  const lineColor = choked ? '#ff6b35' : color;

  return (
    <>
      <Line
        points={points}
        color={lineColor}
        lineWidth={1.2}
        opacity={0.55}
        transparent
      />
      <Runestone from={from} to={to} color={lineColor} offset={0} />
      <Runestone from={from} to={to} color={lineColor} offset={0.5} />
    </>
  );
}

// ─── Floating unit frame (DOM inside Canvas via Html) ─────────────────────────

function UnitFrameHtml({
  pn, maxCost, maxTokens, selected,
}: {
  pn:        PositionedNode;
  maxCost:   number;
  maxTokens: number;
  selected:  boolean;
}) {
  const hp  = hpPercent(pn.session.estimated_cost_usd, maxCost);
  const mp  = manaPercent(pn.session.total_tokens ?? 0, maxTokens);
  const c   = pn.cls;
  const brd = selected ? '#63f7b3' : c.color;

  return (
    <Html
      center
      distanceFactor={9}
      style={{ pointerEvents: 'none' }}
    >
      <div style={{
        width: 130,
        background: 'rgba(4,2,12,.88)',
        border: `1px solid ${brd}`,
        borderRadius: 4,
        padding: '5px 7px 6px',
        boxShadow: `0 0 12px ${c.aura}44`,
        fontFamily: 'monospace',
        transform: 'translateY(-110%)',
        userSelect: 'none',
      }}>
        {/* Role */}
        <div style={{ fontSize: 7.5, color: c.color, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 2 }}>
          {pn.role}
        </div>
        {/* Name */}
        <div style={{ fontSize: 10, color: '#e8d5a3', fontWeight: 600, marginBottom: 4, lineHeight: 1.2, letterSpacing: 0.5 }}>
          {pn.name}
        </div>
        {/* HP bar */}
        <div style={{ marginBottom: 3 }}>
          <div style={{ fontSize: 7, color: '#4ade80', letterSpacing: 1, marginBottom: 1 }}>HP</div>
          <div style={{ height: 4, background: '#0a1a0a', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ width: `${hp}%`, height: '100%', background: hp > 60 ? '#22c55e' : hp > 30 ? '#f59e0b' : '#ef4444', borderRadius: 2 }} />
          </div>
        </div>
        {/* Mana bar */}
        <div style={{ marginBottom: 4 }}>
          <div style={{ fontSize: 7, color: '#60a5fa', letterSpacing: 1, marginBottom: 1 }}>MANA</div>
          <div style={{ height: 4, background: '#050e1a', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ width: `${mp}%`, height: '100%', background: '#3b82f6', borderRadius: 2 }} />
          </div>
        </div>
        {/* Stats */}
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 8, color: '#c8a85599' }}>{formatGold(pn.session.estimated_cost_usd)}</span>
          <span style={{ fontSize: 8, color: '#c8a85599' }}>{formatDur(pn.session.duration_seconds)}</span>
        </div>
      </div>
    </Html>
  );
}

// ─── Animated champion node ───────────────────────────────────────────────────

function ChampionNode({
  pn, maxCost, maxTokens, selected, onClick,
}: {
  pn:        PositionedNode;
  maxCost:   number;
  maxTokens: number;
  selected:  boolean;
  onClick:   () => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const c       = pn.cls;

  useFrame((state) => {
    if (!meshRef.current) return;
    const t = state.clock.getElapsedTime();
    // Hover float
    meshRef.current.position.y = pn.pos[1] + 0.6 + Math.sin(t * 1.4 + pn.idx * 0.7) * 0.08;
    // Slow spin on Y
    meshRef.current.rotation.y = t * 0.35 + pn.idx * 0.9;
    // Aura ring pulse
    if (ringRef.current) {
      const s = 1 + Math.sin(t * 2.2 + pn.idx) * 0.07;
      ringRef.current.scale.setScalar(s);
    }
  });

  const emissiveIntensity = selected ? 1.8 : 1.0;

  return (
    <group position={pn.pos}>
      {/* Aura ring on floor */}
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.04, 0]}>
        <ringGeometry args={[0.7, 0.85, 32]} />
        <meshStandardMaterial
          color={c.aura}
          emissive={c.aura}
          emissiveIntensity={0.6}
          transparent
          opacity={0.35}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Champion primitive */}
      <mesh
        ref={meshRef}
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        castShadow
      >
        <ChampionGeometry catType={pn.session.cat_type ?? 'ghost'} depth={pn.depth} />
        <meshStandardMaterial
          color={c.color}
          emissive={c.emissive}
          emissiveIntensity={emissiveIntensity}
          roughness={0.25}
          metalness={0.6}
        />
      </mesh>

      {/* Selection ring */}
      {selected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.03, 0]}>
          <ringGeometry args={[0.9, 1.0, 32]} />
          <meshStandardMaterial
            color="#63f7b3"
            emissive="#63f7b3"
            emissiveIntensity={2}
            transparent
            opacity={0.7}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}

      {/* Floating unit frame */}
      <UnitFrameHtml
        pn={pn}
        maxCost={maxCost}
        maxTokens={maxTokens}
        selected={selected}
      />
    </group>
  );
}

// ─── Full 3D scene ────────────────────────────────────────────────────────────

function Scene({
  group,
  selectedId,
  onSelect,
}: {
  group:      SessionRunGroup;
  selectedId: string | null;
  onSelect:   (id: string | null) => void;
}) {
  const nodes = useMemo(() => {
    const roots: AgentTreeNode[] = group.roots;
    return layoutNodes(roots);
  }, [group]);

  const maxCost   = useMemo(() => Math.max(...nodes.map((n) => n.session.estimated_cost_usd), 0.001), [nodes]);
  const maxTokens = useMemo(() => Math.max(...nodes.map((n) => n.session.total_tokens ?? 0), 1), [nodes]);

  // Position lookup for ley lines
  const posMap = useMemo(() => {
    const m = new Map<string, [number, number, number]>();
    nodes.forEach((n) => m.set(n.session.session_id, n.pos));
    return m;
  }, [nodes]);

  // Build ley line pairs (child → parent)
  const connections = useMemo(() => {
    return nodes
      .filter((n) => n.session.parent_session_id && posMap.has(n.session.parent_session_id))
      .map((n) => ({
        from:   posMap.get(n.session.parent_session_id!)!,
        to:     n.pos,
        color:  n.cls.color,
        choked: n.session.estimated_cost_usd > 0.05,
        key:    n.session.session_id,
      }));
  }, [nodes, posMap]);

  // Floor extent
  const floorExtent = Math.max(6, Math.ceil(nodes.length * 1.5));

  // Camera focus point
  const center = useMemo(() => {
    if (!nodes.length) return new THREE.Vector3(0, 0, 0);
    const xs = nodes.map((n) => n.pos[0]);
    const zs = nodes.map((n) => n.pos[2]);
    return new THREE.Vector3(
      (Math.min(...xs) + Math.max(...xs)) / 2,
      0,
      (Math.min(...zs) + Math.max(...zs)) / 2,
    );
  }, [nodes]);

  return (
    <>
      {/* ── Lighting ──────────────────────────────────── */}
      <ambientLight intensity={0.15} color="#1a1040" />
      <directionalLight position={[10, 20, 10]} intensity={0.9} color="#fff8e8" castShadow />
      <directionalLight position={[-8, 5, -8]} intensity={0.3} color="#4040ff" />
      <pointLight position={[0, 8, 0]} intensity={0.4} color="#c8a855" distance={40} />

      {/* ── Floor ─────────────────────────────────────── */}
      <Suspense fallback={null}>
        <StoneFloor extent={floorExtent} />
      </Suspense>

      {/* ── Ley lines ─────────────────────────────────── */}
      {connections.map((conn) => (
        <LeyConnection
          key={conn.key}
          from={conn.from}
          to={conn.to}
          color={conn.color}
          choked={conn.choked}
        />
      ))}

      {/* ── Champion nodes ────────────────────────────── */}
      {nodes.map((pn) => (
        <ChampionNode
          key={pn.session.session_id}
          pn={pn}
          maxCost={maxCost}
          maxTokens={maxTokens}
          selected={selectedId === pn.session.session_id}
          onClick={() => onSelect(selectedId === pn.session.session_id ? null : pn.session.session_id)}
        />
      ))}

      {/* ── Camera controls ───────────────────────────── */}
      <OrbitControls
        target={center}
        enableDamping
        dampingFactor={0.06}
        minZoom={30}
        maxZoom={180}
        maxPolarAngle={Math.PI / 2.4}
        minPolarAngle={Math.PI / 8}
      />

      {/* ── Bloom ─────────────────────────────────────── */}
      <EffectComposer>
        <Bloom
          intensity={0.9}
          luminanceThreshold={0.3}
          luminanceSmoothing={0.7}
          mipmapBlur
        />
      </EffectComposer>
    </>
  );
}

// ─── Detail drawer (DOM overlay) ─────────────────────────────────────────────

function DetailDrawer({
  session,
  cls,
  name,
  role,
  onClose,
}: {
  session: Session;
  cls:     ClassConfig;
  name:    string;
  role:    string;
  onClose: () => void;
}) {
  const tools = session.tools
    ? Object.entries(session.tools).sort((a, b) => b[1] - a[1]).slice(0, 6)
    : [];

  return (
    <div style={{
      position: 'absolute', bottom: 0, left: 0, right: 0,
      background: 'rgba(4,2,12,.95)',
      borderTop: `1px solid ${cls.color}55`,
      padding: '14px 24px 16px',
      zIndex: 30,
      fontFamily: 'monospace',
      boxShadow: `0 -8px 40px ${cls.aura}22`,
    }}>
      <button
        onClick={onClose}
        style={{
          position: 'absolute', top: 10, right: 16,
          background: 'none', border: `1px solid ${cls.color}44`,
          color: cls.color, borderRadius: 3,
          padding: '2px 8px', cursor: 'pointer', fontSize: 10,
        }}
      >
        CLOSE
      </button>

      <div style={{ display: 'flex', gap: 32, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* Identity */}
        <div>
          <div style={{ fontSize: 8, color: cls.color, letterSpacing: 2, marginBottom: 3 }}>{role}</div>
          <div style={{ fontSize: 15, color: '#e8d5a3', letterSpacing: 1.5, fontWeight: 600 }}>{name}</div>
          <div style={{ fontSize: 9, color: '#94a3b8', marginTop: 2 }}>{session.model}</div>
        </div>

        {/* Stats */}
        {[
          { label: 'COST',     val: formatGold(session.estimated_cost_usd) },
          { label: 'DURATION', val: formatDur(session.duration_seconds)     },
          { label: 'TOKENS',   val: (session.total_tokens ?? 0).toLocaleString() },
          { label: 'MESSAGES', val: String(session.message_count)           },
          { label: 'PROJECT',  val: session.project                         },
        ].map(({ label, val }) => (
          <div key={label}>
            <div style={{ fontSize: 8, color: '#c8a85566', letterSpacing: 2, marginBottom: 3 }}>{label}</div>
            <div style={{ fontSize: 11, color: '#e8d5a3' }}>{val}</div>
          </div>
        ))}

        {/* Tools */}
        {tools.length > 0 && (
          <div>
            <div style={{ fontSize: 8, color: '#c8a85566', letterSpacing: 2, marginBottom: 5 }}>TOP TOOLS</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {tools.map(([tool, count]) => (
                <div key={tool} style={{
                  fontSize: 8.5, padding: '2px 7px',
                  border: `1px solid ${cls.color}33`,
                  borderRadius: 2, color: cls.color,
                  background: `${cls.aura}08`,
                }}>
                  {tool} ×{count}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: 'calc(100vh - 80px)',
      background: 'radial-gradient(ellipse at 25% 15%,#160828 0%,#07040f 55%,#030208 100%)',
      flexDirection: 'column', gap: 12,
      color: '#c8a85544', fontFamily: 'monospace',
    }}>
      <div style={{ fontSize: 36 }}>🔮</div>
      <div style={{ fontSize: 11, letterSpacing: 3, textTransform: 'uppercase' }}>Sanctum Awaits</div>
      <pre style={{ fontSize: 11, color: '#63f7b3', background: 'rgba(0,0,0,.4)', padding: '8px 18px', borderRadius: 6 }}>
        node sync/export-local.mjs
      </pre>
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

export default function ScryingSanctum({ sessions, onReload }: { sessions: Session[]; onReload?: () => void }) {
  const [runIdx,   setRunIdx]   = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [syncing,  setSyncing]  = useState(false);

  const groups = useMemo(() => getSessionRunGroups(sessions), [sessions]);
  const group  = groups[runIdx] ?? null;

  // When groups change (new sync loaded), reset to most recent run (idx 0)
  const prevGroupsLen = useRef(groups.length);
  useEffect(() => {
    if (prevGroupsLen.current !== groups.length) {
      prevGroupsLen.current = groups.length;
      setRunIdx(0);
      setSelected(null);
    }
  }, [groups.length]);

  async function handleSync() {
    if (syncing) return;
    setSyncing(true);
    try {
      await fetch('/api/sync', { method: 'POST' });
      onReload?.();
    } catch { /* ignore in prod */ } finally {
      setSyncing(false);
    }
  }

  // Flatten group for detail lookup
  const flatNodes: PositionedNode[] = useMemo(() => {
    if (!group) return [];
    return layoutNodes(group.roots);
  }, [group]);

  const selectedNode = flatNodes.find((n) => n.session.session_id === selected) ?? null;

  if (groups.length === 0) return <EmptyState />;

  return (
    <div style={{
      minHeight: 'calc(100vh - 80px)',
      background: '#030208',
      borderRadius: 12,
      overflow: 'hidden',
      position: 'relative',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* ── Header ─────────────────────────────────────── */}
      <div style={{
        padding: '12px 20px 10px',
        borderBottom: '1px solid rgba(200,168,85,.12)',
        display: 'flex', alignItems: 'center', gap: 14,
        zIndex: 10, position: 'relative',
        background: 'rgba(4,2,12,.75)',
        backdropFilter: 'blur(8px)',
      }}>
        <div>
          <div style={{ fontSize: 8.5, color: '#c8a85555', letterSpacing: 3, textTransform: 'uppercase' }}>
            Scrying Sanctum
          </div>
          <div style={{ fontSize: 16, color: '#e8d5a3', fontWeight: 300, letterSpacing: 1.5, fontFamily: 'monospace' }}>
            {group?.project ?? '—'}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 'auto' }}>
          <span style={{ fontSize: 9, color: '#64748b', fontFamily: 'monospace' }}>
            {flatNodes.length} agent{flatNodes.length !== 1 ? 's' : ''}
          </span>
          <span style={{ fontSize: 9, color: '#c8a855', fontFamily: 'monospace' }}>
            {formatGold(group?.totalCost ?? 0)}
          </span>

          <select
            value={runIdx}
            onChange={(e) => { setRunIdx(+e.target.value); setSelected(null); }}
            style={{
              background: 'rgba(0,0,0,.7)', border: '1px solid #c8a85533',
              borderRadius: 4, color: '#e8d5a3', fontSize: 11,
              padding: '5px 10px', fontFamily: 'monospace', cursor: 'pointer',
            }}
          >
            {groups.slice(0, 40).map((g, i) => (
              <option key={i} value={i}>
                {g.project} — {formatGold(g.totalCost)} · {g.roots.length} root{g.roots.length !== 1 ? 's' : ''}
              </option>
            ))}
          </select>

          {/* Sync button */}
          <button
            onClick={handleSync}
            disabled={syncing}
            title="Sync latest sessions"
            style={{
              background: 'rgba(0,0,0,.6)', border: '1px solid #c8a85533',
              borderRadius: 4, color: syncing ? '#c8a85566' : '#c8a855',
              fontSize: 10, padding: '4px 10px', fontFamily: 'monospace',
              cursor: syncing ? 'wait' : 'pointer', letterSpacing: 1,
            }}
          >
            {syncing ? '⟳ SYNCING…' : '⟳ SYNC'}
          </button>

          <div style={{
            fontSize: 8.5, letterSpacing: 2, padding: '3px 10px',
            border: '1px solid #63f7b355', borderRadius: 2,
            color: '#63f7b3', background: 'rgba(99,247,179,.07)',
            fontFamily: 'monospace', textTransform: 'uppercase',
          }}>
            ACTIVE
          </div>
        </div>
      </div>

      {/* ── Legend ─────────────────────────────────────── */}
      <div style={{
        position: 'absolute', top: 60, left: 16, zIndex: 10,
        display: 'flex', flexDirection: 'column', gap: 4,
        pointerEvents: 'none',
      }}>
        {[
          { color: '#f59e0b', label: 'WARRIOR',      shape: '◆' },
          { color: '#34d399', label: 'ROGUE',        shape: '▲' },
          { color: '#60a5fa', label: 'MAGE',         shape: '⬡' },
          { color: '#a78bfa', label: 'WARLOCK',      shape: '⊙' },
          { color: '#4ade80', label: 'DEATH KNIGHT', shape: '⬡' },
        ].map(({ color, label, shape }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ fontSize: 9, color, opacity: 0.7 }}>{shape}</span>
            <span style={{ fontSize: 7.5, color: '#c8a85555', letterSpacing: 1.2, fontFamily: 'monospace' }}>
              {label}
            </span>
          </div>
        ))}
      </div>

      {/* ── Controls hint ──────────────────────────────── */}
      <div style={{
        position: 'absolute', top: 60, right: 16, zIndex: 10,
        pointerEvents: 'none',
        fontFamily: 'monospace',
      }}>
        {[
          'SCROLL · ZOOM',
          'DRAG  · PAN',
          'CLICK · SELECT',
        ].map((hint) => (
          <div key={hint} style={{ fontSize: 7.5, color: '#c8a85533', letterSpacing: 1.5, textAlign: 'right', marginBottom: 2 }}>
            {hint}
          </div>
        ))}
      </div>

      {/* ── WebGL Canvas ───────────────────────────────── */}
      <div style={{ flex: 1, minHeight: 520, position: 'relative' }}>
        <Canvas
          orthographic
          camera={{ position: [14, 14, 14], zoom: 70, up: [0, 1, 0], near: 0.1, far: 500 }}
          shadows
          gl={{ antialias: true, alpha: false }}
          style={{ background: 'radial-gradient(ellipse at 30% 20%, #160828 0%, #07040f 50%, #030208 100%)' }}
          onClick={(e) => {
            // Click on canvas background → deselect
            if (e.target === e.currentTarget) setSelected(null);
          }}
        >
          <Suspense fallback={null}>
            {group && (
              <Scene
                group={group}
                selectedId={selected}
                onSelect={setSelected}
              />
            )}
          </Suspense>
        </Canvas>
      </div>

      {/* ── Detail drawer ──────────────────────────────── */}
      {selectedNode && (
        <DetailDrawer
          session={selectedNode.session}
          cls={selectedNode.cls}
          name={selectedNode.name}
          role={selectedNode.role}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
