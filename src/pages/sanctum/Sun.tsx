// LLM Sun & helpers.
//
// A radiant orb above the plaza, the visible heartbeat of the API. Brightness
// scales with token volume across the current run group; color reflects the
// active model tier (haiku=lemon, sonnet=cream, opus=amber, codex=ice blue);
// click opens a spend + cache panel; eclipse state triggers when ghost ratio
// exceeds 50% (the run group is mostly failures).

import { useRef, useMemo, useState, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { Session } from '@/types/session';

// ─── Constants exposed to Scene ──────────────────────────────────────────────

export const SUN_POSITION = new THREE.Vector3(-4, 8, -4);

// Sentinel selection ID used when the sun's panel is open. Champions never
// have this session_id, so all WoWNameplates stay closed while the sun is
// selected.
export const SUN_SELECTION_ID = '__llm_sun__';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ModelTier = 'haiku' | 'sonnet' | 'opus' | 'codex' | 'mixed' | 'unknown';

export interface SunBinding {
  modelTier:      ModelTier;
  modelLabel:     string;   // raw most-recent model name, for display
  loadFactor:     number;   // 0..1 — drives brightness multiplier
  totalSpendUsd:  number;
  totalTokens:    number;
  sessionCount:   number;
  ghostCount:     number;
  cacheHitRate:   number;   // 0..1
  avgDurationMin: number;
  eclipsed:       boolean;
}

const TIER_PALETTE: Record<ModelTier, {
  core: string; inner: string; halo: string; corona: string; ray: string; label: string;
}> = {
  haiku:   { core: '#fff8d0', inner: '#fffbe8', halo: '#ffe89a', corona: '#ffd060', ray: '#ffe5a0', label: 'HAIKU'   },
  sonnet:  { core: '#ffd97a', inner: '#fff4c4', halo: '#ffb84a', corona: '#f59e0b', ray: '#ffcb6a', label: 'SONNET'  },
  opus:    { core: '#ff9a3c', inner: '#ffc880', halo: '#ff7a20', corona: '#d65010', ray: '#ff8c40', label: 'OPUS'    },
  codex:   { core: '#a0d8ff', inner: '#d8eeff', halo: '#70b8ff', corona: '#3a8cd0', ray: '#a0c8ff', label: 'CODEX'   },
  mixed:   { core: '#e0c0ff', inner: '#f0e0ff', halo: '#b890ff', corona: '#8060d0', ray: '#c0a0ff', label: 'MIXED'   },
  unknown: { core: '#cccccc', inner: '#eeeeee', halo: '#999999', corona: '#666666', ray: '#bbbbbb', label: '—'       },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function modelTierOf(model: string | null | undefined): ModelTier {
  // Defensive: real session rows can have model=null (e.g. when the source
  // log didn't carry a model field). Treat as 'unknown' instead of crashing.
  const m = (model ?? '').toLowerCase();
  if (!m)                                             return 'unknown';
  if (m.includes('haiku'))                            return 'haiku';
  if (m.includes('opus'))                             return 'opus';
  if (m.includes('sonnet'))                           return 'sonnet';
  if (m.includes('gpt') || m.includes('codex')
      || m.includes('o1') || m.includes('o3')
      || m.includes('o4'))                            return 'codex';
  return 'unknown';
}

export function deriveSunBinding(nodes: ReadonlyArray<{ session: Session }>): SunBinding {
  if (nodes.length === 0) {
    return {
      modelTier: 'unknown', modelLabel: '—',
      loadFactor: 0, totalSpendUsd: 0, totalTokens: 0,
      sessionCount: 0, ghostCount: 0, cacheHitRate: 0,
      avgDurationMin: 0, eclipsed: true,
    };
  }
  // Pick a "current" model: latest started_at among non-ghosts (fall back to
  // all nodes if every session is a ghost).
  const live = nodes.filter((n) => !n.session.is_ghost);
  const pool = live.length ? live : nodes;
  const latest = pool.reduce((a, b) =>
    (a.session.started_at ?? '') > (b.session.started_at ?? '') ? a : b,
  );
  const modelLabel = latest.session.model ?? '—';

  // Tier roll-up: if all nodes share one tier, use it; if Anthropic + Codex
  // mix, label MIXED; otherwise fall back to the latest model's tier.
  const tiers = new Set(nodes.map((n) => modelTierOf(n.session.model)));
  let modelTier: ModelTier;
  if (tiers.size === 1) {
    modelTier = [...tiers][0] ?? 'unknown';
  } else if (
    tiers.has('codex') &&
    (tiers.has('sonnet') || tiers.has('opus') || tiers.has('haiku'))
  ) {
    modelTier = 'mixed';
  } else {
    modelTier = modelTierOf(modelLabel);
  }

  const totalSpendUsd  = nodes.reduce((s, n) => s + (n.session.estimated_cost_usd ?? 0), 0);
  const totalTokens    = nodes.reduce((s, n) => s + (n.session.total_tokens       ?? 0), 0);
  const ghostCount     = nodes.filter((n) => n.session.is_ghost).length;
  const sessionCount   = nodes.length;
  const cacheRead      = nodes.reduce((s, n) => s + (n.session.cache_read_tokens ?? 0), 0);
  const inputTokens    = nodes.reduce((s, n) => s + (n.session.input_tokens      ?? 0), 0);
  const cacheHitRate   = (cacheRead + inputTokens) > 0 ? cacheRead / (cacheRead + inputTokens) : 0;
  const avgDurationMin = (nodes.reduce((s, n) => s + (n.session.duration_seconds ?? 0), 0)
                          / nodes.length) / 60;

  // Brightness load: log-ish ramp, capped at 1M tokens for full brightness.
  const loadFactor = Math.min(1, totalTokens / 1_000_000);

  // Eclipse: ghost ratio > 50% on a non-trivial run group → API/work mostly
  // failed. Single-session runs are too noisy to eclipse.
  const eclipsed = sessionCount >= 3 && (ghostCount / sessionCount) > 0.5;

  return {
    modelTier, modelLabel,
    loadFactor, totalSpendUsd, totalTokens,
    sessionCount, ghostCount, cacheHitRate,
    avgDurationMin, eclipsed,
  };
}

// Local token formatter — kept here rather than importing from helpers.ts so
// the Sun panel's "1.2M / 800k / 320" units stay locked to the panel's
// design decisions independent of formatGold/formatGoldShort.
function formatTokens(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function SunPanelRow({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
      <span style={{ color: '#888' }}>{k}</span>
      <span style={{ color: '#eee', fontVariantNumeric: 'tabular-nums' }}>{v}</span>
    </div>
  );
}

// Streaming-token emitter — fires inside the open LLM Sun panel. Spawns one
// short JSON-ish text fragment every ~280ms; each token drifts up-and-right
// from the panel's right edge over 1.6s, fading as it goes. Visually evokes
// the model "writing tokens" out of the card in real time. Pure CSS keyframe
// animation, no rAF, so it's effectively free.
function ModelCardEmitter({ binding, palette }: {
  binding: SunBinding;
  palette: typeof TIER_PALETTE[ModelTier];
}) {
  const [tokens, setTokens] = useState<{ id: number; text: string; dx: number; dy: number }[]>([]);
  const idRef = useRef(0);

  useEffect(() => {
    // Token seeds — mix of real numbers from the binding + JSON-glyph
    // filler. Random pick per spawn so the stream looks like genuine
    // model output rather than scripted text.
    const seeds: string[] = [
      `"${palette.label.toLowerCase()}"`,
      `"$${binding.totalSpendUsd.toFixed(4)}"`,
      formatTokens(binding.totalTokens),
      `${(binding.cacheHitRate * 100).toFixed(0)}%`,
      `${binding.sessionCount} sess`,
      `${binding.avgDurationMin.toFixed(1)}m`,
      '{', '}', '"', ':', ',', '[', ']',
      '"model"', '"spend"', '"tokens"', '"cache"',
    ];
    const iv = setInterval(() => {
      const text = seeds[Math.floor(Math.random() * seeds.length)] ?? '"';
      const dx = 60 + Math.random() * 90;          // 60..150 px right
      const dy = -45 + (Math.random() - 0.5) * 50; // upward with vertical spread
      const id = idRef.current++;
      setTokens(prev => [...prev, { id, text, dx, dy }]);
      // Auto-prune after the animation finishes so the array doesn't grow.
      setTimeout(() => setTokens(prev => prev.filter(t => t.id !== id)), 1700);
    }, 280);
    return () => clearInterval(iv);
  }, [binding, palette.label]);

  return (
    <>
      {tokens.map(t => (
        <span
          key={t.id}
          style={{
            position: 'absolute',
            top: '50%',
            left: '100%',
            color: palette.corona,
            fontSize: 9,
            fontFamily: 'monospace',
            whiteSpace: 'nowrap',
            opacity: 0,
            animation: 'sun-token-drift 1.6s ease-out forwards',
            textShadow: `0 0 4px ${palette.halo}88`,
            pointerEvents: 'none',
            ...({ '--dx': `${t.dx}px`, '--dy': `${t.dy}px` } as Record<string, string>),
          } as React.CSSProperties}
        >{t.text}</span>
      ))}
      <style>{`
        @keyframes sun-token-drift {
          0%   { opacity: 0; transform: translate(0, 0); }
          12%  { opacity: 1; }
          70%  { opacity: 0.85; }
          100% { opacity: 0; transform: translate(var(--dx), var(--dy)); }
        }
      `}</style>
    </>
  );
}

// ─── ClaudeSun (the visible LLM heartbeat) ───────────────────────────────────

export function ClaudeSun({ binding, selected, onClick }: {
  binding:  SunBinding;
  selected: boolean;
  onClick:  () => void;
}) {
  const coreRef  = useRef<THREE.Mesh>(null);
  const haloRef  = useRef<THREE.Mesh>(null);
  const halo2Ref = useRef<THREE.Mesh>(null);
  const raysRef  = useRef<THREE.Group>(null);

  const palette  = TIER_PALETTE[binding.modelTier];
  const eclipsed = binding.eclipsed;
  // Eclipse dims everything to ~12%. Otherwise: 0.55 baseline + up to 0.45 from
  // load factor — even an idle Sanctum reads as "API is awake."
  const brightness = eclipsed ? 0.12 : (0.55 + binding.loadFactor * 0.45);

  const rayGeom = useMemo(() => new THREE.PlaneGeometry(0.6, 6), []);
  const rayMats = useMemo(
    () => Array.from({ length: 12 }, () => new THREE.MeshBasicMaterial({
      color: palette.ray, transparent: true, opacity: 0.18,
      side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    })),
    // Recolor when model tier changes.
    [palette.ray],
  );

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (coreRef.current) {
      const pulse = 1 + Math.sin(t * 0.6) * 0.04;
      coreRef.current.scale.setScalar(pulse);
      const mat = coreRef.current.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.95 * brightness;
    }
    if (haloRef.current) {
      (haloRef.current.material as THREE.MeshBasicMaterial).opacity =
        (0.30 + Math.sin(t * 0.5) * 0.05) * brightness;
    }
    if (halo2Ref.current) {
      halo2Ref.current.rotation.z = t * 0.05;
      (halo2Ref.current.material as THREE.MeshBasicMaterial).opacity =
        (0.14 + Math.sin(t * 0.8) * 0.04) * brightness;
    }
    if (raysRef.current) {
      raysRef.current.rotation.y = t * 0.08;
      raysRef.current.children.forEach((child, i) => {
        const mat = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
        mat.opacity = (0.12 + Math.abs(Math.sin(t * 0.9 + i * 0.7)) * 0.14) * brightness;
      });
    }
  });

  return (
    <group position={SUN_POSITION.toArray()}>
      {/* Click target — invisible sphere wrapping the visible meshes so the
          radiating rays don't have to be pickable. */}
      <mesh
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'pointer'; }}
        onPointerOut={() => { document.body.style.cursor = 'auto'; }}
      >
        <sphereGeometry args={[2.0, 16, 16]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* Core orb */}
      <mesh ref={coreRef}>
        <sphereGeometry args={[1.2, 24, 24]} />
        <meshBasicMaterial color={palette.core} transparent opacity={0.95} fog={false} />
      </mesh>
      {/* Inner hot core */}
      <mesh>
        <sphereGeometry args={[0.75, 16, 16]} />
        <meshBasicMaterial color={palette.inner} transparent opacity={1} fog={false} />
      </mesh>
      {/* Soft halo */}
      <mesh ref={haloRef}>
        <sphereGeometry args={[1.8, 24, 24]} />
        <meshBasicMaterial color={palette.halo} transparent opacity={0.30}
          blending={THREE.AdditiveBlending} depthWrite={false} fog={false} />
      </mesh>
      {/* Outer corona */}
      <mesh ref={halo2Ref}>
        <sphereGeometry args={[2.6, 24, 24]} />
        <meshBasicMaterial color={palette.corona} transparent opacity={0.14}
          blending={THREE.AdditiveBlending} depthWrite={false} fog={false} />
      </mesh>
      {/* Dalaran D5 — wide bloom-fake corona. Very low opacity additive
          sphere at 2× the corona radius. No animation; sits steady so the
          sun reads as bloomed without postprocessing. */}
      <mesh>
        <sphereGeometry args={[5.0, 16, 16]} />
        <meshBasicMaterial color={palette.halo} transparent opacity={0.05}
          blending={THREE.AdditiveBlending} depthWrite={false} fog={false} />
      </mesh>
      <mesh>
        <sphereGeometry args={[7.5, 16, 16]} />
        <meshBasicMaterial color={palette.core} transparent opacity={0.025}
          blending={THREE.AdditiveBlending} depthWrite={false} fog={false} />
      </mesh>
      {/* Selection ring — visible only when the sun is the active selection */}
      {selected && (
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <ringGeometry args={[2.9, 3.05, 64]} />
          <meshBasicMaterial color={palette.corona} transparent opacity={0.85}
            side={THREE.DoubleSide} depthWrite={false} blending={THREE.AdditiveBlending} fog={false} />
        </mesh>
      )}
      {/* Radiating ray planes (crossed billboards) */}
      <group ref={raysRef}>
        {Array.from({ length: 12 }, (_, i) => {
          const a = (i / 12) * Math.PI * 2;
          return (
            <mesh key={i} rotation={[0, a, 0]} geometry={rayGeom} material={rayMats[i]!} />
          );
        })}
      </group>

      {/* Always-on "LLM SUN" label above the orb. Cinzel for the engraved
          headline, monospace for the tier subtitle. Sits above the corona
          so the click panel (opens below) doesn't collide. Eclipse state
          dims the label too — when the API is angry, even the title fades. */}
      <Html center position={[0, 3.6, 0]} style={{ pointerEvents: 'none' }}>
        <div style={{
          fontFamily: '"Cinzel", serif',
          fontWeight: 700,
          fontSize: 11,
          letterSpacing: 4,
          color: palette.corona,
          textShadow: `0 0 8px ${palette.halo}aa, 0 0 4px rgba(0,0,0,.9)`,
          userSelect: 'none',
          whiteSpace: 'nowrap',
          textAlign: 'center',
          opacity: eclipsed ? 0.4 : 0.9,
        }}>
          LLM SUN
          <div style={{
            fontFamily: 'monospace',
            fontSize: 7.5, letterSpacing: 2,
            opacity: 0.7, marginTop: 2, fontWeight: 400,
          }}>
            {palette.label}
          </div>
        </div>
      </Html>

      {/* Click-to-open panel — same drei <Html> pattern as champion nameplate.
          Hidden by default; opens when the sun is selected. position:relative
          so the ModelCardEmitter's absolutely-positioned token spans anchor
          to the panel's right edge. */}
      {selected && (
        <Html center position={[0, -3.0, 0]} style={{ pointerEvents: 'none' }}>
          <div style={{
            position: 'relative',
            width: 200,
            background: 'rgba(8,6,14,.92)',
            border: `1px solid ${palette.corona}aa`,
            borderRadius: 4,
            padding: '7px 10px 8px',
            fontFamily: 'monospace',
            color: '#eee',
            userSelect: 'none',
            boxShadow: `0 0 14px ${palette.halo}66`,
            fontSize: 10,
            lineHeight: 1.5,
            // Absorb clicks so reading the panel doesn't trigger Canvas
            // onPointerMissed deselect. The token-emitter spans inside have
            // pointer-events:none so they don't steal hover/click either.
            pointerEvents: 'auto', cursor: 'default',
          }}
          onClick={(e) => e.stopPropagation()}>
            <div style={{
              fontFamily: '"Cinzel", serif', fontWeight: 700,
              fontSize: 11, letterSpacing: 2.5, color: palette.corona,
              textTransform: 'uppercase', marginBottom: 4,
            }}>
              {eclipsed ? '⚠ Eclipse' : 'LLM Sun'} · {palette.label}
            </div>
            <div style={{ fontSize: 9, color: '#aaa', marginBottom: 6, wordBreak: 'break-all' }}>
              {binding.modelLabel}
            </div>
            <SunPanelRow k="Spend"     v={`$${binding.totalSpendUsd.toFixed(4)}`} />
            <SunPanelRow k="Tokens"    v={formatTokens(binding.totalTokens)} />
            <SunPanelRow k="Sessions"  v={`${binding.sessionCount - binding.ghostCount} live · ${binding.ghostCount} ghost`} />
            <SunPanelRow k="Cache hit" v={`${(binding.cacheHitRate * 100).toFixed(0)}%`} />
            <SunPanelRow k="Avg dur."  v={`${binding.avgDurationMin.toFixed(1)}m`} />
            {/* Streaming token fragments — visual signal that the model is
                generating from this card. Suppressed during eclipse since
                an API outage shouldn't be emitting tokens. */}
            {!eclipsed && <ModelCardEmitter binding={binding} palette={palette} />}
          </div>
        </Html>
      )}
    </group>
  );
}
